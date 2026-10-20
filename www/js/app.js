// 부팅: 열쇠가 없으면 연결 화면, 있으면 서버에서 역할을 확인해 아들/부모 화면을 띄운다.
import { makeRpc, errText } from './api.js';
import { createStore } from './store.js';
import { POLL_MS } from './config.js';
import { storage, SECRET_KEY } from './storage.js';
import * as ui from './ui.js';
import { mountConnect } from './views/connect.js';
import { initNative, plugin } from './native.js';
import { createUpdateWatch } from './update.js';

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

// ---- 새 버전 알림 (안드로이드 앱에서만 동작: 설치된 빌드 번호를 알 수 있을 때) ----
// 테스트에서는 globalThis.__CC_BUILD__ 로 빌드 번호를 흉내낸다.
async function getBuild() {
  let n = null;
  if (globalThis.__CC_BUILD__ != null) n = Number(globalThis.__CC_BUILD__);
  else {
    const App = plugin('App');
    if (App && App.getInfo) { try { n = Number((await App.getInfo()).build); } catch (e) { n = null; } }
  }
  if (Number.isFinite(n)) document.documentElement.dataset.build = String(n); // 설정 화면의 '앱 버전' 표시용
  return Number.isFinite(n) ? n : null;
}
const upd = ui.h('div', { id: 'upd' });
upd.hidden = true;
net.after(upd);
const watch = createUpdateWatch({
  getBuild, storage, api: globalThis.__CC_RELEASES_API__ || undefined,
  onChange(info) {
    if (!info) { upd.hidden = true; upd.replaceChildren(); return; }
    upd.replaceChildren(
      ui.h('span', {}, `새 버전 v${info.build}이 있어요`),
      ui.h('a', { class: 'btn small primary', id: 'updGet', href: info.apk || info.url || '#' }, '받기'),
      ui.h('button', { class: 'btn small ghost', id: 'updLater', type: 'button', onclick: () => watch.dismiss() }, '나중에'));
    upd.hidden = false;
  },
});
window.addEventListener('cc:resume', () => watch.check());
setInterval(() => { if (!document.hidden) watch.check(); }, 60 * 60 * 1000);

// 안드로이드 앱에서만: 뒤로가기(열린 시트 닫기 → 없으면 앱 종료), 앱 복귀/일시정지를 화면·저장소에 알린다.
(async () => {
  const native = await initNative();
  watch.check();
  if (!native) return;
  const App = plugin('App');
  if (!App || !App.addListener) return;
  App.addListener('backButton', () => {
    const overlay = document.querySelector('.overlay');
    if (overlay) overlay.click(); else App.exitApp();
  });
  App.addListener('resume', () => window.dispatchEvent(new Event('cc:resume')));
  App.addListener('pause', () => window.dispatchEvent(new Event('cc:pause')));
})();

boot();
