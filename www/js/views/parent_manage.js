// 관리 탭: 벌금/보너스 · 월 학원비 · 항목 관리(금액 수정·추가·사용 해제)
const KINDS = [
  ['fixed', '생활비 (부모가 날짜별로 적용)'], ['optional', '선택 차감 (쓴 날 신청 → 승인 후 -)'], ['base', '앞가림 (하면 신청 → 승인 후 +)'],
  ['extra', '심부름 (여러 번 신청 → 승인 후 +)'], ['spend', '쓰기 (신청 → 승인 후 -)'],
];
const validAmt = (v) => { const raw = String(v ?? '').trim(); const n = Number(raw); return raw !== '' && Number.isInteger(n) && n > 0 && n <= 10000000 ? n : null; };

export function manageTab(ctx, s) {
  const { store, ui, drafts } = ctx;
  const { h, toast, fmt } = ui;

  async function adjust(sign) {
    const n = validAmt(drafts.v.adjAmt);
    if (n == null) return toast('금액은 1~10,000,000 사이의 정수로 입력해 주세요.', 'err');
    const r = await store.act('adjust', { p_amount: sign * n, p_reason: (drafts.v.adjReason || '').trim() });
    if (r.ok) { drafts.v.adjAmt = ''; drafts.v.adjReason = ''; toast(sign > 0 ? `${n.toLocaleString('ko-KR')}P 지급했어요` : `${n.toLocaleString('ko-KR')}P 차감했어요`, 'ok'); ctx.draw(); }
  }
  async function saveAcademy() {
    const raw = String(drafts.v.academy ?? s.family.academy_monthly).trim(), n = Number(raw);
    if (raw === '' || !Number.isInteger(n) || n < 0 || n > 10000000) return toast('월 학원비는 0~10,000,000 사이의 정수예요.', 'err');
    const r = await store.act('set_academy', { p_monthly: n });
    if (r.ok) { delete drafts.v.academy; toast('월 학원비를 저장했어요', 'ok'); ctx.draw(); }
  }
  async function saveItem(it) {
    const title = String(drafts.v['it:' + it.id + ':t'] ?? it.title).trim();
    const amt = it.slug === 'academy' ? Math.abs(it.amount) : validAmt(drafts.v['it:' + it.id + ':a'] ?? Math.abs(it.amount));
    const on = drafts.v['it:' + it.id + ':on'] ?? it.active;
    if (!title) return toast('이름을 입력해 주세요.', 'err');
    if (amt == null) return toast('금액은 1~10,000,000 사이의 정수로 입력해 주세요.', 'err');
    const r = await store.act('upsert_item', { p_item: it.id, p_kind: it.kind, p_title: title, p_descr: null, p_amount: it.slug === 'academy' ? it.amount : amt, p_active: !!on, p_survival: null });
    if (r.ok) { for (const k of ['t', 'a', 'on']) delete drafts.v['it:' + it.id + ':' + k]; toast('저장했어요', 'ok'); ctx.draw(); }
  }
  async function addItem() {
    const kind = drafts.v.newKind || 'extra', title = String(drafts.v.newTitle || '').trim(), amt = validAmt(drafts.v.newAmt);
    if (!title) return toast('이름을 입력해 주세요.', 'err');
    if (amt == null) return toast('금액은 1~10,000,000 사이의 정수로 입력해 주세요.', 'err');
    const r = await store.act('upsert_item', { p_item: null, p_kind: kind, p_title: title, p_descr: null, p_amount: amt, p_active: true, p_survival: false });
    if (r.ok) { drafts.v.newTitle = ''; drafts.v.newAmt = ''; toast('추가했어요', 'ok'); ctx.draw(); }
  }

  const itemRow = (it) => {
    const on = drafts.v['it:' + it.id + ':on'] ?? it.active;
    return h('div', { class: 'irow', 'data-item': it.id },
      ctx.input('it:' + it.id + ':t', { def: it.title, maxlength: '40', 'aria-label': '항목 이름' }),
      ctx.input('it:' + it.id + ':a', { def: String(Math.abs(it.amount)), type: 'number', inputmode: 'numeric', disabled: it.slug === 'academy', title: it.slug === 'academy' ? '위의 월 학원비에서 바꿔요' : null, 'aria-label': '금액' }),
      h('button', { class: 'btn small ghost', type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick: () => { drafts.v['it:' + it.id + ':on'] = !on; ctx.draw(); } }, on ? '사용 중' : '꺼짐'),
      h('button', { class: 'btn small', type: 'button', 'data-save-item': it.id, onclick: () => saveItem(it) }, '저장'));
  };

  return [
    h('section', { class: 'card' },
      h('h2', {}, '벌금 / 보너스'),
      h('label', { class: 'field' }, h('span', {}, '사유'), ctx.input('adjReason', { id: 'adjReason', maxlength: '60', placeholder: '예: 거짓말 벌금' })),
      h('label', { class: 'field' }, h('span', {}, '금액'), ctx.input('adjAmt', { id: 'adjAmt', type: 'number', inputmode: 'numeric', placeholder: '3000' })),
      h('div', { class: 'row2' },
        h('button', { id: 'btnPlus', class: 'btn primary', type: 'button', onclick: () => adjust(1) }, '+ 지급'),
        h('button', { id: 'btnMinus', class: 'btn danger', type: 'button', onclick: () => adjust(-1) }, '− 차감')),
      h('p', { class: 'muted' }, '벌금·보너스는 오늘 날짜로 기록돼요.')),
    h('section', { class: 'card' },
      h('h2', {}, '월 학원비'),
      h('label', { class: 'field' }, h('span', {}, '한 달 금액 (하루치 = 월 ÷ 30)'), ctx.input('academy', { id: 'academy', def: String(s.family.academy_monthly), type: 'number', inputmode: 'numeric' })),
      h('button', { id: 'btnAcademy', class: 'btn', type: 'button', onclick: saveAcademy }, '저장')),
    h('section', { class: 'card' },
      h('h2', {}, '항목 관리'),
      h('p', { class: 'muted' }, '금액은 숫자만 입력하세요. 차감 항목은 자동으로 −로 처리돼요. 없애고 싶은 항목은 "꺼짐"으로 두세요(내역은 그대로 남아요). 식비 금액은 하루 2끼 기준이에요.'),
      KINDS.map(([k, label]) => {
        const rows = (s.items || []).filter((i) => i.kind === k);
        return h('div', { class: 'igroup' }, h('div', { class: 'igroup-h' }, label), rows.length ? rows.map(itemRow) : h('p', { class: 'muted' }, '없음'));
      })),
    h('section', { class: 'card' },
      h('h2', {}, '새 항목 추가'),
      h('label', { class: 'field' }, h('span', {}, '종류'),
        h('select', { class: 'input', 'data-k': 'newKind', id: 'newKind', onchange: (e) => { drafts.v.newKind = e.target.value; } },
          KINDS.map(([k, l]) => h('option', { value: k, selected: (drafts.v.newKind || 'extra') === k }, l)))),
      h('label', { class: 'field' }, h('span', {}, '이름'), ctx.input('newTitle', { id: 'newTitle', maxlength: '40' })),
      h('label', { class: 'field' }, h('span', {}, '금액'), ctx.input('newAmt', { id: 'newAmt', type: 'number', inputmode: 'numeric' })),
      h('button', { id: 'btnAddItem', class: 'btn', type: 'button', onclick: addItem }, '추가')),
  ];
}
