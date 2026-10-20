// T12: 입력 경계 — 특수문자·긴 글자·이모지 미션 제목, 금액 상한, 열쇠 해제된 기기
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newWorld } from './harness.js';

let w, keys, it;
before(async () => { w = await newWorld(); keys = await w.seedFamily(); it = await w.items(keys.parentSecret); });
after(async () => { await w.teardown(); });

test('t12a 미션 제목의 HTML·긴 글자·이모지는 글자로만 보이고 레이아웃이 깨지지 않는다', async () => {
  const { child } = w;
  await w.rpc('create_mission', { p_secret: keys.parentSecret, p_title: '<img src=x onerror=window.__xss=1>', p_amount: 1000 });
  await w.rpc('create_mission', { p_secret: keys.parentSecret, p_title: '가'.repeat(40), p_amount: 10000000 });
  await w.rpc('create_mission', { p_secret: keys.parentSecret, p_title: '🧹🧽🪣 방 청소 🎉', p_amount: 3000 });
  await child.locator('[data-section="missions"] [data-card]').nth(2).waitFor();
  assert.equal(await child.evaluate(() => window.__xss), undefined);
  assert.equal(await child.locator('[data-section="missions"]').getByText('<img src=x onerror=window.__xss=1>').count(), 1);
  const overflow = await child.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, '가로 스크롤 없음: ' + overflow);
  assert.match(await child.locator('[data-section="missions"]').innerText(), /10,000,000/);
});

test('t12b 열쇠가 해제된 기기가 동작을 보내면 연결 화면으로 이동하고 재시도하지 않는다', async () => {
  const { child } = w;
  const creds = await w.rpc('list_credentials', { p_secret: keys.parentSecret });
  const childCred = creds.find((c) => c.role === 'child');
  await w.rpc('revoke_credential', { p_secret: keys.parentSecret, p_id: childCred.id });
  let calls = 0;
  child.on('request', (r) => { if (r.url().includes('/rest/v1/rpc/')) calls++; });
  await child.locator(`[data-card="${it.dish.id}"]`).click().catch(() => {});
  await child.locator('#btnJoin').waitFor({ timeout: 8000 });
  assert.equal(await w.secretOf(child), null);
  const seen = calls;
  await child.waitForTimeout(1800);
  assert.ok(calls - seen <= 1, `연결 화면에서 서버 호출이 계속되지 않는다 (${calls - seen})`);
  assert.match(await child.locator('.notice').innerText(), /연결이 해제/);
});
