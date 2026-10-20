// 날짜 전환 줄 (아들·부모 화면 공용): 어제 · 오늘 · 날짜 고르기. 오늘은 day=null 로 두어 서버가 '오늘'을 정한다.
export function dayBar(s, store, ui) {
  const { h, addDays, fmtDate, toast } = ui;
  const yest = addDays(s.today, -1);
  const canY = yest >= s.start_date;
  const other = s.day !== s.today && s.day !== yest;
  const pick = h('input', { type: 'date', class: 'daypick', id: 'dayPick', value: s.day, min: s.start_date, max: s.today, 'aria-label': '날짜 고르기' });
  pick.addEventListener('change', () => {
    const v = pick.value;
    if (!v) return;
    if (v > s.today) { toast('미래 날짜는 고를 수 없어요.', 'err'); return; }
    if (v < s.start_date) { toast('운영 시작일(' + fmtDate(s.start_date) + ') 이전은 고를 수 없어요.', 'err'); return; }
    store.setDay(v === s.today ? null : v);
  });
  return h('div', { class: 'seg' },
    h('button', { id: 'segY', 'data-seg': 'y', type: 'button', class: 'seg-b' + (s.day === yest ? ' on' : ''), disabled: !canY, onclick: () => store.setDay(yest) }, '어제 ', fmtDate(yest)),
    h('button', { id: 'segT', 'data-seg': 't', type: 'button', class: 'seg-b' + (s.day === s.today ? ' on' : ''), onclick: () => store.setDay(null) }, '오늘 ', fmtDate(s.today)),
    h('label', { class: 'seg-b pick' + (other ? ' on' : '') }, other ? fmtDate(s.day) : '날짜', pick));
}
