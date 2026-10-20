// 정산 탭: 고른 날짜의 생활비(고정 지출)를 적용. 항목별 제외·금액 직접 입력·식비 끼니(3·2·1·0).
export function settleTab(ctx, s) {
  const { ui, drafts, store } = ctx;
  const { h, fmt, fmtDate, shortTitle, toast } = ui;
  const fixed = (s.items || []).filter((i) => i.kind === 'fixed' && i.active);
  const todo = fixed.filter((i) => !(i.id in s.checks));

  // 항목별 기본 차감액(양수): 학원비는 월 학원비 일할, 식비는 끼니 수 × 끼니당 금액
  const defaultAmt = (it) => {
    if (it.slug === 'academy') return Math.round(s.family.academy_monthly / 30);
    if (it.slug === 'food') return drafts.meals * Math.round(Math.abs(it.amount) / 2);
    return Math.abs(it.amount);
  };
  const curVal = (it) => { const k = 'amt:' + it.id; return k in drafts.v ? drafts.v[k] : String(defaultAmt(it)); };

  function apply() {
    const skip = todo.filter((i) => drafts.skip[i.id]).map((i) => i.id);
    const amounts = {};
    for (const it of todo) {
      if (drafts.skip[it.id]) continue;
      const raw = String(curVal(it)).trim(), v = Number(raw);
      if (raw === '' || !Number.isInteger(v) || v < 0 || v > 10000000) { ctx.sheetNotice(`"${shortTitle(it.title)}" 금액을 0 이상의 정수로 입력해 주세요.`); return; }
      if (v !== defaultAmt(it)) amounts[it.id] = v; // 기본값과 같으면 서버 규칙대로
    }
    const before = s.family.balance, day = s.day;
    store.act('apply_fixed', { p_skip: skip, p_meals: drafts.meals, p_amounts: amounts }, { key: 'apply' }).then((r) => {
      if (!r.ok) return;
      const diff = store.state.family.balance - before;
      toast(`${fmtDate(day)} 생활비 ${Math.abs(diff).toLocaleString('ko-KR')}P 차감했어요`, 'ok');
      drafts.skip = {}; for (const k of Object.keys(drafts.v)) if (k.startsWith('amt:')) delete drafts.v[k];
      ctx.draw();
    });
  }

  const row = (it) => {
    const done = it.id in s.checks;
    if (done) {
      const a = s.checks[it.id];
      return h('div', { class: 'fix done', 'data-applied': it.id }, h('span', { class: 'fix-t' }, shortTitle(it.title), h('small', {}, ' · 적용됨')), h('b', { class: 't-amt ' + (a > 0 ? 'pos' : 'neg') }, fmt(a)));
    }
    const skipped = !!drafts.skip[it.id];
    const cur = Number(String(curVal(it)).trim());
    return h('div', { class: 'fix' + (skipped ? ' off' : '') },
      h('button', { class: 'fix-toggle', type: 'button', 'data-fix': it.id, 'aria-pressed': skipped ? 'false' : 'true', 'aria-label': shortTitle(it.title) + ' 차감 포함', onclick: () => { drafts.skip[it.id] = !skipped; ctx.draw(); } }, skipped ? '제외' : '차감'),
      h('span', { class: 'fix-t' }, shortTitle(it.title), it.descr ? h('small', {}, it.descr) : null),
      it.slug === 'food' ? h('select', { id: 'mealSel', class: 'input meal', 'aria-label': '식비 끼니 수', onchange: (e) => { drafts.meals = Number(e.target.value); delete drafts.v['amt:' + it.id]; ctx.draw(); } },
        [3, 2, 1, 0].map((n) => h('option', { value: String(n), selected: drafts.meals === n }, n + '끼' + (n === 0 ? '(외식)' : '')))) : null,
      h('span', { class: 'amtbox' },
        ctx.input('amt:' + it.id, { def: String(curVal(it)), class: 'input amt', type: 'number', inputmode: 'numeric', min: '0', step: '100', 'data-amt': it.id, disabled: skipped, 'aria-label': shortTitle(it.title) + ' 차감 금액' }), 'P'),
      h('span', { class: 'fix-sum t-amt neg' }, skipped ? '' : fmt(-(Number.isFinite(cur) ? Math.trunc(cur) : 0))));
  };

  return [
    h('section', { class: 'sec', 'data-section': 'settle' },
      h('h2', { class: 'sec-h' }, fmtDate(s.day) + ' 생활비', h('small', {}, '날짜별로 항목당 1회만 적용돼요')),
      h('p', { class: 'muted' }, '나갈 돈만 남기고 적용하세요. 외박·외식·학원 쉬는 날은 "제외"를 눌러요. 금액은 칸에서 직접 고칠 수 있어요.'),
      h('div', { class: 'fix-list' }, fixed.map(row)),
      h('button', { id: 'applyBtn', class: 'btn primary', type: 'button', disabled: !todo.length, onclick: apply }, todo.length ? '적용하기' : '이 날은 모두 적용됐어요')),
  ];
}
