import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initNative, plugin } from '../../www/js/native.js';

test('n1 웹 브라우저(Capacitor 없음)에서는 플러그인이 없고 예외도 없다', async () => {
  assert.equal(await initNative({ cap: undefined, load: async () => { throw new Error('호출되면 안 됨'); } }), false);
  assert.equal(plugin('Haptics'), null);
});

test('n2 안드로이드 앱(Capacitor 네이티브)에서는 App·Share·Haptics 를 registerPlugin 으로 얻는다', async () => {
  const cap = { isNativePlatform: () => true };
  const ok = await initNative({ cap, load: async () => ({ registerPlugin: (n) => ({ name: n }) }) });
  assert.equal(ok, true);
  assert.deepEqual(['App', 'Share', 'Haptics'].map((n) => plugin(n).name), ['App', 'Share', 'Haptics']);
});

test('n3 코어를 불러오지 못해도 앱은 계속 동작한다 (플러그인 없음으로 처리)', async () => {
  const ok = await initNative({ cap: { isNativePlatform: () => true }, load: async () => { throw new Error('404'); } });
  assert.equal(ok, false);
  assert.equal(plugin('App'), null);
});
