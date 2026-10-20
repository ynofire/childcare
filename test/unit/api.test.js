import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRpc, errText, ERR } from '../../www/js/api.js';

const res = (status, body) => ({ ok: status < 300, status, json: async () => body });

test('성공 응답은 JSON 본문을 돌려주고 apikey 헤더를 붙인다', async () => {
  let seen;
  const rpc = makeRpc({ url: 'http://x', key: 'k', fetchImpl: async (u, o) => { seen = { u, o }; return res(200, { a: 1 }); } });
  assert.deepEqual(await rpc('get_state', { p_secret: 's' }), { a: 1 });
  assert.equal(seen.u, 'http://x/rest/v1/rpc/get_state');
  assert.equal(seen.o.headers.apikey, 'k');
  assert.equal(seen.o.headers.Authorization, undefined, '공개 키(sb_publishable_)는 Authorization 헤더를 쓰지 않는다');
  assert.equal(seen.o.body, JSON.stringify({ p_secret: 's' }));
});

test('네트워크 실패는 code=offline', async () => {
  const rpc = makeRpc({ url: 'http://x', key: 'k', fetchImpl: async () => { throw new TypeError('failed'); } });
  await assert.rejects(rpc('get_state'), (e) => e.code === 'offline');
});

test('서버 메시지가 알려진 코드면 그대로 code 가 되고, 아니면 error', async () => {
  const mkr = (msg) => makeRpc({ url: 'http://x', key: 'k', fetchImpl: async () => res(400, { message: msg }) });
  await assert.rejects(mkr('duplicate')('x'), (e) => e.code === 'duplicate' && e.status === 400);
  await assert.rejects(mkr('some pg error')('x'), (e) => e.code === 'error');
});

test('errText 는 모든 알려진 코드에 한글 문구를, 모르는 코드엔 일반 안내를 준다', () => {
  for (const code of Object.keys(ERR)) assert.equal(errText({ code }), ERR[code]);
  assert.match(errText({ code: 'error' }), /문제가 생겼어요/);
  assert.match(errText(null), /문제가 생겼어요/);
});
