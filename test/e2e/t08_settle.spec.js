// T8: 부모 정산 — 식비 끼니 3·2·1·0, 금액 직접 입력, 항목 제외, 잘못된 값은 시트 안내(서버 호출 없음), 재적용은 변동 없음
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newWorld } from './harness.js';

let w, keys, it, start;
before(async () => { w = await newWorld(); start = w.addDays(w.kstToday(), -10); keys = await w.seedFamily({ start }); it = await w.items(keys.parentSecret); });
after(async () => { await w.teardown(); });

const st = () => w.rpc('get_state', { p_secret: keys.parentSecret });

test('t08a 식비 선택지는 3·2·1·0 이고, 직접 입력·식비 3끼·학원비 제외로 적용하면 아들 내역에 그대로 반영된다', async () => {
  const { parent, child } = w;
  await parent.locator('[data-tab="settle"]').click();
  const opts = await parent.locator('#mealSel option').evaluateAll((os) => os.map((o) => o.value));
  assert.deepEqual(opts, ['3', '2', '1', '0']);
  assert.equal(await parent.locator(`[data-amt="${it.rent.id}"]`).inputValue(), '3000', '기본 금액이 미리 채워져 있다');
  assert.equal(await parent.locator(`[data-amt="${it.academy.id}"]`).inputValue(), '10000');
  await parent.locator('#mealSel').selectOption('3');
  assert.equal(await parent.locator(`[data-amt="${it.food.id}"]`).inputValue(), '3000', '끼니를 바꾸면 식비 기본 금액도 바뀐다');
  await parent.locator(`[data-amt="${it.rent.id}"]`).fill('12345');
  await parent.locator(`[data-fix="${it.academy.id}"]`).click();
  assert.equal(await parent.locator(`[data-fix="${it.academy.id}"]`).getAttribute('aria-pressed'), 'false');
  await parent.locator('#applyBtn').click();
  await parent.locator('.toast.ok').first().waitFor();

  const s = await st();
  const labels = s.txs.map((x) => x.label);
  assert.ok(labels.includes('숙박비 (직접 입력 12,345P)'), labels.join(' | '));
  assert.ok(labels.includes('식비 (3끼)'), labels.join(' | '));
  assert.ok(!labels.some((l) => l.startsWith('학원비')), '제외한 학원비는 없다');
  assert.equal(s.family.balance, -(12345 + 3000 + 1000 + 10000 + 1000));

  await child.locator('[data-tab="history"]').click();
  await child.locator('.tx-l', { hasText: '숙박비 (직접 입력 12,345P)' }).waitFor();
  await child.locator('.tx-l', { hasText: '식비 (3끼)' }).waitFor();

  // 같은 날 다시 적용해도 변동 없음 (서버)
  const bal = s.family.balance;
  const again = await w.rpc('apply_fixed', { p_secret: keys.parentSecret, p_day: s.day, p_skip: [], p_meals: 3, p_amounts: {} });
  assert.equal(again.family.balance, bal + -Math.round(300000 / 30), '제외했던 학원비만 새로 반영, 나머지는 그대로');
});

test('t08b 소수·빈 값·음수는 시트로 안내하고 서버에 보내지 않는다', async () => {
  const { parent } = w;
  const calls = [];
  parent.on('request', (r) => { if (r.url().includes('apply_fixed')) calls.push(r.url()); });
  await parent.locator('[data-tab="settle"]').click();
  await parent.locator('[data-seg="y"]').click();
  await parent.locator('#segY.on').waitFor();
  for (const bad of ['12.5', '', '-1']) {
    await parent.locator(`[data-amt="${it.rent.id}"]`).fill(bad);
    await parent.locator('#applyBtn').click();
    await parent.locator('.sheet').waitFor();
    assert.match(await parent.locator('.sheet').innerText(), /0 이상의 정수/);
    await parent.locator('.sheet .btn').first().click();
    await parent.locator('.sheet').waitFor({ state: 'detached' });
  }
  assert.equal(calls.length, 0);
  // 입력값은 폴링으로 화면이 다시 그려져도 유지된다
  await parent.locator(`[data-amt="${it.rent.id}"]`).fill('777');
  await parent.waitForTimeout(1500);
  assert.equal(await parent.locator(`[data-amt="${it.rent.id}"]`).inputValue(), '777');
  assert.deepEqual(w.errors, []);
});

test('t08c 선택창(끼니 선택)이 열려 있는 동안엔 폴링이 화면을 다시 그리지 않는다 (안드로이드 선택창이 닫히는 문제 방지)', async () => {
  const { parent } = w;
  await parent.locator('[data-tab="settle"]').click();
  await parent.locator('#segY').click();
  await parent.locator('#segY.on').waitFor();
  const sel = parent.locator('#mealSel');
  await parent.waitForTimeout(800); // 날짜 전환 직후의 갱신이 끝나길 기다린다
  await sel.focus();
  const handle = await sel.elementHandle();
  await w.rpc('create_mission', { p_secret: keys.parentSecret, p_title: '폴링 확인', p_amount: 1000 });
  await parent.waitForTimeout(1600); // 폴링 주기(600ms)보다 충분히 길게
  assert.equal(await handle.evaluate((n) => n.isConnected), true, '포커스된 선택창은 그대로 남아 있다');
  await sel.blur();
  await parent.waitForFunction((n) => !n.isConnected, handle, { timeout: 3000 }); // 닫으면 밀린 갱신이 반영된다
});
