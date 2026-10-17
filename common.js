// 가정 내 자본주의 — 공통 모듈 (Supabase 연동판)
// 잔고·규칙·날짜(한국 시간) 계산은 전부 서버(Supabase)가 맡고, 각 기기는 '열쇠'만 들고 있어요.
// SUPABASE_KEY 는 공개용(publishable) 키라 코드에 있어도 안전해요.
// 실제 권한은 서버 함수가 기기 열쇠로 검사합니다. (부모 열쇠 / 자녀 열쇠가 따로 있어요)
const SUPABASE_URL = 'https://ewepwpzqijwtaopzjiyr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Mak0IyKPToK7_tvGaM_D4Q_Pi1x5hqN';

const SECRET_KEY = 'cc_secret_v2';
const CACHE_KEY = 'cc_cache_v2';
const POLL_MS = 8000;

const ERR = {
  unauthorized: '이 기기의 연결이 해제됐어요. 다시 연결해 주세요.',
  forbidden: '권한이 없어요.',
  bankrupt: '파산 상태라 할 수 없어요.',
  blocked: '마이너스라 지금은 할 수 없어요.',
  insufficient: '포인트가 모자라요! 먼저 앞가림이나 심부름을 하세요.',
  duplicate: '이미 처리된 항목이에요.',
  invalid: '값이 올바르지 않아요.',
  invalid_day: '고를 수 없는 날짜예요. (운영 시작일 이전이거나 미래 날짜)',
  invalid_invite: '만료됐거나 이미 사용된 연결 링크예요. 부모님께 새 링크를 받아 주세요.',
  busy: '잠시 후 다시 시도해 주세요.',
  last_parent: '이 기기는 마지막 부모 기기라 해제할 수 없어요.',
  offline: '인터넷 연결을 확인해 주세요.',
};

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
function getSecret() { return lsGet(SECRET_KEY) || ''; }
function setSecret(s) { lsDel(CACHE_KEY); lsSet(SECRET_KEY, s); }
function clearSecret() { lsDel(SECRET_KEY); lsDel(CACHE_KEY); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(n) { return (n > 0 ? '+' : '') + Number(n).toLocaleString() + 'P'; }
function short(t) { return String(t).split(' (')[0]; }
function errText(e) { return ERR[e && e.code] || '문제가 생겼어요. 잠시 후 다시 해주세요. (' + (e && e.message) + ')'; }

// 날짜 도우미 (YYYY-MM-DD 문자열끼리만 계산해서 기기 시간대와 무관)
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
function ymd(ds) { return String(ds).split('-').map(Number); }
function addDays(ds, n) {
  const p = ymd(ds), t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0');
}
function fmtDate(ds) {
  const p = ymd(ds);
  return p[1] + '/' + p[2] + '(' + DOW[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()] + ')';
}

// Supabase 함수(RPC) 호출
async function rpc(fn, args) {
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
  if (SUPABASE_KEY.split('.').length === 3) headers.Authorization = 'Bearer ' + SUPABASE_KEY; // 옛날 방식(JWT) 키일 때만
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 15000);
  let res;
  try {
    res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST', headers, body: JSON.stringify(args || {}), signal: ctl.signal,
    });
  } catch (e) {
    throw Object.assign(new Error('offline'), { code: 'offline' });
  } finally { clearTimeout(to); }
  let body = null;
  try { body = await res.json(); } catch (e) {}
  if (!res.ok) {
    const msg = (body && body.message) || 'error';
    throw Object.assign(new Error(msg), { code: ERR[msg] ? msg : 'error', status: res.status });
  }
  return body;
}

// 화면 동기화: 몇 초마다 서버 상태를 가져와 그리고, 버튼 동작은 서버에 요청 → 응답 상태로 다시 그림
// day: 화면에서 보고 있는 날짜 (null = 오늘). 서버가 그 날짜 기준으로 체크/미션 상태를 내려줘요.
const Sync = (() => {
  let role = null, render = null, state = null, lastOk = null, day = null;
  let reqId = 0, applied = 0, busy = false;

  function banner(ok) {
    const n = document.getElementById('net');
    if (!n) return;
    if (ok) { n.style.display = 'none'; return; }
    n.style.display = 'block';
    n.textContent = '📡 연결 확인 중… (마지막 동기화 ' +
      (lastOk ? lastOk.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '없음') + ')';
  }
  function kick() { clearSecret(); location.replace('index.html'); }
  function onError(e) {
    if (e.code === 'unauthorized') return kick();
    if (e.code === 'offline') return banner(false);
    console.error(e);
  }
  function apply(s, id) {
    if (id < applied) return; // 더 늦게 보낸 요청의 응답이 이미 반영됐으면 오래된 응답은 버림
    applied = id; lastOk = new Date(); banner(true);
    if (s.role !== role) { location.replace('index.html'); return; }
    const sig = JSON.stringify(s);
    if (state && JSON.stringify(state) === sig) return;
    state = s; lsSet(CACHE_KEY, sig);
    render(s);
  }
  async function call(fn, args) {
    const id = ++reqId;
    const s = await rpc(fn, Object.assign({ p_secret: getSecret(), p_day: day }, args || {}));
    apply(s, id);
    return s;
  }
  async function poll() {
    if (document.hidden && state) return;
    try { await call('get_state'); } catch (e) { onError(e); }
  }
  async function act(fn, args) {
    if (busy) { if (state) render(state); return false; }
    busy = true;
    try { await call(fn, args); return true; }
    catch (e) {
      if (e.code === 'unauthorized') { kick(); return false; }
      alert(errText(e));
      if (state) render(state); // 화면을 서버 상태로 되돌림
      poll();
      return false;
    } finally { busy = false; }
  }
  function setDay(d) { day = d || null; return poll(); }
  function start(r, fn) {
    role = r; render = fn;
    if (!getSecret()) { location.replace('index.html'); return; }
    try {
      const c = JSON.parse(lsGet(CACHE_KEY) || 'null');
      if (c && c.role === r) { state = c; render(c); }
    } catch (e) {}
    poll();
    setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    window.addEventListener('focus', poll);
    window.addEventListener('online', poll);
  }
  async function signOut() {
    try { await rpc('sign_out', { p_secret: getSecret() }); }
    catch (e) {
      if (e.code === 'last_parent' || e.code === 'offline') { alert(errText(e)); return false; }
    }
    kick();
    return true;
  }
  return { start, act, poll, setDay, signOut, get state() { return state; }, get lastOk() { return lastOk; }, get day() { return day; } };
})();
