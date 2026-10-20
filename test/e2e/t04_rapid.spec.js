// T4: 연타해도 동작이 유실·중복되지 않는다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newWorld } from './harness.js';

let w, keys, it;
before(async () => { w = await newWorld(); keys = await w.seedFamily(); it = await w.items(keys.parentSecret); });
after(async () => { await w.teardown(); });

const state = () => w.rpc('get_state', { p_secret: keys.parentSecret });
const tapN = async (loc, n) => { for (let i = 0; i < n; i++) await loc.dispatchEvent('click'); };

test('t04a 같은 심부름 카드를 10번 연타 → 요청은 1건, 카드는 waiting', async () => {
  const card = w.child.locator(`[data-card="${it.dish.id}"]`);
  await card.waitFor();
  await tapN(card, 10);
  await w.child.locator(`[data-card="${it.dish.id}"][data-state="waiting"]`).waitFor();
  const st = await state();
  assert.equal(st.pending.filter((r) => r.item_id === it.dish.id).length, 1);
});

test('t04b 서로 다른 카드 3개를 빠르게 → 모두 신청되고 아직 반영되진 않는다', async () => {
  const { child } = w;
  const before = (await state()).family.balance;
  const a = child.locator(`[data-card="${it.trash.id}"]`), b = child.locator(`[data-card="${it.laundry.id}"]`), c = child.locator(`[data-card="${it.school.id}"]`);
  await a.dispatchEvent('click'); await child.waitForTimeout(100);
  await b.dispatchEvent('click'); await child.waitForTimeout(100);
  await c.dispatchEvent('click');
  await child.locator(`[data-card="${it.school.id}"][data-state="waiting"]`).waitFor();
  await child.locator(`[data-card="${it.trash.id}"][data-state="waiting"]`).waitFor();
  await child.locator(`[data-card="${it.laundry.id}"][data-state="waiting"]`).waitFor();
  const st = await state();
  const ids = st.pending.map((r) => r.item_id);
  assert.ok(ids.includes(it.trash.id) && ids.includes(it.laundry.id) && ids.includes(it.school.id));
  assert.equal(st.family.balance, before, '승인 전에는 잔고가 그대로');
  assert.deepEqual(st.checks, {});
});

test('t04c 앞가림 카드를 3번 연타 → 신청은 1건, 승인해야 포인트가 한 번만 들어온다', async () => {
  const { child } = w;
  const before = (await state()).family.balance;
  const card = child.locator(`[data-card="${it.room.id}"]`);
  await tapN(card, 3);
  await child.locator(`[data-card="${it.room.id}"][data-state="waiting"]`).waitFor();
  await child.waitForFunction(() => document.querySelectorAll('[data-state="sending"]').length === 0);
  let st = await state();
  assert.equal(st.pending.filter((r) => r.item_id === it.room.id).length, 1);
  assert.equal(st.family.balance, before);
  await w.parent.locator(`[data-decide="${st.pending.find((r) => r.item_id === it.room.id).id}"][data-ok="1"]`).click();
  await child.locator(`[data-card="${it.room.id}"][data-state="done"]`).waitFor();
  st = await state();
  assert.ok(it.room.id in st.checks);
  assert.equal(st.family.balance - before, it.room.amount);
  assert.deepEqual(w.errors, []);
});

test('t04d 심부름은 잠깐 뒤 다시 누르면 같은 날 또 신청된다 (대기 2건, 카드에 횟수 표시)', async () => {
  const { child } = w;
  const card = child.locator(`[data-card="${it.dish.id}"]`);
  await child.waitForTimeout(800);
  await card.dispatchEvent('click');
  await child.waitForFunction((id) => /승인 대기 2/.test(document.querySelector(`[data-card="${id}"]`).innerText), it.dish.id);
  const st = await state();
  assert.equal(st.pending.filter((r) => r.item_id === it.dish.id).length, 2);
  assert.deepEqual(w.errors, []);
});
