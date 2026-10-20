// 부모 화면 (Task 6에서 완성). 지금은 탭 뼈대만.
export function mount(root, { store, ui }) {
  const { h, tabBar, rerender, fmt } = ui;
  let tab = 'home';
  function build() {
    const s = store.state;
    return [
      h('header', { class: 'topbar' }, h('div', { class: 'bal', id: 'bal' }, fmt(s.family.balance))),
      h('main', { class: 'view' }, h('p', { class: 'muted' }, '준비 중')),
      tabBar([{ id: 'home', label: '현황·승인', icon: '★' }, { id: 'settle', label: '정산', icon: '₩' }, { id: 'manage', label: '관리', icon: '✎' }, { id: 'settings', label: '설정', icon: '⚙' }], tab, (t) => { tab = t; draw(); }),
    ];
  }
  const draw = () => rerender(root, build);
  const off = store.subscribe(() => draw());
  draw();
  return () => off();
}
