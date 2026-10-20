import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../www/js/store.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const offlineErr = () => Object.assign(new Error('offline'), { code: 'offline' });
const codeErr = (code) => Object.assign(new Error(code), { code });
const mem = (init = {}) => {
  const m = new Map(Object.entries({ cc_secret_v2: 'SECRET', ...init }));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
};
class Target extends EventTarget { hidden = false; }
const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };

// 가짜 서버: 호출을 기록하고, handler 가 응답(또는 throw)을 정한다.
function mk({ handler, storage = mem(), pollMs = 1e9, retryMs = 5, env } = {}) {
  const calls = [];
  const rpc = async (fn, args) => { calls.push({ fn, args }); return handler ? handler(fn, args, calls) : { role: 'child', n: calls.length }; };
  const store = createStore({ rpc, storage, pollMs, retryMs, env });
  return { store, calls, storage };
}
const acts = (calls) => calls.filter((c) => c.fn !== 'get_state');

test('s1 처리 중에 누른 동작도 버려지지 않고 순서대로 전송된다', async () => {
  const gate = deferred();
  const { store, calls } = mk({ handler: (fn, args) => (args.p_item === 'a' ? gate.p.then(() => ({ role: 'child' })) : { role: 'child' }) });
  const p1 = store.act('toggle_item', { p_item: 'a', p_on: true }, { key: 'toggle:a' });
  const p2 = store.act('toggle_item', { p_item: 'b', p_on: true }, { key: 'toggle:b' });
  const p3 = store.act('request_extra', { p_item: 'c' }, { key: 'req:c' });
  await wait(20);
  assert.deepEqual(acts(calls).map((c) => c.args.p_item), ['a'], '첫 동작이 끝나기 전엔 다음이 나가지 않는다');
  gate.resolve();
  const results = await Promise.all([p1, p2, p3]);
  assert.deepEqual(results.map((r) => r.ok), [true, true, true]);
  assert.deepEqual(acts(calls).map((c) => c.args.p_item), ['a', 'b', 'c']);
});

test('s2 전송 전 같은 key 의 동작은 마지막 의도 하나로 합쳐진다', async () => {
  const gate = deferred();
  const { store, calls } = mk({ handler: (fn, args) => (args.p_item === 'slow' ? gate.p.then(() => ({ role: 'child' })) : { role: 'child' }) });
  const slow = store.act('toggle_item', { p_item: 'slow', p_on: true }, { key: 'toggle:slow' });
  const t1 = store.act('toggle_item', { p_item: 'x', p_on: true }, { key: 'toggle:x' });
  const t2 = store.act('toggle_item', { p_item: 'x', p_on: false }, { key: 'toggle:x' });
  const t3 = store.act('toggle_item', { p_item: 'x', p_on: true }, { key: 'toggle:x' });
  gate.resolve();
  const rs = await Promise.all([slow, t1, t2, t3]);
  assert.ok(rs.every((r) => r.ok), '합쳐진 동작의 Promise 도 모두 성공으로 끝난다');
  const xs = acts(calls).filter((c) => c.args.p_item === 'x');
  assert.equal(xs.length, 1);
  assert.equal(xs[0].args.p_on, true);
});

test('s3 서버 응답이 이전과 같아도 구독자에게 항상 전달된다', async () => {
  const { store } = mk({ handler: () => ({ role: 'child', same: 1 }) });
  const seen = [];
  store.subscribe((s, meta) => { if (!meta.reason) seen.push(s); });
  await store.refresh(); await store.refresh(); await store.refresh();
  assert.equal(seen.length, 3);
});

test('s4 먼저 보낸 요청의 늦은 응답은 폐기된다', async () => {
  const A = deferred(), B = deferred();
  const { store } = mk({ handler: (fn) => (fn === 'get_state' ? A.p : B.p) });
  const pr = store.refresh();
  const pa = store.act('toggle_item', { p_item: 'a', p_on: true }, { key: 'k' });
  B.resolve({ role: 'child', v: 2 });
  await pa;
  A.resolve({ role: 'child', v: 1 });
  await pr;
  assert.equal(store.state.v, 2);
});

test('s5 오프라인이면 큐를 유지하고 복구되면 자동 재전송한다', async () => {
  let n = 0;
  const { store, calls } = mk({ handler: (fn) => { if (fn !== 'get_state' && ++n === 1) throw offlineErr(); return { role: 'child' }; } });
  const onlineSeen = [];
  store.subscribe(() => onlineSeen.push(store.online));
  const r = await store.act('request_extra', { p_item: 'e' }, { key: 'req:e' });
  assert.equal(r.ok, true);
  assert.equal(acts(calls).length, 2, '실패 후 같은 동작을 다시 보냄');
  assert.ok(onlineSeen.includes(false), '오프라인 상태가 한 번은 노출됨');
  assert.equal(store.online, true);
  assert.equal(store.pending.size, 0);
});

test('s6 오프라인 중 앱이 종료돼도 큐가 로컬 저장소에서 복원된다', async () => {
  const storage = mem();
  const a = mk({ storage, handler: () => { throw offlineErr(); } });
  a.store.start();
  a.store.act('request_extra', { p_item: 'e' }, { key: 'req:e' });
  await wait(20);
  a.store.stop();
  assert.ok(storage.getItem('cc_queue_v1'), '큐가 저장돼 있다');
  const b = mk({ storage });
  b.store.start();
  await wait(50);
  assert.deepEqual(acts(b.calls).map((c) => [c.fn, c.args.p_item]), [['request_extra', 'e']]);
  assert.equal(JSON.parse(storage.getItem('cc_queue_v1') || '[]').length, 0);
  b.store.stop();
});

test('s7 열쇠가 해제되면 큐를 버리고 열쇠를 지우며 재시도하지 않는다', async () => {
  const storage = mem();
  const { store, calls } = mk({ storage, handler: () => { throw codeErr('unauthorized'); } });
  const errs = [];
  store.subscribe((s, meta) => { if (meta.error) errs.push(meta.error.code); });
  const p1 = store.act('toggle_item', { p_item: 'a', p_on: true }, { key: 'a' });
  const p2 = store.act('toggle_item', { p_item: 'b', p_on: true }, { key: 'b' });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.deepEqual([r1.ok, r1.code, r2.ok, r2.code], [false, 'unauthorized', false, 'unauthorized']);
  assert.equal(storage.getItem('cc_secret_v2'), null);
  assert.equal(JSON.parse(storage.getItem('cc_queue_v1') || '[]').length, 0);
  assert.ok(errs.includes('unauthorized'));
  const before = calls.length;
  await wait(60);
  assert.equal(calls.length, before, '더 이상 호출하지 않음');
});

test('s8 서버가 거부하면 그 동작만 버리고 나머지는 계속 처리한다', async () => {
  const { store, calls } = mk({ handler: (fn, args) => { if (args.p_item === 'bad') throw codeErr('duplicate'); return { role: 'child' }; } });
  const p1 = store.act('request_extra', { p_item: 'bad' }, { key: 'bad' });
  const p2 = store.act('request_extra', { p_item: 'good' }, { key: 'good' });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.deepEqual([r1.ok, r1.code, r2.ok], [false, 'duplicate', true]);
  await wait(20);
  assert.ok(calls.some((c) => c.fn === 'get_state'), '직후 상태를 다시 가져온다');
});

test('s9 모든 호출에 p_secret 과 p_day 가 자동으로 붙는다', async () => {
  const { store, calls } = mk();
  await store.refresh();
  assert.equal(calls.at(-1).args.p_secret, 'SECRET');
  assert.equal(calls.at(-1).args.p_day, null);
  await store.setDay('2026-10-16');
  assert.equal(calls.at(-1).fn, 'get_state');
  assert.equal(calls.at(-1).args.p_day, '2026-10-16');
  await store.act('toggle_item', { p_item: 'a', p_on: true });
  assert.equal(acts(calls)[0].args.p_day, '2026-10-16');
  assert.equal(acts(calls)[0].args.p_secret, 'SECRET');
});

test('s10 시작·복귀·네트워크 복구·포커스·주기마다 즉시 갱신한다', async () => {
  const doc = new Target(), win = new Target();
  const { store, calls } = mk({ pollMs: 150, env: { doc, win } });
  const gets = () => calls.filter((c) => c.fn === 'get_state').length;
  store.start();
  await wait(10);
  assert.equal(gets(), 1, '시작 직후 1회');
  doc.dispatchEvent(new Event('visibilitychange')); await wait(10);
  assert.equal(gets(), 2, '복귀(visible)');
  win.dispatchEvent(new Event('online')); await wait(10);
  assert.equal(gets(), 3, '네트워크 복구');
  win.dispatchEvent(new Event('focus')); await wait(10);
  assert.equal(gets(), 4, '포커스');
  await wait(350);
  assert.ok(gets() >= 6, '주기적 갱신: ' + gets());
  doc.hidden = true;
  await wait(20);
  const frozen = gets(); await wait(350);
  assert.equal(gets(), frozen, '숨겨진 동안은 갱신하지 않음');
  store.stop();
});

test('s11 lastSyncAt 은 서버 응답을 반영한 시각이고, 실패한 갱신에선 바뀌지 않는다', async () => {
  let fail = false;
  const { store } = mk({ handler: () => { if (fail) throw offlineErr(); return { role: 'child' }; } });
  assert.equal(store.lastSyncAt, null);
  const t0 = Date.now();
  await store.refresh();
  assert.ok(store.lastSyncAt >= t0 && store.lastSyncAt <= Date.now());
  const first = store.lastSyncAt;
  fail = true; await wait(5); await store.refresh();
  assert.equal(store.lastSyncAt, first);
});
