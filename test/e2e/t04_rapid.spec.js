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

test('t04b 서로 다른 카드 3개를 빠르게 → 모두 반영', async () => {
  const { child } = w;
  const a = child.locator(`[data-card="${it.trash.id}"]`), b = child.locator(`[data-card="${it.laundry.id}"]`), c = child.locator(`[data-card="${it.school.id}"]`);
  await a.dispatchEvent('click'); await child.waitForTimeout(100);
  await b.dispatchEvent('click'); await child.waitForTimeout(100);
  await c.dispatchEvent('click');
  await child.locator(`[data-card="${it.school.id}"][data-state="done"]`).waitFor();
  await child.locator(`[data-card="${it.trash.id}"][data-state="waiting"]`).waitFor();
  await child.locator(`[data-card="${it.laundry.id}"][data-state="waiting"]`).waitFor();
  const st = await state();
  const ids = st.pending.map((r) => r.item_id);
  assert.ok(ids.includes(it.trash.id) && ids.includes(it.laundry.id));
  assert.ok(it.school.id in st.checks);
});

test('t04c 앞가림을 켜기·끄기·켜기 빠르게 → 최종 켜짐, 포인트는 한 번만 반영', async () => {
  const { child } = w;
  const before = (await state()).family.balance;
  const card = child.locator(`[data-card="${it.room.id}"]`);
  await tapN(card, 3);
  await child.locator(`[data-card="${it.room.id}"][data-state="done"]`).waitFor();
  await child.waitForFunction(() => document.querySelectorAll('[data-state="sending"]').length === 0);
  const st = await state();
  assert.ok(it.room.id in st.checks);
  assert.equal(st.family.balance - before, it.room.amount);
  assert.deepEqual(w.errors, []);
});
