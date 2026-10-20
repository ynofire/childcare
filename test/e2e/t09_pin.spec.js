// T9: PIN 잠금 — 설정 → 앱 재시작 시 잠금 → 오입력/대기 → 해제 → 60초 뒤 재잠금 → PIN 잊음(연결 해제) → 복구 코드로 재연결
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newWorld } from './harness.js';

let w, keys;
before(async () => { w = await newWorld(); keys = await w.seedFamily(); });
after(async () => { await w.teardown(); });

test('t09 PIN 전체 흐름', async () => {
  const { parent } = w;
  await parent.locator('[data-tab="settings"]').click();
  await parent.locator('#pinNew').fill('12');
  await parent.locator('#pinNew2').fill('12');
  await parent.locator('#pinSave').click();
  assert.match(await parent.locator('#pinMsg').innerText(), /4~6자리/);
  await parent.locator('#pinNew').fill('1234');
  await parent.locator('#pinNew2').fill('1234');
  await parent.locator('#pinSave').click();
  await parent.locator('#pinMsg', { hasText: '켰어요' }).waitFor();
  const raw = await parent.evaluate(() => localStorage.getItem('cc_pin_v2'));
  assert.ok(raw && !raw.includes('1234'));

  // 앱 재시작(= 같은 저장소, 새 세션): 잠금 화면
  const p2 = await parent.context().newPage();
  await p2.goto(w.url + '/');
  await p2.locator('#lockPin').waitFor();
  assert.equal(await p2.locator('[data-tab]').count(), 0, '잠금 중에는 내용이 렌더링되지 않는다');
  assert.equal(await p2.locator('#bal').count(), 0);

  for (let i = 0; i < 4; i++) { await p2.locator('#lockPin').fill('0000'); await p2.locator('#lockBtn').click(); await p2.locator('#lockErr', { hasText: `${4 - i}번 더` }).waitFor(); }
  await p2.locator('#lockPin').fill('0000'); await p2.locator('#lockBtn').click();
  await p2.locator('#lockErr', { hasText: '30초' }).waitFor();
  await p2.locator('#lockPin').fill('1234'); await p2.locator('#lockBtn').click();
  await p2.locator('#lockErr', { hasText: '초 후' }).waitFor();
  assert.equal(await p2.locator('[data-tab]').count(), 0, '대기 중엔 맞는 PIN 도 열리지 않는다');

  // 대기 시간이 지난 것으로 만든 뒤 해제
  await p2.evaluate(() => localStorage.setItem('cc_pin_fail', JSON.stringify({ n: 5, until: Date.now() - 1 })));
  await p2.locator('#lockPin').fill('1234'); await p2.locator('#lockBtn').click();
  await p2.locator('[data-tab="home"]').waitFor();

  // 30초 숨김은 유지, 60초 숨김은 재잠금
  const hide = (hidden) => p2.evaluate((hd) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => hd }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
  const skip = (ms) => p2.evaluate((m) => { const orig = Date.now.bind(Date); Date.now = () => orig() + m; }, ms);
  await hide(true); await skip(30_000); await hide(false);
  await p2.locator('[data-tab="home"]').waitFor();
  await hide(true); await skip(60_000); await hide(false);
  await p2.locator('#lockPin').waitFor();

  // PIN 을 잊음 → 연결 해제 → 복구 코드로 다시 연결
  await p2.locator('#lockForgot').click();
  await p2.locator('.sheet .btn.danger').click();
  await p2.locator('#btnJoin').waitFor();
  assert.equal(await w.secretOf(p2), null);
  assert.equal(await p2.evaluate(() => localStorage.getItem('cc_pin_v2')), null);
  await p2.locator('#code').fill(keys.parentSecret);
  await p2.locator('#btnJoin').click();
  await p2.locator('[data-tab="home"]').waitFor();
  assert.equal(await w.secretOf(p2), keys.parentSecret);
  assert.deepEqual(w.errors, []);
});
