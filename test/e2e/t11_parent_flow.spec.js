// T11: 부모 전체 흐름 (UI 경로): 어제 날짜에서 미션 → 아들 표시 → 아들 요청 → 부모 배지 → 승인 → 아들 완료·잔고
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newWorld } from './harness.js';

let w, keys;
before(async () => { w = await newWorld(); keys = await w.seedFamily({ start: w.addDays(w.kstToday(), -10) }); });
after(async () => { await w.teardown(); });

test('t11a 부모가 어제 날짜에서 미션을 내고, 아들 요청 → 배지 → 승인 → 아들 완료', async () => {
  const { parent, child } = w;
  await parent.locator('[data-seg="y"]').click();
  await parent.locator('#segY.on').waitFor();
  await parent.locator('#mTitle').fill('화장실 청소');
  await parent.locator('#mAmt').fill('15000');
  await parent.locator('#btnMission').click();
  await parent.locator('.toast.ok').first().waitFor();
  assert.equal(await parent.locator('#mTitle').inputValue(), '', '내고 나면 입력칸이 비워진다');

  const card = child.locator('[data-section="missions"] [data-card]', { hasText: '화장실 청소' });
  await card.waitFor({ timeout: 5000 });
  await card.click();
  await child.locator('[data-section="missions"] [data-card][data-state="waiting"]').waitFor();

  await parent.locator('[data-tab-badge="home"]').waitFor();
  assert.equal((await parent.locator('[data-tab-badge="home"]').innerText()).trim(), '1');
  await parent.locator('[data-decide][data-ok="1"]').first().click();
  await child.locator('[data-section="missions"] [data-card][data-state="done"]').waitFor();
  await child.locator('#bal', { hasText: '15,000' }).waitFor();
  assert.equal(await parent.locator('[data-tab-badge="home"]').count(), 0);
  assert.deepEqual(w.errors, []);
});

test('t11b 미션 금액 10,000,001 은 안내만 하고 만들지 않으며, 10,000,000 은 만들어진다', async () => {
  const { parent } = w;
  const missions = async () => (await w.rpc('get_state', { p_secret: keys.parentSecret })).missions;
  const n0 = (await missions()).length;
  await parent.locator('#mTitle').fill('너무 큰 미션');
  await parent.locator('#mAmt').fill('10000001');
  await parent.locator('#btnMission').click();
  await parent.locator('.toast.err').first().waitFor();
  assert.equal((await missions()).length, n0);
  await parent.locator('#mAmt').fill('10000000');
  await parent.locator('#btnMission').click();
  await parent.locator('.toast.ok').first().waitFor();
  assert.equal((await missions()).length, n0 + 1);
});

test('t11c 거절하면 아들 카드는 거절됨, 부모가 미션을 지우면 아들 화면에서도 사라진다', async () => {
  const { parent, child } = w;
  await parent.locator('[data-tab="home"]').click();
  await child.locator('[data-section="missions"] [data-card]', { hasText: '너무 큰 미션' }).click();
  await child.locator('[data-section="missions"] [data-card][data-state="waiting"]').waitFor();
  await parent.locator('[data-decide][data-ok="0"]').first().click();
  await child.locator('[data-section="missions"] [data-card][data-state="rejected"]').waitFor();
  const del = parent.locator('[data-del-mission]').first();
  await del.click();
  await parent.locator('.sheet .btn.danger').click();
  await child.locator('[data-section="missions"] [data-card]', { hasText: '너무 큰 미션' }).waitFor({ state: 'detached' });
});

test('t11d 부모가 관리 탭에서 벌금을 주면 아들 잔고에 반영된다', async () => {
  const { parent, child } = w;
  const before = (await w.rpc('get_state', { p_secret: keys.parentSecret })).family.balance;
  await parent.locator('[data-tab="manage"]').click();
  await parent.locator('#adjReason').fill('거짓말 벌금');
  await parent.locator('#adjAmt').fill('3000');
  await parent.locator('#btnMinus').click();
  await parent.locator('.toast.ok').first().waitFor();
  await child.locator('#bal', { hasText: Number(before - 3000).toLocaleString('ko-KR') }).waitFor();
});
