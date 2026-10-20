// T7: 연결이 끊긴 동안 누른 동작은 대기하고, 복구되면 자동 전송된다 (앱을 새로고침해도 이어서 전송)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newWorld } from './harness.js';

let w, keys, it;
before(async () => { w = await newWorld(); keys = await w.seedFamily(); it = await w.items(keys.parentSecret); });
after(async () => { await w.teardown(); });

const RPC = '**/rest/v1/rpc/**';
const pending = async () => (await w.rpc('get_state', { p_secret: keys.parentSecret })).pending;

test('t07a 끊김 중 누르면 띠 + 요청 중 → 복구되면 자동 전송', async () => {
  const { child } = w;
  await child.locator('[data-tab="today"]').waitFor();
  await child.route(RPC, (route) => route.abort());
  await child.locator(`[data-card="${it.dish.id}"]`).click();
  await child.locator('#net:not([hidden])').waitFor();
  assert.equal(await child.locator(`[data-card="${it.dish.id}"]`).getAttribute('data-state'), 'sending');
  assert.equal((await pending()).length, 0);
  await child.unroute(RPC);
  await child.locator(`[data-card="${it.dish.id}"][data-state="waiting"]`).waitFor({ timeout: 8000 });
  assert.equal((await pending()).filter((r) => r.item_id === it.dish.id).length, 1);
  await child.locator('#net[hidden]').waitFor({ state: 'attached' });
});

test('t07b 끊김 중 누르고 앱을 새로고침해도 큐가 복원되어 전송된다', async () => {
  const { child } = w;
  await child.route(RPC, (route) => route.abort());
  await child.locator(`[data-card="${it.trash.id}"]`).click();
  await child.locator('#net:not([hidden])').waitFor();
  const q = await child.evaluate(() => localStorage.getItem('cc_queue_v1'));
  assert.ok(q && q.includes('request_item'), '큐가 저장돼 있다: ' + q);
  await child.unroute(RPC);
  await child.reload();
  await child.locator(`[data-card="${it.trash.id}"][data-state="waiting"]`).waitFor({ timeout: 8000 });
  assert.equal((await pending()).filter((r) => r.item_id === it.trash.id).length, 1);
  assert.deepEqual(w.errors, []);
});
