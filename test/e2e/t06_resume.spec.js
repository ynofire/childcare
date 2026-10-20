// T6: 앱이 백그라운드에서 돌아오면 폴링 주기를 기다리지 않고 즉시 갱신한다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newWorld } from './harness.js';

let w, keys;
before(async () => { w = await newWorld({ pollMs: 600000 }); keys = await w.seedFamily(); });
after(async () => { await w.teardown(); });

test('t06 복귀(visible) 이벤트 직후 1초 안에 서버 변경이 보인다', async () => {
  const { child } = w;
  await child.locator('[data-tab="today"]').waitFor();
  await child.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await w.rpc('create_mission', { p_secret: keys.parentSecret, p_title: '복귀 테스트', p_amount: 1000 });
  await child.waitForTimeout(700);
  assert.equal(await child.locator('[data-card]', { hasText: '복귀 테스트' }).count(), 0, '숨겨진 동안은 갱신하지 않는다');
  await child.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await child.locator('[data-card]', { hasText: '복귀 테스트' }).waitFor({ timeout: 1000 });
  assert.deepEqual(w.errors, []);
});
