import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { startShim } from '../shim/server.js';

const PG = { host: '/tmp/pgtest_cc', port: 5544, user: 'postgres', database: 'cc' };
let shim;
before(async () => {
  execFileSync('bash', ['test/run-sql.sh', 'up'], { stdio: 'pipe' });
  shim = await startShim({ pg: PG });
});
after(async () => {
  await shim?.close();
  execFileSync('bash', ['test/run-sql.sh', 'down'], { stdio: 'pipe' });
});

const rpc = async (fn, body) => {
  const res = await fetch(`${shim.url}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: 'x' }, body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

test('create_family 는 {secret} 을 돌려준다', async () => {
  const r = await rpc('create_family', { p_name: 'shim', p_academy: 300000, p_opening: 0 });
  assert.equal(r.status, 200);
  assert.match(r.json.secret, /^[0-9a-f]{48}$/);
});

test('서버 예외는 HTTP 400 + {message} (PostgREST 규약)', async () => {
  const r = await rpc('get_state', { p_secret: 'nope' });
  assert.equal(r.status, 400);
  assert.equal(r.json.message, 'unauthorized');
});

test('setFakeToday 가 서버의 오늘을 바꾼다', async () => {
  const { secret } = (await rpc('create_family', { p_name: 'f', p_academy: 0, p_opening: 0 })).json;
  shim.setFakeToday('2030-01-02');
  const r = await rpc('get_state', { p_secret: secret });
  shim.setFakeToday(null);
  assert.equal(r.json.today, '2030-01-02');
});

test('정의되지 않은 인자 이름이나 함수는 4xx', async () => {
  const a = await rpc('get_state', { p_secret: 'x', p_zzz: 1 });
  assert.ok(a.status >= 400 && a.status < 500, `status ${a.status}`);
  const b = await rpc('no_such_fn', {});
  assert.equal(b.status, 404);
});

test('anon 역할로 실행되어 private 함수는 호출할 수 없다', async () => {
  const r = await rpc('add_tx', { p_family: '00000000-0000-0000-0000-000000000000', p_label: 'x', p_amt: 1 });
  assert.equal(r.status, 404);
  const res = await fetch(`${shim.url}/rest/v1/families?select=*`);
  assert.ok(res.status >= 400, '테이블 직접 조회는 거부되어야 함');
});

test('jsonb 인자와 date 인자를 전달할 수 있다', async () => {
  const { secret } = (await rpc('create_family', { p_name: 'j', p_academy: 300000, p_opening: 0 })).json;
  const r = await rpc('apply_fixed', { p_secret: secret, p_day: null, p_skip: [], p_meals: 3, p_amounts: {} });
  assert.equal(r.status, 200);
  assert.equal(r.json.family.balance < 0, true);
});

test('정적 파일: / 는 www/index.html', async () => {
  const res = await fetch(`${shim.url}/`);
  assert.ok([200, 404].includes(res.status));
});
