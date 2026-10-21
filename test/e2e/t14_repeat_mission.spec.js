// T14: 반복 미션 — 부모가 '여러 번 할 수 있어요'로 내면 승인돼도 닫히지 않고, 아들이 같은 날 또 신청할 수 있다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newWorld } from './harness.js';

let w, keys;
before(async () => { w = await newWorld(); keys = await w.seedFamily(); });
after(async () => { await w.teardown(); });

const st = () => w.rpc('get_state', { p_secret: keys.parentSecret });
const card = (title) => w.child.locator('[data-section="missions"] [data-card]', { hasText: title });

test('t14a 부모가 반복 미션과 일반 미션을 낸다 → 아들 화면에 뜨고 반복 표시', async () => {
  const { parent, child } = w;
  await parent.locator('#mTitle').fill('콩이 똥 치우기');
  await parent.locator('#mAmt').fill('3000');
  await parent.locator('#mRepeat').check();
  await parent.locator('#btnMission').click();
  await parent.locator('.mrow', { hasText: '콩이 똥 치우기' }).locator('small', { hasText: '반복' }).waitFor();
  await parent.locator('#mTitle').fill('방 대청소');
  await parent.locator('#mAmt').fill('10000');
  assert.equal(await parent.locator('#mRepeat').isChecked(), false, '내고 나면 체크가 풀린다');
  await parent.locator('#btnMission').click();
  await card('콩이 똥 치우기').waitFor();
  assert.match(await card('콩이 똥 치우기').innerText(), /여러 번/);
  await card('방 대청소').waitFor();
});

test('t14b 반복 미션은 승인 후에도 또 신청·승인된다 (완료 1번 → 2번), 잔고는 매번 반영', async () => {
  const { parent, child } = w;
  for (const n of [1, 2]) {
    await card('콩이 똥 치우기').click();
    await child.locator('[data-section="missions"] [data-card][data-state="waiting"]', { hasText: '콩이 똥 치우기' }).waitFor();
    const req = (await st()).pending.find((r) => r.label.includes('콩이 똥'));
    await parent.locator(`[data-decide="${req.id}"][data-ok="1"]`).click();
    await child.locator('[data-section="missions"] [data-card][data-state="done"]', { hasText: new RegExp(`완료 ${n}번`) }).waitFor();
  }
  assert.equal((await st()).family.balance, 6000);
  assert.deepEqual(w.errors, []);
});

test('t14c 일반 미션은 승인되면 끝 — 도장이 찍히고 다시 눌러도 신청되지 않는다', async () => {
  const { parent, child } = w;
  await card('방 대청소').click();
  await child.locator('[data-section="missions"] [data-card][data-state="waiting"]', { hasText: '방 대청소' }).waitFor();
  const req = (await st()).pending.find((r) => r.label.includes('방 대청소'));
  await parent.locator(`[data-decide="${req.id}"][data-ok="1"]`).click();
  const done = child.locator('[data-section="missions"] [data-card][data-state="done"]', { hasText: '방 대청소' });
  await done.waitFor();
  await done.locator('.stamp').waitFor();
  await done.click();
  await child.waitForTimeout(500);
  assert.equal((await st()).pending.length, 0);
  assert.equal((await st()).family.balance, 16000);
});
