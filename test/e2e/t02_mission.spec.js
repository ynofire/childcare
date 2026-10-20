// T2: 부모가 어제 날짜를 보면서 미션을 내줘도 아들 폰 "오늘"에 5초 안에 뜬다 (기본 폴링 5초 그대로 검증)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newWorld } from './harness.js';

let w, keys;
before(async () => { w = await newWorld({ pollMs: 5000 }); keys = await w.seedFamily({ start: w.addDays(w.kstToday(), -10) }); });
after(async () => { await w.teardown(); });

test('t02 어제 날짜로 낸 미션이 아들 오늘 화면에 5초 안에 NEW 와 함께 뜨고, 날짜를 바꿔도 남는다', async () => {
  const { child } = w;
  await child.locator('[data-tab="today"]').waitFor();
  const yesterday = w.addDays(w.kstToday(), -1);
  await w.rpc('create_mission', { p_secret: keys.parentSecret, p_title: '베란다 대청소', p_amount: 20000, p_day: yesterday });

  const card = child.locator('[data-section="missions"] [data-card]', { hasText: '베란다 대청소' });
  await card.waitFor({ timeout: 7000 });
  assert.equal(await card.getAttribute('data-state'), 'todo');
  await card.locator('[data-badge="new"]').waitFor();

  // 어제로 보기 전환 → 시킨 일은 날짜와 무관하게 그대로
  await child.locator('[data-seg="y"]').click();
  await child.locator('#segY.on').waitFor();
  await child.locator('[data-section="missions"] [data-card]', { hasText: '베란다 대청소' }).waitFor();
  await child.locator('[data-seg="t"]').click();

  await child.locator('[data-section="missions"] [data-card]', { hasText: '베란다 대청소' }).click();
  await child.locator('[data-section="missions"] [data-card][data-state="waiting"]').waitFor();
  assert.deepEqual(w.errors, []);
});
