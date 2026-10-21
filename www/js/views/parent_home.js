// 현황·승인 탭: 승인 대기, 미션 내기, 최근 처리, 최근 내역
export function homeTab(ctx, s) {
  const { store, ui, drafts } = ctx;
  const { h, fmt, fmtDate, toast, confirmSheet, money } = ui;
  const pending = store.pending;

  const reqCard = (r) => {
    const busy = pending.has('decide:' + r.id);
    const decide = (ok) => store.act('decide_request', { p_request: r.id, p_ok: ok }, { key: 'decide:' + r.id })
      .then((res) => { if (res.ok) toast(ok ? '승인했어요' : '거절했어요', 'ok'); });
    return h('div', { class: 'req', 'data-req': r.id },
      h('div', { class: 'req-main' },
        h('span', { class: 't-title' }, r.label),
        h('span', { class: 't-sub' }, fmtDate(r.day) + (r.day === s.today ? ' (오늘)' : ''))),
      h('span', { class: 't-amt ' + (Number(r.amount) < 0 ? 'neg' : 'pos') }, fmt(Number(r.amount))),
      h('div', { class: 'req-btns' },
        h('button', { class: 'btn small ghost', type: 'button', 'data-decide': r.id, 'data-ok': '0', disabled: busy, onclick: () => decide(false) }, '거절'),
        h('button', { class: 'btn small primary', type: 'button', 'data-decide': r.id, 'data-ok': '1', disabled: busy, onclick: () => decide(true) }, '승인')));
  };

  async function makeMission() {
    const title = (drafts.v.mTitle || '').trim(), raw = String(drafts.v.mAmt || '').trim(), amt = Number(raw);
    if (!title) return toast('미션 내용을 입력해 주세요.', 'err');
    if (raw === '' || !Number.isInteger(amt) || amt <= 0 || amt > 10000000) return toast('포인트는 1~10,000,000 사이의 정수로 입력해 주세요.', 'err');
    const r = await store.act('create_mission', { p_title: title, p_amount: amt, p_repeat: !!drafts.v.mRepeat });
    if (r.ok) { drafts.v.mTitle = ''; drafts.v.mAmt = ''; drafts.v.mRepeat = false; toast('미션을 냈어요. 아들 폰에 바로 보여요.', 'ok'); ctx.draw(); }
  }

  const openMissions = (s.missions || []).filter((m) => m.status !== 'done');
  const recent = (s.recent || []).slice(0, 6);
  return [
    h('section', { class: 'sec', 'data-section': 'pending' },
      h('h2', { class: 'sec-h' }, '승인 대기', h('small', {}, (s.pending || []).length ? (s.pending.length + '건') : '')),
      (s.pending || []).length ? h('div', { class: 'cards' }, s.pending.map(reqCard)) : h('p', { class: 'empty small' }, '기다리는 요청이 없어요.')),
    h('section', { class: 'card', 'data-section': 'mission' },
      h('h2', {}, '미션 내기'),
      h('p', { class: 'muted' }, '날짜와 상관없이, 아들이 완료할 때까지 계속 보여요.'),
      h('label', { class: 'field' }, h('span', {}, '내용'), ctx.input('mTitle', { id: 'mTitle', maxlength: '40', placeholder: '예: 베란다 대청소', 'aria-label': '미션 내용' })),
      h('label', { class: 'field' }, h('span', {}, '포인트'), ctx.input('mAmt', { id: 'mAmt', type: 'number', inputmode: 'numeric', placeholder: '10000', 'aria-label': '미션 포인트' })),
      h('label', { class: 'check-row' },
        h('input', { type: 'checkbox', id: 'mRepeat', 'data-k': 'mRepeat', checked: !!drafts.v.mRepeat, onchange: (e) => { drafts.v.mRepeat = e.target.checked; } }),
        h('span', {}, '여러 번 할 수 있어요 (승인해도 계속 남아요 · 예: 강아지 똥 치우기)')),
      h('button', { id: 'btnMission', class: 'btn primary', type: 'button', onclick: makeMission }, '미션 내기'),
      openMissions.length ? h('ul', { class: 'mlist' }, openMissions.map((m) => h('li', { class: 'mrow' },
        h('span', { class: 'mrow-t' }, m.title, h('small', {}, (m.repeatable ? ' · 반복' : '') + (m.status === 'wait' ? ' · 승인 대기' : ''))),
        h('b', { class: 't-amt pos' }, fmt(Number(m.amount))),
        h('button', { class: 'btn small ghost', type: 'button', 'data-del-mission': m.id, 'aria-label': '미션 지우기', onclick: async () => {
          const ok = await confirmSheet(`"${m.title}" 미션을 지울까요?`, { okText: '지우기', danger: true });
          if (ok) store.act('delete_mission', { p_mission: m.id }).then((r) => { if (r.ok) toast('지웠어요', 'ok'); });
        } }, '지우기')))) : null),
    recent.length ? h('section', { class: 'sec' },
      h('h2', { class: 'sec-h' }, '최근 처리'),
      h('ul', { class: 'tx-list' }, recent.map((r) => h('li', { class: 'tx' },
        h('span', { class: 'tx-l' }, r.label),
        h('span', { class: 'tx-r' }, h('b', { class: r.status === 'done' ? 'pos' : 'neg' }, r.status === 'done' ? '승인' : '거절'), h('small', {}, fmt(Number(r.amount)))))))) : null,
    (s.txs || []).length ? h('section', { class: 'sec' },
      h('h2', { class: 'sec-h' }, '최근 내역'),
      h('ul', { class: 'tx-list' }, s.txs.slice(0, 10).map((x) => h('li', { class: 'tx' },
        h('span', { class: 'tx-l' }, h('small', { class: 'tx-d' }, fmtDate(x.day) + ' '), x.label),
        h('span', { class: 'tx-r' }, h('b', { class: Number(x.amount) < 0 ? 'neg' : 'pos' }, fmt(Number(x.amount))), h('small', {}, money(x.balance) + 'P')))))) : null,
  ];
}
