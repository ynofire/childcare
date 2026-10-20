// T13: 새 버전 알림 — 설치된 빌드보다 높은 Release 가 있으면 화면 위에 띄우고, '나중에'는 기억한다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newWorld } from './harness.js';

let w, keys, latest = 6, hits = 0;
const release = (n) => ({ tag_name: 'v' + n, html_url: `https://github.com/ynofire/childcare/releases/tag/v${n}`, assets: [{ name: `childcare-v${n}.apk`, browser_download_url: `https://github.com/ynofire/childcare/releases/download/v${n}/childcare-v${n}.apk` }] });

before(async () => {
  w = await newWorld();
  await w.child.addInitScript('window.__CC_BUILD__ = 5;');
  await w.child.route('https://api.github.com/**', (route) => { hits++; route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(release(latest)) }); });
  let parentHits = 0;
  await w.parent.route('https://api.github.com/**', (route) => { parentHits++; route.abort(); });
  w.parentHits = () => parentHits;
  keys = await w.seedFamily();
});
after(async () => { await w.teardown(); });

test('t13a 새 버전이 있으면 배너와 받기 링크, 설정에 현재 버전 표시', async () => {
  const { child } = w;
  await child.locator('#upd:not([hidden])').waitFor();
  assert.match(await child.locator('#upd').innerText(), /v6/);
  assert.match(await child.locator('#updGet').getAttribute('href'), /childcare-v6\.apk$/);
  await child.locator('[data-tab="settings"]').click();
  assert.equal(await child.locator('#appVer').innerText(), 'v5');
  assert.deepEqual(w.errors, []);
});

test('t13b 나중에 → 숨김, 새로고침해도 같은 버전은 다시 안 뜸 · 더 새 버전(v7)은 뜸', async () => {
  const { child } = w;
  await child.locator('#updLater').click();
  await child.locator('#upd[hidden]').waitFor({ state: 'attached' });
  const before = hits;
  await child.reload();
  await child.locator('[data-tab="today"]').waitFor();
  await child.waitForFunction(() => document.documentElement.dataset.build === '5');
  await child.waitForTimeout(500);
  assert.ok(hits > before, '다시 확인은 했지만');
  assert.equal(await child.locator('#upd').isHidden(), true, '닫은 버전은 다시 안 뜬다');
  latest = 7;
  await child.reload();
  await child.locator('#upd:not([hidden])').waitFor();
  assert.match(await child.locator('#upd').innerText(), /v7/);
});

test('t13c 빌드 번호를 모르는 곳(웹/부모 폰 테스트 기기)은 GitHub 에 묻지 않는다', async () => {
  await w.parent.locator('[data-tab="home"]').waitFor();
  await w.parent.waitForTimeout(500);
  assert.equal(w.parentHits(), 0);
  assert.equal(await w.parent.locator('#upd').isHidden(), true);
});
