import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBuild, checkUpdate, createUpdateWatch } from '../../www/js/update.js';

const release = (n, extra = {}) => ({
  tag_name: 'v' + n, html_url: `https://github.com/ynofire/childcare/releases/tag/v${n}`,
  assets: [{ name: `childcare-v${n}.apk`, browser_download_url: `https://github.com/ynofire/childcare/releases/download/v${n}/childcare-v${n}.apk` }], ...extra,
});
const okFetch = (body, calls) => async (url) => { calls && calls.push(url); return { ok: true, json: async () => body }; };
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('parseBuild: v숫자만 인정', () => {
  assert.equal(parseBuild('v12'), 12);
  assert.equal(parseBuild('v1.2'), null);
  assert.equal(parseBuild('release-3'), null);
  assert.equal(parseBuild(undefined), null);
});

test('checkUpdate: 더 높은 버전이면 available + APK 주소, 같거나 낮으면 아님', async () => {
  const r = await checkUpdate({ current: 5, fetchImpl: okFetch(release(6)) });
  assert.equal(r.available, true);
  assert.equal(r.build, 6);
  assert.match(r.apk, /childcare-v6\.apk$/);
  assert.match(r.url, /releases\/tag\/v6$/);
  assert.equal((await checkUpdate({ current: 6, fetchImpl: okFetch(release(6)) })).available, false);
  assert.equal((await checkUpdate({ current: 7, fetchImpl: okFetch(release(6)) })).available, false);
});

test('checkUpdate: 실패·이상한 응답·현재 버전을 모를 때는 null (조용히)', async () => {
  assert.equal(await checkUpdate({ current: 5, fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }) }), null);
  assert.equal(await checkUpdate({ current: 5, fetchImpl: async () => { throw new Error('offline'); } }), null);
  assert.equal(await checkUpdate({ current: 5, fetchImpl: okFetch({ tag_name: 'nightly' }) }), null);
  assert.equal(await checkUpdate({ current: null, fetchImpl: okFetch(release(9)) }), null);
  assert.equal(await checkUpdate({ current: NaN, fetchImpl: okFetch(release(9)) }), null);
});

test('checkUpdate: APK 파일이 없으면 릴리스 페이지로 안내', async () => {
  const r = await checkUpdate({ current: 1, fetchImpl: okFetch(release(2, { assets: [] })) });
  assert.equal(r.apk, null);
  assert.match(r.url, /tag\/v2$/);
});

test('watch: 짧은 간격의 재확인은 서버에 묻지 않는다 (force 는 예외)', async () => {
  const calls = []; let t = 1000;
  const w = createUpdateWatch({ getBuild: async () => 5, fetchImpl: okFetch(release(6), calls), now: () => t, gapMs: 60000, storage: mem(), onChange: () => {} });
  await w.check(); await w.check(); t += 30000; await w.check();
  assert.equal(calls.length, 1);
  t += 31000; await w.check();
  assert.equal(calls.length, 2);
  await w.check(true);
  assert.equal(calls.length, 3);
});

test('watch: 새 버전이 있으면 알리고, 나중에 누르면 같은 버전은 다시 알리지 않지만 더 새 버전은 알린다', async () => {
  const seen = []; let latest = 6; let t = 0;
  const store = mem();
  const w = createUpdateWatch({ getBuild: async () => 5, fetchImpl: async () => ({ ok: true, json: async () => release(latest) }), now: () => t, gapMs: 1, storage: store, onChange: (i) => seen.push(i && i.build) });
  await w.check();
  assert.deepEqual(seen, [6]);
  w.dismiss();
  assert.deepEqual(seen, [6, null]);
  t += 10; await w.check();
  assert.deepEqual(seen, [6, null, null], '닫은 버전은 다시 안 알림');
  latest = 7; t += 10; await w.check();
  assert.equal(seen[seen.length - 1], 7);
});

test('watch: 확인에 실패해도 이전에 알린 내용을 지우지 않는다', async () => {
  const seen = []; let fail = false; let t = 0;
  const w = createUpdateWatch({ getBuild: async () => 5, fetchImpl: async () => { if (fail) throw new Error('x'); return { ok: true, json: async () => release(6) }; }, now: () => t, gapMs: 1, storage: mem(), onChange: (i) => seen.push(i && i.build) });
  await w.check();
  fail = true; t += 10; await w.check();
  assert.deepEqual(seen, [6]);
  assert.equal(w.info.build, 6);
});

test('watch: 이미 최신이면 알림 없음(null)', async () => {
  const seen = [];
  const w = createUpdateWatch({ getBuild: async () => 6, fetchImpl: okFetch(release(6)), now: () => 0, gapMs: 1, storage: mem(), onChange: (i) => seen.push(i) });
  await w.check();
  assert.deepEqual(seen, [null]);
});
