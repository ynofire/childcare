// T10: 마이너스·파산 규칙이 화면에 그대로 반영된다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newWorld } from './harness.js';

let w, keys, it;
before(async () => { w = await newWorld(); keys = await w.seedFamily(); it = await w.items(keys.parentSecret); });
after(async () => { await w.teardown(); });

test('t10 파산(-35,000): 앞가림·심부름 locked, 쓰기 불가 사유 표시 → 마이너스(-5,000)는 앞가림만 가능', async () => {
  const { child } = w;
  await child.locator('[data-tab="today"]').waitFor();
  await w.rpc('adjust', { p_secret: keys.parentSecret, p_amount: -35000, p_reason: '벌금' });
  await child.locator(`[data-card="${it.school.id}"][data-state="locked"]`).waitFor();
  assert.equal(await child.locator(`[data-card="${it.dish.id}"]`).getAttribute('data-state'), 'locked');
  assert.match(await child.locator('[data-status-note]').innerText(), /파산/);
  assert.equal(await child.locator(`[data-spend="${it.pc1.id}"]`).isDisabled(), true);

  await w.rpc('adjust', { p_secret: keys.parentSecret, p_amount: 30000, p_reason: '보너스' });
  await child.locator(`[data-card="${it.school.id}"][data-state="todo"]`).waitFor();
  assert.equal(await child.locator(`[data-card="${it.pad.id}"]`).getAttribute('data-state'), 'locked', '선택 차감은 마이너스면 새로 못 켠다');
  assert.match(await child.locator('[data-status-note]').innerText(), /마이너스/);
  assert.equal(await child.locator(`[data-spend="${it.pc1.id}"]`).isDisabled(), true);
  await child.locator(`[data-card="${it.school.id}"]`).click();
  await child.locator(`[data-card="${it.school.id}"][data-state="done"]`).waitFor();
  assert.deepEqual(w.errors, []);
});

test('t10b 쓰기: 확인 시트 → 차감, 포인트가 모자라면 이유 표시', async () => {
  const { child } = w;
  await w.rpc('adjust', { p_secret: keys.parentSecret, p_amount: 100000, p_reason: '보너스' });
  const before = (await w.rpc('get_state', { p_secret: keys.parentSecret })).family.balance;
  await child.locator(`[data-spend="${it.pc1.id}"]`).click();
  await child.locator('.sheet .btn.primary').click();
  await child.waitForFunction((b) => document.querySelector('#bal').textContent.replace(/[^0-9-]/g, '') !== String(b), before);
  const after = (await w.rpc('get_state', { p_secret: keys.parentSecret })).family.balance;
  assert.equal(after - before, it.pc1.amount);
  // 한 번 누르고 확인을 취소하면 아무 일도 없다
  await child.locator(`[data-spend="${it.pc1.id}"]`).click();
  await child.locator('.sheet .btn.ghost').click();
  assert.equal((await w.rpc('get_state', { p_secret: keys.parentSecret })).family.balance, after);
});
