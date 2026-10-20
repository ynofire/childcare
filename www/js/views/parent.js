// 부모 화면 셸: PIN 잠금 → 탭(현황·승인 / 정산 / 관리 / 설정). 입력 중인 값은 drafts 에 보관해서
// 폴링으로 화면이 다시 그려져도 값·커서가 유지된다. 한글 조합(IME) 중에는 다시 그리지 않는다.
import { storage } from '../storage.js';
import { createLock } from '../lock.js';
import { dayBar } from './daybar.js';
import { homeTab } from './parent_home.js';
import { settleTab } from './parent_settle.js';
import { manageTab } from './parent_manage.js';
import { settingsTab, pinCardHooks } from './parent_settings.js';

export function mount(root, { store, ui, rpc, errText, reboot }) {
  const { h, tabBar, rerender, money } = ui;
  const session = { getItem: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    setItem: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* 무시 */ } },
    removeItem: (k) => { try { sessionStorage.removeItem(k); } catch (e) { /* 무시 */ } } };
  const lock = createLock({ storage, session, subtle: globalThis.crypto && globalThis.crypto.subtle, now: () => Date.now() });
  let tab = 'home';
  const drafts = { v: {}, skip: {}, meals: 2, day: null, creds: null, invite: null, recovery: false, lockMsg: '' };
  let composing = false, dirty = false, lockShown = false;

  const ctx = {
    store, ui, rpc, errText, reboot, lock, drafts,
    draw: () => draw(),
    // 입력칸: 값은 drafts.v[key] 에 보관, data-k 로 다시 그린 뒤에도 포커스를 되찾는다
    input(key, attrs = {}) {
      return h('input', { class: 'input', 'data-k': key, value: drafts.v[key] ?? attrs.def ?? '', ...attrs, def: null,
        oninput: (e) => { drafts.v[key] = e.target.value; if (attrs.oninput) attrs.oninput(e); } });
    },
    async call(fn, args, okMsg) {
      const r = await store.act(fn, args);
      if (r.ok && okMsg) ui.toast(okMsg, 'ok');
      return r;
    },
    sheetNotice(msg) { ui.openSheet({ title: msg, actions: [{ label: '확인', kind: 'primary' }] }); },
  };

  function lockScreen() {
    const pin = h('input', { id: 'lockPin', class: 'input code-input', type: 'password', inputmode: 'numeric', maxlength: '6', autocomplete: 'off', 'aria-label': 'PIN' });
    const err = h('div', { id: 'lockErr', class: 'lock-err', role: 'alert' }, drafts.lockMsg);
    const open = async () => {
      const r = await lock.unlock(pin.value.trim());
      if (r.ok) { drafts.lockMsg = ''; draw(); return; }
      pin.value = '';
      drafts.lockMsg = r.waitSec ? `PIN이 여러 번 틀렸어요. ${r.waitSec}초 후에 다시 시도하세요.`
        : r.code === 'format' ? '4~6자리 숫자를 입력하세요.'
        : `PIN이 맞지 않아요. (${r.left}번 더 틀리면 잠시 막혀요)`;
      err.textContent = drafts.lockMsg;
    };
    pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    return h('main', { class: 'connect lock' },
      h('header', { class: 'brand' }, h('img', { src: 'icon.svg', alt: '', width: '56', height: '56' }), h('h1', {}, '부모 화면'), h('p', { class: 'muted' }, 'PIN을 입력하세요')),
      pin, err,
      h('button', { id: 'lockBtn', class: 'btn primary', type: 'button', onclick: open }, '열기'),
      h('button', { id: 'lockForgot', class: 'btn ghost', type: 'button', onclick: async () => {
        const ok = await ui.confirmSheet('PIN을 잊으셨나요? 이 기기의 연결을 해제하고, 복구 코드로 다시 연결해야 해요.', { okText: '연결 해제', danger: true });
        if (!ok) return;
        lock.forgot(); store.signOutLocal(); reboot();
      } }, 'PIN을 잊었어요'));
  }

  function build() {
    const s = store.state;
    if (lock.isLocked()) return lockScreen();
    if (drafts.day !== s.day) { drafts.day = s.day; drafts.skip = {}; drafts.meals = 2; for (const k of Object.keys(drafts.v)) if (k.startsWith('amt:')) delete drafts.v[k]; } // 날짜를 바꾸면 정산 선택값 초기화
    const pendingN = (s.pending || []).length;
    const body = tab === 'home' ? homeTab(ctx, s) : tab === 'settle' ? settleTab(ctx, s) : tab === 'manage' ? manageTab(ctx, s) : settingsTab(ctx, s);
    return [
      h('header', { class: 'topbar' },
        h('div', { class: 'bal' + (s.family.balance < 0 ? ' minus' : ''), id: 'bal' }, money(s.family.balance) + 'P'),
        h('div', { class: 'bal-sub muted' }, s.family.name + ' · ' + (s.status === 'bankrupt' ? '파산' : s.status === 'blocked' ? '마이너스(차단 중)' : '정상'))),
      h('main', { class: 'view', 'data-view': tab }, tab === 'home' || tab === 'settle' ? dayBar(s, store, ui) : null, body),
      tabBar([{ id: 'home', label: '현황·승인', icon: '★' }, { id: 'settle', label: '정산', icon: '₩' }, { id: 'manage', label: '관리', icon: '✎' }, { id: 'settings', label: '설정', icon: '⚙' }],
        tab, (t) => { tab = t; if (t === 'settings') pinCardHooks.refreshCreds(ctx); draw(); }, pendingN ? { home: pendingN } : {}),
    ];
  }

  function draw() {
    if (!store.state) return;
    if (composing) { dirty = true; return; }
    // 잠금 화면은 한 번만 그린다 (폴링으로 다시 그리면 입력 중인 PIN 이 지워진다)
    if (lock.isLocked()) { if (lockShown) return; lockShown = true; drafts.lockMsg = drafts.lockMsg || ''; } else lockShown = false;
    rerender(root, build);
  }
  const onCompStart = () => { composing = true; };
  const onCompEnd = () => { composing = false; if (dirty) { dirty = false; draw(); } };
  root.addEventListener('compositionstart', onCompStart);
  root.addEventListener('compositionend', onCompEnd);
  const onVis = () => { if (document.hidden) lock.onHidden(); else { lock.onVisible(); draw(); } };
  document.addEventListener('visibilitychange', onVis);

  const off = store.subscribe(() => draw());
  draw();
  return () => { off(); root.removeEventListener('compositionstart', onCompStart); root.removeEventListener('compositionend', onCompEnd); document.removeEventListener('visibilitychange', onVis); };
}
