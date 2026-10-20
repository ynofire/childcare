import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardState, pendingKey } from '../../www/js/cardstate.js';

const base = (o = {}) => ({ status: 'ok', day: '2026-10-17', today: '2026-10-17', checks: {}, pending: [], missions: [], recent: [], ...o });
const none = new Set();

test('pendingKey: 종류별로 서로 다른 키', () => {
  assert.equal(pendingKey('base', 'a'), 'toggle:a');
  assert.equal(pendingKey('optional', 'a'), 'toggle:a');
  assert.equal(pendingKey('extra', 'a'), 'req:a');
  assert.equal(pendingKey('mission', 5), 'mission:5');
});

test('앞가림: todo → (큐에 있으면) sending → done', () => {
  assert.equal(cardState('base', 'a', base(), none), 'todo');
  assert.equal(cardState('base', 'a', base(), new Set(['toggle:a'])), 'sending');
  assert.equal(cardState('base', 'a', base({ checks: { a: 10000 } }), none), 'done');
});

test('심부름: todo → sending → waiting → done', () => {
  assert.equal(cardState('extra', 'e', base(), none), 'todo');
  assert.equal(cardState('extra', 'e', base(), new Set(['req:e'])), 'sending');
  assert.equal(cardState('extra', 'e', base({ pending: [{ id: 1, item_id: 'e', day: '2026-10-17' }] }), none), 'waiting');
  assert.equal(cardState('extra', 'e', base({ checks: { e: 10000 } }), none), 'done');
});

test('심부름: 같은 날 거절되면 rejected, 다른 날의 거절은 무시, 다시 요청하면 sending/waiting', () => {
  const rej = (day) => ({ id: 9, item_id: 'e', status: 'reject', day, decided_at: '2026-10-17T01:00:00Z' });
  assert.equal(cardState('extra', 'e', base({ recent: [rej('2026-10-17')] }), none), 'rejected');
  assert.equal(cardState('extra', 'e', base({ recent: [rej('2026-10-16')] }), none), 'todo');
  assert.equal(cardState('extra', 'e', base({ recent: [rej('2026-10-17')] }), new Set(['req:e'])), 'sending');
  assert.equal(cardState('extra', 'e', base({ recent: [rej('2026-10-17')], pending: [{ id: 2, item_id: 'e', day: '2026-10-17' }] }), none), 'waiting');
});

test('미션: open → todo, wait → waiting, done → done, 거절 후 open → rejected', () => {
  const m = (status) => ({ missions: [{ id: 5, title: 't', amount: 1000, status, day: '2026-10-17' }] });
  assert.equal(cardState('mission', 5, base(m('open')), none), 'todo');
  assert.equal(cardState('mission', 5, base(m('wait')), none), 'waiting');
  assert.equal(cardState('mission', 5, base(m('done')), none), 'done');
  assert.equal(cardState('mission', 5, base({ ...m('open'), recent: [{ id: 3, mission_id: 5, status: 'reject' }] }), none), 'rejected');
  assert.equal(cardState('mission', 5, base(m('open')), new Set(['mission:5'])), 'sending');
});

test('파산: 앞가림·심부름·미션은 locked, 선택 차감은 마이너스면 새로 체크할 수 없음(locked), 이미 체크된 건 취소 가능', () => {
  assert.equal(cardState('base', 'a', base({ status: 'bankrupt' }), none), 'locked');
  assert.equal(cardState('base', 'a', base({ status: 'bankrupt', checks: { a: 1 } }), none), 'locked');
  assert.equal(cardState('extra', 'e', base({ status: 'bankrupt' }), none), 'locked');
  assert.equal(cardState('mission', 5, base({ status: 'bankrupt', missions: [{ id: 5, status: 'open' }] }), none), 'locked');
  assert.equal(cardState('optional', 'o', base({ status: 'blocked' }), none), 'locked');
  assert.equal(cardState('optional', 'o', base({ status: 'blocked', checks: { o: -2000 } }), none), 'done');
  assert.equal(cardState('base', 'a', base({ status: 'blocked' }), none), 'todo', '마이너스여도 앞가림은 가능');
});

test('파산이어도 이미 승인 대기 중이거나 완료된 카드는 그 상태를 보여준다', () => {
  assert.equal(cardState('extra', 'e', base({ status: 'bankrupt', checks: { e: 1 } }), none), 'done');
  assert.equal(cardState('mission', 5, base({ status: 'bankrupt', missions: [{ id: 5, status: 'wait' }] }), none), 'waiting');
});
