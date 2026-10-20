// Capacitor 플러그인(뒤로가기·공유·진동) 연결. 번들러 없이 쓰므로 core 를 vendor/ 에서 직접 불러 registerPlugin 으로 얻는다.
// 웹 브라우저(테스트 포함)에서는 아무것도 하지 않는다.
let plugins = null;

export async function initNative({ cap = globalThis.Capacitor, load = () => import('../vendor/capacitor-core.js') } = {}) {
  plugins = null;
  try {
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return false;
    const core = await load();
    plugins = { App: core.registerPlugin('App'), Share: core.registerPlugin('Share'), Haptics: core.registerPlugin('Haptics') };
    return true;
  } catch (e) {
    plugins = null;
    return false;
  }
}
export const plugin = (name) => (plugins && plugins[name]) || null;
