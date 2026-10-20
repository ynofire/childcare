// 부팅: 열쇠가 없으면 연결 화면, 있으면 서버에서 역할을 확인해 아들/부모 화면을 띄운다.
import { makeRpc, errText } from './api.js';
import { createStore } from './store.js';
import { POLL_MS } from './config.js';
import { storage, SECRET_KEY } from './storage.js';
import * as ui from './ui.js';
import { mountConnect } from './views/connect.js';

const root = document.getElementById('app');
const net = document.getElementById('net');
const rpc = makeRpc();
let unmount = null;
let booting = false;

function showRetry(onRetry) {
  const btn = ui.h('button', { class: 'btn primary', type: 'button', id: 'btnRetry' }, '다시 시도');
  btn.onclick = onRetry;
  root.replaceChildren(ui.h('main', { class: 'connect' },
    ui.h('div', { class: 'notice' }, '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'), btn));
}

export async function boot(notice) {
  if (booting) return;
  booting = true;
  try {
    if (unmount) { unmount(); unmount = null; }
    net.hidden = true;
    if (!storage.getItem(SECRET_KEY)) {
      unmount = mountConnect(root, { rpc, ui, onConnected: () => boot(), notice });
      return;
    }
    root.replaceChildren(ui.h('div', { class: 'splash' }, '연결 확인 중…'));
    const store = createStore({ rpc, storage, pollMs: POLL_MS });
    await store.refresh();
    if (!storage.getItem(SECRET_KEY)) { booting = false; return boot('이 기기의 연결이 해제돼 있어요. 새로 연결해 주세요.'); }
    if (!store.state) { showRetry(() => { booting = false; boot(); }); return; }

    const mod = store.state.role === 'parent' ? await import('./views/parent.js') : await import('./views/child.js');
    root.replaceChildren();
    const stopView = mod.mount(root, { store, ui, rpc, errText, reboot: () => boot() });
    const off = store.subscribe((s, meta) => {
      net.hidden = store.online;
      if (meta.error && meta.error.code === 'unauthorized') { booting = false; boot('이 기기의 연결이 해제됐어요. 새로 연결해 주세요.'); return; }
      if (meta.roleChanged) { booting = false; boot(); return; }
      if (meta.error && meta.error.fromAction && meta.error.fromAction !== 'get_state') ui.toast(errText({ code: meta.error.code }), 'err');
    });
    store.start();
    unmount = () => { off(); store.stop(); stopView(); };
  } finally {
    booting = false;
  }
}

boot();
