import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardState, pendingKey, repKey, repInfo, spendable } from '../../www/js/cardstate.js';

const base = (o = {}) => ({ status: 'ok', day: '2026-10-17', today: '2026-10-17', checks: {}, pending: [], missions: [], recent: [], items: [], done_counts: {}, family: { balance: 50000 }, ...o });
const none = new Set();
const wait = (id, extra = {}) => ({ id: 1, item_id: id, day: '2026-10-17', amount: 1000, ...extra });
const rej = (id, day = '2026-10-17') => ({ id: 9, item_id: id, status: 'reject', day, decided_at: '2026-10-17T01:00:00Z' });

test('pendingKey: 앞가림·패드는 req:, 미션은 mission:; 반복 항목 키는 누를 때마다 달라진다', () => {
  assert.equal(pendingKey('base', 'a'), 'req:a');
  assert.equal(pendingKey('optional', 'a'), 'req:a');
  assert.equal(pendingKey('mission', 5), 'mission:5');
  assert.notEqual(repKey('e', 1), repKey('e', 2));
  assert.ok(repKey('e', 1).startsWith('rep:e:'));
});

test('앞가림: todo → sending → waiting(승인 대기) → done(승인됨)', () => {
  assert.equal(cardState('base', 'a', base(), none), 'todo');
  assert.equal(cardState('base', 'a', base(), new Set(['req:a'])), 'sending');
  assert.equal(cardState('base', 'a', base({ pending: [wait('a')] }), none), 'waiting');
  assert.equal(cardState('base', 'a', base({ checks: { a: 10000 } }), none), 'done');
});

test('앞가림: 거절되면 같은 날만 rejected(다시 하기), 다른 날 거절은 무시', () => {
  assert.equal(cardState('base', 'a', base({ recent: [rej('a')] }), none), 'rejected');
  assert.equal(cardState('base', 'a', base({ recent: [rej('a', '2026-10-16')] }), none), 'todo');
  assert.equal(cardState('base', 'a', base({ recent: [rej('a')], pending: [wait('a')] }), none), 'waiting');
});

test('미션: open → todo, wait → waiting, done → done, 거절 후 open → rejected', () => {
  const m = (status) => ({ missions: [{ id: 5, title: 't', amount: 1000, status, day: '2026-10-17' }] });
  assert.equal(cardState('mission', 5, base(m('open')), none), 'todo');
  assert.equal(cardState('mission', 5, base(m('wait')), none), 'waiting');
  assert.equal(cardState('mission', 5, base(m('done')), none), 'done');
  assert.equal(cardState('mission', 5, base({ ...m('open'), recent: [{ id: 3, mission_id: 5, status: 'reject' }] }), none), 'rejected');
  assert.equal(cardState('mission', 5, base(m('open')), new Set(['mission:5'])), 'sending');
});

test('반복 항목(심부름): 대기·완료 횟수를 센다 — 날짜가 다른 대기는 세지 않는다', () => {
  const s = base({ pending: [wait('e'), wait('e', { id: 2 }), wait('e', { id: 3, day: '2026-10-16' }), wait('x', { id: 4 })], done_counts: { e: 3, x: 9 } });
  const r = repInfo('extra', 'e', s, new Set([repKey('e', 1), repKey('e', 2), repKey('x', 1)]));
  assert.deepEqual([r.sending, r.waiting, r.done, r.locked], [2, 2, 3, false]);
  assert.equal(cardState('extra', 'e', s, none), 'waiting');
  assert.equal(cardState('extra', 'e', s, new Set([repKey('e', 1)])), 'sending');
});

test('반복 항목: 완료만 있으면 done(그래도 또 할 수 있음), 아무것도 없으면 todo', () => {
  assert.equal(cardState('extra', 'e', base(), none), 'todo');
  const s = base({ done_counts: { e: 1 } });
  assert.equal(cardState('extra', 'e', s, none), 'done');
  assert.equal(repInfo('extra', 'e', s, none).locked, false);
});

test('파산: 앞가림·심부름·미션은 locked, 이미 승인된/대기 중인 카드는 그 상태를 보여줌', () => {
  assert.equal(cardState('base', 'a', base({ status: 'bankrupt' }), none), 'locked');
  assert.equal(cardState('base', 'a', base({ status: 'bankrupt', checks: { a: 1 } }), none), 'done');
  assert.equal(cardState('base', 'a', base({ status: 'bankrupt', pending: [wait('a')] }), none), 'waiting');
  assert.equal(cardState('extra', 'e', base({ status: 'bankrupt' }), none), 'locked');
  assert.equal(repInfo('extra', 'e', base({ status: 'bankrupt', done_counts: { e: 2 } }), none).locked, true);
  assert.equal(cardState('mission', 5, base({ status: 'bankrupt', missions: [{ id: 5, status: 'open' }] }), none), 'locked');
  assert.equal(cardState('mission', 5, base({ status: 'bankrupt', missions: [{ id: 5, status: 'wait' }] }), none), 'waiting');
});

test('마이너스: 패드(선택)는 새로 신청할 수 없음(locked), 앞가림은 가능', () => {
  assert.equal(cardState('optional', 'o', base({ status: 'blocked' }), none), 'locked');
  assert.equal(cardState('optional', 'o', base({ status: 'blocked', checks: { o: -2000 } }), none), 'done');
  assert.equal(cardState('base', 'a', base({ status: 'blocked' }), none), 'todo');
});

test('spendable: 잔고에서 승인 대기 중인 쓰기(서버)와 전송 중인 쓰기(큐)를 뺀다', () => {
  const items = [{ id: 'pc1', kind: 'spend', amount: -10000 }, { id: 'e', kind: 'extra', amount: 5000 }];
  const s = base({ items, family: { balance: 35000 }, pending: [wait('pc1', { amount: -10000 }), wait('e', { id: 2, amount: 5000 })] });
  assert.equal(spendable(s, none), 25000);
  assert.equal(spendable(s, new Set([repKey('pc1', 1)])), 15000);
  assert.equal(spendable(s, new Set([repKey('e', 1)])), 25000, '심부름은 빼지 않음');
});

test('쓰기 항목: 잔고가 부족하면 locked, 마이너스여도 locked', () => {
  const items = [{ id: 'pc1', kind: 'spend', amount: -10000 }];
  assert.equal(repInfo('spend', 'pc1', base({ items, family: { balance: 9000 } }), none).locked, true);
  assert.equal(repInfo('spend', 'pc1', base({ items, family: { balance: 10000 } }), none).locked, false);
  assert.equal(repInfo('spend', 'pc1', base({ items, status: 'blocked', family: { balance: 50000 } }), none).locked, true);
});
