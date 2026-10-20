// 화면 도우미: 요소 만들기(h), 토스트, 하단 시트, 확인 시트, 햅틱, 포커스를 지키는 다시 그리기, 탭 바.
// 원칙: 사용자 글자는 항상 textContent 로만 넣는다(HTML 문자열 삽입 금지) → XSS 불가.
export { fmt, money, addDays, fmtDate, shortTitle } from './format.js';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (c) => {
    if (Array.isArray(c)) c.forEach(add);
    else if (c == null || c === false) return;
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

export function toast(msg, kind = 'info') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = h('div', { class: 'toast ' + kind, role: 'status' }, msg);
  host.append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 4200 : 2800);
}

export function haptic() {
  try {
    const H = globalThis.Capacitor && globalThis.Capacitor.Plugins && globalThis.Capacitor.Plugins.Haptics;
    if (H && H.impact) H.impact({ style: 'LIGHT' });
    else if (navigator.vibrate) navigator.vibrate(8);
  } catch (e) { /* 햅틱은 없어도 됨 */ }
}

export function openSheet({ title, body, actions = [], onClose } = {}) {
  let closed = false;
  const close = () => { if (closed) return; closed = true; overlay.remove(); if (onClose) onClose(); };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
    title ? h('h2', { class: 'sheet-title' }, title) : null,
    body || null,
    actions.length ? h('div', { class: 'sheet-actions' }, actions.map((a) =>
      h('button', { class: 'btn ' + (a.kind || ''), type: 'button', onclick: () => { if (a.onclick) a.onclick(); if (a.close !== false) close(); } }, a.label))) : null);
  const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } }, sheet);
  document.body.append(overlay);
  return { close, el: sheet };
}

export function confirmSheet(msg, { okText = '확인', cancelText = '취소', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v) => { if (!answered) { answered = true; resolve(v); } };
    openSheet({
      title: msg,
      actions: [
        { label: cancelText, kind: 'ghost', onclick: () => answer(false) },
        { label: okText, kind: danger ? 'danger' : 'primary', onclick: () => answer(true) },
      ],
      onClose: () => answer(false),
    });
  });
}

// 다시 그리기: 입력 중인 칸(data-k)의 포커스·커서와 스크롤 위치를 지킨다.
export function rerender(container, build) {
  const ae = document.activeElement;
  const keep = ae && container.contains(ae) && ae.dataset && ae.dataset.k
    ? { k: ae.dataset.k, s: ae.selectionStart, e: ae.selectionEnd } : null;
  const y = window.scrollY;
  const node = build();
  container.replaceChildren(...[].concat(node).filter(Boolean));
  if (keep) {
    const el = container.querySelector('[data-k="' + keep.k.replace(/"/g, '\\"') + '"]');
    if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* 숫자 칸 등은 무시 */ } }
  }
  window.scrollTo(0, y);
}

// 하단 탭 바. tabs: [{id,label,icon}], badges: {id: number}
export function tabBar(tabs, current, onSelect, badges = {}) {
  return h('nav', { class: 'tabbar', role: 'tablist' }, tabs.map((t) =>
    h('button', {
      class: 'tab' + (t.id === current ? ' on' : ''), type: 'button', role: 'tab',
      'data-tab': t.id, 'aria-selected': t.id === current ? 'true' : 'false',
      onclick: () => { haptic(); onSelect(t.id); },
    },
    h('span', { class: 'tab-ico', 'aria-hidden': 'true' }, t.icon),
    h('span', { class: 'tab-label' }, t.label),
    badges[t.id] ? h('span', { class: 'tab-badge', 'data-tab-badge': t.id }, String(badges[t.id])) : null)));
}
