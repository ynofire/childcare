// 아들 화면: 오늘(할 일 카드) · 내역 · 설정.
// 카드는 체크박스가 아니라 '상태 카드'다. 상태는 cardState(서버 상태 + 큐)에서만 계산되고, 누르면 의도를 큐에 넣을 뿐이다.
import { cardState, pendingKey } from '../cardstate.js';
import { storage, SECRET_KEY } from '../storage.js';

const SEEN_KEY = 'cc_seen_v1';
const STATE_LABEL = { todo: '', sending: '보내는 중…', waiting: '승인 대기', done: '완료', rejected: '거절됨 · 다시 하기', locked: '지금은 못 해요' };

export function mount(root, { store, ui, rpc, reboot }) {
  const { h, tabBar, rerender, fmt, money, addDays, fmtDate, shortTitle, toast, haptic, confirmSheet } = ui;
  let tab = 'today';
  const intent = new Map();   // 앞가림 카드: 보내는 중에 다시 누르면 의도를 뒤집는다 (id → 마지막 의도)
  let prevStates = new Map(); // 카드별 직전 상태 (승인·거절 알림용)
  let seenMax = null;

  // ---- 새 미션(NEW) 표시 ----
  const maxMissionId = (s) => (s.missions || []).reduce((m, x) => Math.max(m, Number(x.id)), 0);
  function loadSeen(s) {
    if (seenMax != null) return;
    const raw = storage.getItem(SEEN_KEY);
    seenMax = raw == null ? null : Number(raw);
    if (seenMax == null || Number.isNaN(seenMax)) { seenMax = maxMissionId(s); storage.setItem(SEEN_KEY, String(seenMax)); } // 처음 켠 날엔 기존 미션을 NEW 로 치지 않는다
  }
  const isNew = (m) => Number(m.id) > seenMax && m.status === 'open';
  const newCount = (s) => (s.missions || []).filter(isNew).length;
  function markSeen() {
    const s = store.state;
    if (!s || seenMax == null) return;
    const mx = Math.max(seenMax, maxMissionId(s));
    if (mx !== seenMax) { seenMax = mx; storage.setItem(SEEN_KEY, String(mx)); }
  }
  const onHide = () => { if (document.hidden) { markSeen(); } };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', markSeen);

  // ---- 카드 ----
  function tapCard(kind, it, state) {
    haptic();
    const id = it.id;
    if (kind === 'base' || kind === 'optional') {
      if (state === 'locked') return;
      let on;
      if (state === 'sending') { if (!intent.has(id)) return; on = !intent.get(id); }
      else on = state !== 'done';
      intent.set(id, on);
      store.act('toggle_item', { p_item: id, p_on: on }, { key: pendingKey(kind, id) });
      return;
    }
    if (state !== 'todo' && state !== 'rejected') return;
    if (kind === 'extra') store.act('request_extra', { p_item: id }, { key: pendingKey('extra', id) });
    else store.act('request_mission', { p_mission: id }, { key: pendingKey('mission', id) });
  }

  function card(kind, it, s, pending, extra) {
    const state = cardState(kind, it.id, s, pending);
    const amount = Number(it.amount);
    const label = STATE_LABEL[state];
    return h('button', {
      class: 'task ' + kind, type: 'button', 'data-card': it.id, 'data-state': state,
      'aria-disabled': state === 'locked' ? 'true' : null,
      onclick: () => tapCard(kind, it, state),
    },
    h('span', { class: 'task-main' },
      h('span', { class: 't-title' }, kind === 'mission' ? it.title : shortTitle(it.title)),
      kind === 'mission' && extra && extra.isNew ? h('span', { class: 'new-badge', 'data-badge': 'new' }, 'NEW') : null,
      it.descr ? h('span', { class: 't-sub' }, it.descr) : null),
    h('span', { class: 'task-side' },
      h('span', { class: 't-amt ' + (amount < 0 ? 'neg' : 'pos') }, fmt(amount)),
      label ? h('span', { class: 't-state' }, label) : null),
    state === 'done' && (kind === 'extra' || kind === 'mission') ? h('span', { class: 'stamp', 'aria-hidden': 'true' }, '승인') : null,
    state === 'done' && (kind === 'base' || kind === 'optional') ? h('span', { class: 'tick', 'aria-hidden': 'true' }, '✓') : null);
  }

  const section = (key, title, hint, cards) => cards.length
    ? h('section', { class: 'sec', 'data-section': key }, h('h2', { class: 'sec-h' }, title, hint ? h('small', {}, hint) : null), h('div', { class: 'cards' }, cards))
    : null;

  // ---- 오늘 탭 ----
  function dayBar(s) {
    const yest = addDays(s.today, -1);
    const canY = yest >= s.start_date;
    const other = s.day !== s.today && s.day !== yest;
    const pick = h('input', { type: 'date', class: 'daypick', id: 'dayPick', value: s.day, min: s.start_date, max: s.today, 'aria-label': '날짜 고르기' });
    pick.addEventListener('change', () => {
      const v = pick.value;
      if (!v || v < s.start_date || v > s.today) return;
      store.setDay(v === s.today ? null : v);
    });
    return h('div', { class: 'seg' },
      h('button', { id: 'segY', 'data-seg': 'y', type: 'button', class: 'seg-b' + (s.day === yest ? ' on' : ''), disabled: !canY, onclick: () => store.setDay(yest) }, '어제 ', fmtDate(yest)),
      h('button', { id: 'segT', 'data-seg': 't', type: 'button', class: 'seg-b' + (s.day === s.today ? ' on' : ''), onclick: () => store.setDay(null) }, '오늘 ', fmtDate(s.today)),
      h('label', { class: 'seg-b pick' + (other ? ' on' : '') }, other ? fmtDate(s.day) : '날짜', pick));
  }

  function statusNote(s) {
    if (s.status === 'bankrupt') return h('div', { class: 'status-note bankrupt', 'data-status-note': 'bankrupt' }, '파산 상태예요. 부모님과 이야기해서 다시 시작해 보세요. 지금은 할 수 있는 게 없어요.');
    if (s.status === 'blocked') return h('div', { class: 'status-note blocked', 'data-status-note': 'blocked' }, '잔고가 마이너스예요. 앞가림을 해서 먼저 플러스로 만들어요. (선택 차감과 쓰기는 잠겨요)');
    return null;
  }

  function spendBtn(it, s) {
    const amt = Number(it.amount);
    let reason = '';
    if (s.day !== s.today) reason = '';
    else if (s.status !== 'ok') reason = s.status === 'bankrupt' ? '파산 상태라 쓸 수 없어요' : '마이너스라 쓸 수 없어요';
    else if (s.family.balance < -amt) reason = '포인트가 모자라요';
    return h('div', { class: 'spend-row' },
      h('button', {
        class: 'spend', type: 'button', 'data-spend': it.id, disabled: !!reason,
        onclick: async () => {
          haptic();
          const ok = await confirmSheet(`${shortTitle(it.title)} — ${money(-amt)}P를 쓸까요?`, { okText: '쓰기' });
          if (!ok) return;
          const r = await store.act('consume', { p_item: it.id });
          if (r.ok) toast(`${shortTitle(it.title)} 사용! ${fmt(amt)}`, 'ok');
        },
      }, h('span', { class: 't-title' }, shortTitle(it.title)), h('span', { class: 't-amt neg' }, fmt(amt))),
      reason ? h('span', { class: 'reason' }, reason) : null);
  }

  function fixedCard(s, fixed) {
    if (!fixed.length) return null;
    const applied = (it) => (s.txs || []).some((x) => x.day === s.day && x.label.startsWith(shortTitle(it.title)));
    const total = fixed.reduce((a, it) => a + Number(it.amount), 0);
    return h('section', { class: 'sec', 'data-section': 'fixed' },
      h('h2', { class: 'sec-h' }, '매일 자동 차감', h('small', {}, '부모님이 정산할 때 빠져요')),
      h('div', { class: 'fixed-list' }, fixed.map((it) => h('div', { class: 'fixed-row' + (applied(it) ? ' applied' : '') },
        h('span', {}, shortTitle(it.title)),
        h('span', { class: 't-amt neg' }, applied(it) ? '반영됨 ' + fmt(Number(it.amount)) : fmt(Number(it.amount)))))),
      h('div', { class: 'fixed-total muted' }, '하루 합계 ' + fmt(total)));
  }

  function todayTab(s) {
    const pending = store.pending;
    const items = s.items || [];
    const of = (k) => items.filter((i) => i.kind === k);
    const ms = (s.missions || []).slice().sort((a, b) => (a.status === 'done') - (b.status === 'done') || a.id - b.id);
    return [
      statusNote(s),
      dayBar(s),
      section('missions', '시킨 일', '날짜와 상관없이 남아 있어요', ms.map((m) => card('mission', { id: m.id, title: m.title, amount: m.amount, descr: '' }, s, pending, { isNew: isNew(m) }))),
      section('base', '앞가림', '했으면 눌러요', of('base').map((i) => card('base', i, s, pending))),
      section('extra', '심부름', '하고 눌러서 신청해요', of('extra').map((i) => card('extra', i, s, pending))),
      section('optional', '내가 고르는 것', null, of('optional').map((i) => card('optional', i, s, pending))),
      s.day === s.today ? section('spend', '포인트 쓰기', null, of('spend').map((i) => spendBtn(i, s))) : null,
      fixedCard(s, of('fixed')),
    ];
  }

  // ---- 내역 탭 ----
  function historyTab(s) {
    const txs = s.txs || [];
    if (!txs.length) return [h('p', { class: 'empty' }, '아직 내역이 없어요. 앞가림을 하면 여기에 쌓여요.')];
    const groups = [];
    for (const x of txs) {
      let g = groups[groups.length - 1];
      if (!g || g.day !== x.day) { g = { day: x.day, rows: [] }; groups.push(g); }
      g.rows.push(x);
    }
    return groups.map((g) => h('section', { class: 'sec' },
      h('h2', { class: 'sec-h' }, fmtDate(g.day)),
      h('ul', { class: 'tx-list' }, g.rows.map((x) => h('li', { class: 'tx' },
        h('span', { class: 'tx-l' }, x.label),
        h('span', { class: 'tx-r' }, h('b', { class: Number(x.amount) < 0 ? 'neg' : 'pos' }, fmt(Number(x.amount))), h('small', {}, money(x.balance) + 'P')))))));
  }

  // ---- 설정 탭 ----
  function settingsTab(s) {
    const t = store.lastSyncAt ? new Date(store.lastSyncAt) : null;
    const hhmm = t ? String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0') : '아직 없음';
    return [
      h('section', { class: 'card' },
        h('h2', {}, s.family.name),
        h('div', { class: 'kv' }, h('span', {}, '연결 상태'), h('b', { 'data-conn': store.online ? 'on' : 'off' }, store.online ? '연결됨' : '끊김 (다시 연결 중)')),
        h('div', { class: 'kv' }, h('span', {}, '마지막 동기화'), h('b', {}, hhmm)),
        h('div', { class: 'kv' }, h('span', {}, '운영 시작일'), h('b', {}, fmtDate(s.start_date)))),
      h('section', { class: 'card' },
        h('h2', {}, '이 기기 연결 끊기'),
        h('p', { class: 'muted' }, '끊으면 이 폰에서는 장부를 볼 수 없어요. 다시 쓰려면 부모님께 새 코드를 받아야 해요.'),
        h('button', { class: 'btn danger', id: 'btnSignOut', type: 'button', onclick: async () => {
          const ok = await confirmSheet('이 기기의 연결을 끊을까요?', { okText: '끊기', danger: true });
          if (!ok) return;
          try { await rpc('sign_out', { p_secret: storage.getItem(SECRET_KEY) || '' }); } catch (e) { /* 서버가 안 받아도 로컬은 끊는다 */ }
          store.signOutLocal();
          reboot();
        } }, '연결 끊기')),
    ];
  }

  // ---- 조립 ----
  function build() {
    const s = store.state;
    loadSeen(s);
    const n = newCount(s);
    const body = tab === 'today' ? todayTab(s) : tab === 'history' ? historyTab(s) : settingsTab(s);
    return [
      h('header', { class: 'topbar' },
        h('div', { class: 'bal' + (s.family.balance < 0 ? ' minus' : ''), id: 'bal' }, money(s.family.balance) + 'P'),
        h('div', { class: 'bal-sub muted' }, s.family.name)),
      h('main', { class: 'view', 'data-view': tab }, body),
      tabBar([{ id: 'today', label: '오늘', icon: '★' }, { id: 'history', label: '내역', icon: '≡' }, { id: 'settings', label: '설정', icon: '⚙' }],
        tab, (t) => { if (tab === 'today') markSeen(); tab = t; draw(); }, tab !== 'today' && n ? { today: n } : {}),
    ];
  }

  // 승인/거절 알림: 대기 중이던 카드가 바뀌면 한 번 알려준다
  function announce(s) {
    const pending = store.pending;
    const next = new Map();
    const note = (kind, id, title) => {
      const key = kind + ':' + id, st = cardState(kind, id, s, pending);
      next.set(key, st);
      const was = prevStates.get(key);
      if (was === 'waiting' && st === 'done') { toast(`${title} 승인됐어요!`, 'ok'); haptic(); }
      else if (was === 'waiting' && st === 'rejected') toast(`${title} 거절됐어요. 다시 해볼 수 있어요.`, 'err');
    };
    for (const i of s.items || []) if (i.kind === 'extra') note('extra', i.id, shortTitle(i.title));
    for (const m of s.missions || []) note('mission', m.id, m.title);
    prevStates = next;
  }

  const draw = () => { if (store.state) rerender(root, build); };
  const off = store.subscribe((s) => {
    if (!s) return;
    for (const id of [...intent.keys()]) if (!store.pending.has(pendingKey('base', id)) && !store.pending.has(pendingKey('optional', id))) intent.delete(id);
    announce(s);
    draw();
  });
  if (store.state) announce(store.state);
  draw();
  return () => { markSeen(); off(); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', markSeen); };
}
