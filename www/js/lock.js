// 부모 화면 잠금(PIN). 이 기기에서만 동작하는 '화면 잠금'이고, 서버 권한은 기기 열쇠가 지킨다.
// 저장: cc_pin_v2 = {s: 솔트(hex), h: PBKDF2-SHA256 10만 회 해시(hex)} — 평문 PIN 은 저장하지 않는다.
const PIN_KEY = 'cc_pin_v2', FAIL_KEY = 'cc_pin_fail', SECRET_KEY = 'cc_secret_v2', SESSION_KEY = 'cc_unlocked';
const validPin = (v) => typeof v === 'string' && /^[0-9]{4,6}$/.test(v);
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));

export function createLock({ storage, session, subtle, random = globalThis.crypto, now = Date.now, relockMs = 60000 }) {
  let hiddenAt = 0;
  const safe = (fn, dflt) => { try { return fn(); } catch (e) { return dflt; } };

  async function hash(pin, saltHex) {
    const key = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    return toHex(await subtle.deriveBits({ name: 'PBKDF2', salt: fromHex(saltHex), iterations: 100000, hash: 'SHA-256' }, key, 256));
  }
  function record() {
    const rec = safe(() => JSON.parse(storage.getItem(PIN_KEY) || 'null'), null);
    return rec && typeof rec.s === 'string' && typeof rec.h === 'string' ? rec : null;
  }
  const getFail = () => {
    const f = safe(() => JSON.parse(storage.getItem(FAIL_KEY) || 'null'), null);
    return f && Number.isFinite(f.n) && Number.isFinite(f.until) ? f : { n: 0, until: 0 };
  };
  const setSession = (on) => safe(() => (on ? session.setItem(SESSION_KEY, '1') : session.removeItem(SESSION_KEY)));
  async function matches(rec, pin) {
    if (!validPin(pin)) return false;
    return (await hash(pin, rec.s).catch(() => "")) === rec.h;
  }

  const hasPin = () => !!record();
  const isLocked = () => hasPin() && safe(() => session.getItem(SESSION_KEY), null) !== '1';

  async function write(newPin) {
    const salt = toHex(random.getRandomValues(new Uint8Array(16)));
    storage.setItem(PIN_KEY, JSON.stringify({ s: salt, h: await hash(newPin, salt) }));
    storage.removeItem(FAIL_KEY);
    setSession(true);
  }
  async function setPin(newPin, oldPin) {
    const cur = record();
    if (cur && !(await matches(cur, oldPin))) return { ok: false, code: 'wrong_old' };
    if (!validPin(newPin)) return { ok: false, code: 'format' };
    await write(newPin);
    if (!record()) return { ok: false, code: 'storage' }; // 저장소가 막힌 환경
    return { ok: true };
  }
  async function removePin(oldPin) {
    const cur = record();
    if (!cur) return { ok: true };
    if (!(await matches(cur, oldPin))) return { ok: false, code: 'wrong_old' };
    storage.removeItem(PIN_KEY); storage.removeItem(FAIL_KEY); setSession(false);
    return { ok: true };
  }
  async function doUnlock(pin) {
    const cur = record();
    if (!cur) { setSession(true); return { ok: true }; }
    const f = getFail(), t = now();
    if (f.until > t) return { ok: false, waitSec: Math.ceil((f.until - t) / 1000) };
    if (!validPin(pin)) return { ok: false, code: 'format' };
    if (await matches(cur, pin)) { storage.removeItem(FAIL_KEY); setSession(true); return { ok: true }; }
    const n = f.n + 1;
    const waitMs = n % 5 === 0 ? Math.min(600, 30 * Math.pow(2, n / 5 - 1)) * 1000 : 0; // 5번 틀릴 때마다 30초, 60초, 120초… 최대 600초
    storage.setItem(FAIL_KEY, JSON.stringify({ n, until: waitMs ? now() + waitMs : 0 }));
    return waitMs ? { ok: false, waitSec: waitMs / 1000 } : { ok: false, left: 5 - (n % 5) };
  }
  let chain = Promise.resolve(); // 연달아 눌러도 한 번에 하나씩 처리해야 오입력 횟수가 정확하다
  const unlock = (pin) => (chain = chain.then(() => doUnlock(pin), () => doUnlock(pin)));
  function lockNow() { if (hasPin()) setSession(false); }
  function onHidden() { hiddenAt = now(); }
  function onVisible() { if (hiddenAt && now() - hiddenAt >= relockMs) lockNow(); hiddenAt = 0; }
  function forgot() {
    storage.removeItem(SECRET_KEY); storage.removeItem(PIN_KEY); storage.removeItem(FAIL_KEY); setSession(false);
  }
  return { hasPin, setPin, removePin, unlock, isLocked, lockNow, onHidden, onVisible, forgot };
}
