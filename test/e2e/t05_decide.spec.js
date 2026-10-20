// T5: 요청 → 승인/거절 → 아들 화면 반영, 같은 항목 중복 요청은 한글 안내
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newWorld } from './harness.js';

let w, keys, it;
before(async () => { w = await newWorld(); keys = await w.seedFamily(); it = await w.items(keys.parentSecret); });
after(async () => { await w.teardown(); });

const pendingOf = async (id) => (await w.rpc('get_state', { p_secret: keys.parentSecret })).pending.find((r) => r.item_id === id);
const bal = async () => (await w.rpc('get_state', { p_secret: keys.parentSecret })).family.balance;

test('t05a 심부름 요청 → 부모 승인 → 아들 카드 "완료 1번" + 잔고 증가', async () => {
  const { child } = w;
  const card = child.locator(`[data-card="${it.dish.id}"]`);
  await card.click();
  await child.locator(`[data-card="${it.dish.id}"][data-state="waiting"]`).waitFor();
  const r = await pendingOf(it.dish.id);
  await w.parent.locator(`[data-decide="${r.id}"][data-ok="1"]`).click();
  await child.locator(`[data-card="${it.dish.id}"][data-state="done"]`).waitFor();
  assert.match(await card.innerText(), /완료 1번/);
  assert.equal(await bal(), it.dish.amount);
  assert.match(await child.locator('#bal').innerText(), new RegExp(Number(it.dish.amount).toLocaleString('ko-KR')));
});

test('t05a2 같은 심부름을 또 하면 완료 2번이 된다', async () => {
  const { child } = w;
  const card = child.locator(`[data-card="${it.dish.id}"]`);
  await child.waitForTimeout(800);
  await card.click();
  await child.waitForFunction((id) => /승인 대기 1/.test(document.querySelector(`[data-card="${id}"]`).innerText), it.dish.id);
  const r = await pendingOf(it.dish.id);
  await w.parent.locator(`[data-decide="${r.id}"][data-ok="1"]`).click();
  await child.waitForFunction((id) => /완료 2번/.test(document.querySelector(`[data-card="${id}"]`).innerText), it.dish.id);
  assert.equal(await bal(), it.dish.amount * 2);
});

test('t05b 앞가림 거절 → rejected(다시 하기) → 다시 신청하면 waiting, 잔고는 그대로', async () => {
  const { child } = w;
  const before = await bal();
  await child.locator(`[data-card="${it.school.id}"]`).click();
  await child.locator(`[data-card="${it.school.id}"][data-state="waiting"]`).waitFor();
  const r = await pendingOf(it.school.id);
  await w.parent.locator(`[data-decide="${r.id}"][data-ok="0"]`).click();
  const card = child.locator(`[data-card="${it.school.id}"][data-state="rejected"]`);
  await card.waitFor();
  assert.match(await card.innerText(), /다시 하기/);
  assert.equal(await bal(), before);
  await card.click();
  await child.locator(`[data-card="${it.school.id}"][data-state="waiting"]`).waitFor();
  const r2 = await pendingOf(it.school.id);
  await w.parent.locator(`[data-decide="${r2.id}"][data-ok="1"]`).click();
  await child.locator(`[data-card="${it.school.id}"][data-state="done"]`).waitFor();
  await child.locator(`[data-card="${it.school.id}"] .stamp`).waitFor();
  assert.equal(await bal(), before + it.school.amount);
});

test('t05b2 심부름 거절 → 잔고 그대로, 카드는 다시 누를 수 있는 todo', async () => {
  const { child } = w;
  const before = await bal();
  await child.locator(`[data-card="${it.trash.id}"]`).click();
  await child.locator(`[data-card="${it.trash.id}"][data-state="waiting"]`).waitFor();
  const r = await pendingOf(it.trash.id);
  await w.parent.locator(`[data-decide="${r.id}"][data-ok="0"]`).click();
  await child.locator(`[data-card="${it.trash.id}"][data-state="todo"]`).waitFor();
  assert.equal(await bal(), before);
});

test('t05c 다른 기기에서 이미 승인된 앞가림을 누르면 한글 안내 후 서버 상태로 돌아온다', async () => {
  const { child } = w;
  // 이 시나리오만 폴링을 멈춰 화면이 일부러 오래된 상태가 되게 한다
  await child.evaluate(() => { window.__stale = true; });
  await child.route('**/rest/v1/rpc/get_state', (route) => route.abort());
  // 아들의 다른 기기가 같은 심부름을 요청하고 부모가 승인했다고 가정
  const code = await w.rpc('issue_invite', { p_secret: keys.parentSecret, p_role: 'child', p_label: '아들패드' });
  const other = (await w.rpc('redeem_invite', { p_code: code })).secret;
  await w.rpc('request_item', { p_secret: other, p_item: it.room.id });
  const r = await pendingOf(it.room.id);
  await w.rpc('decide_request', { p_secret: keys.parentSecret, p_request: r.id, p_ok: true });
  await child.locator(`[data-card="${it.room.id}"][data-state="todo"]`).click();
  await child.locator('.toast.err', { hasText: '이미 처리' }).waitFor();
  await child.unroute('**/rest/v1/rpc/get_state');
  await child.locator(`[data-card="${it.room.id}"][data-state="done"]`).waitFor();
  assert.deepEqual(w.errors, []);
});
