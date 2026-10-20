import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createLock } from '../../www/js/lock.js';

const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
function mk() {
  const storage = mem({ cc_secret_v2: 'SECRET' }), session = mem();
  let t = 1_000_000;
  const clock = { now: () => t, adv: (ms) => { t += ms; } };
  const lock = createLock({ storage, session, subtle: webcrypto.subtle, random: webcrypto, now: clock.now });
  return { lock, storage, session, clock };
}

test('l1 PIN 설정: 평문은 저장되지 않고 해시 64자리, 설정 직후엔 열려 있다', async () => {
  const { lock, storage } = mk();
  assert.equal(lock.hasPin(), false);
  assert.deepEqual(await lock.setPin('1234'), { ok: true });
  const raw = storage.getItem('cc_pin_v2');
  assert.ok(!raw.includes('1234'));
  assert.equal(JSON.parse(raw).h.length, 64);
  assert.equal(lock.hasPin(), true);
  assert.equal(lock.isLocked(), false);
});

test('l2 형식 오류(3자리·7자리·문자)는 거부', async () => {
  const { lock } = mk();
  for (const bad of ['123', '1234567', 'abcd', '12 4', '']) assert.equal((await lock.setPin(bad)).code, 'format', bad);
  assert.equal(lock.hasPin(), false);
});

test('l3 변경·끄기는 현재 PIN 이 맞아야 한다', async () => {
  const { lock } = mk();
  await lock.setPin('1234');
  assert.equal((await lock.setPin('5678')).code, 'wrong_old');
  assert.equal((await lock.setPin('5678', '0000')).code, 'wrong_old');
  assert.equal((await lock.removePin('0000')).code, 'wrong_old');
  assert.deepEqual(await lock.setPin('5678', '1234'), { ok: true });
  lock.lockNow();
  assert.equal((await lock.unlock('1234')).ok, false);
  assert.equal((await lock.unlock('5678')).ok, true);
  assert.deepEqual(await lock.removePin('5678'), { ok: true });
  assert.equal(lock.hasPin(), false);
  assert.equal(lock.isLocked(), false);
});

test('l4 5회 오입력 → 30초 대기, 대기 중엔 맞는 PIN 도 거부, 지나면 해제 가능', async () => {
  const { lock, clock } = mk();
  await lock.setPin('1234'); lock.lockNow();
  for (let i = 1; i <= 4; i++) { const r = await lock.unlock('0000'); assert.equal(r.ok, false); assert.equal(r.left, 5 - i); }
  const fifth = await lock.unlock('0000');
  assert.equal(fifth.ok, false); assert.equal(fifth.waitSec, 30);
  const during = await lock.unlock('1234');
  assert.equal(during.ok, false); assert.ok(during.waitSec > 0);
  clock.adv(29_000); assert.equal((await lock.unlock('1234')).ok, false);
  clock.adv(1_500);
  assert.equal((await lock.unlock('1234')).ok, true);
  assert.equal(lock.isLocked(), false);
});

test('l5 대기 시간은 5회마다 2배(30→60→…), 최대 600초', async () => {
  const { lock, clock } = mk();
  await lock.setPin('1234'); lock.lockNow();
  const waits = [];
  for (let round = 0; round < 8; round++) {
    let r; for (let i = 0; i < 5; i++) r = await lock.unlock('0000');
    waits.push(r.waitSec); clock.adv(r.waitSec * 1000 + 1);
  }
  assert.deepEqual(waits, [30, 60, 120, 240, 480, 600, 600, 600]);
});

test('l6 숨김 60초 이상이면 복귀 시 재잠금, 30초면 유지', async () => {
  const { lock, clock } = mk();
  await lock.setPin('1234');
  lock.onHidden(); clock.adv(30_000); lock.onVisible();
  assert.equal(lock.isLocked(), false);
  lock.onHidden(); clock.adv(60_000); lock.onVisible();
  assert.equal(lock.isLocked(), true);
});

test('l7 PIN 이 없으면 절대 잠기지 않는다', async () => {
  const { lock, clock } = mk();
  lock.onHidden(); clock.adv(600_000); lock.onVisible(); lock.lockNow();
  assert.equal(lock.isLocked(), false);
});

test('l8 새 세션(sessionStorage 비어 있음)에서는 잠겨 있다 = 앱 재시작 시 잠금', async () => {
  const { lock, storage } = mk();
  await lock.setPin('1234');
  const lock2 = createLock({ storage, session: mem(), subtle: webcrypto.subtle, random: webcrypto, now: () => 0 });
  assert.equal(lock2.isLocked(), true);
});

test('l9 forgot() 은 열쇠·PIN·실패 기록을 지운다', async () => {
  const { lock, storage } = mk();
  await lock.setPin('1234'); lock.lockNow(); await lock.unlock('0000');
  lock.forgot();
  assert.equal(storage.getItem('cc_secret_v2'), null);
  assert.equal(storage.getItem('cc_pin_v2'), null);
  assert.equal(storage.getItem('cc_pin_fail'), null);
  assert.equal(lock.hasPin(), false);
});

test('l10 저장된 값이 깨져 있어도 예외 없이 잠금 없음으로 취급', async () => {
  const storage = mem({ cc_pin_v2: '{not json' });
  const lock = createLock({ storage, session: mem(), subtle: webcrypto.subtle, random: webcrypto, now: () => 0 });
  assert.equal(lock.hasPin(), false);
  assert.equal(lock.isLocked(), false);
});

test('l11 동시에 여러 번 눌러도 오입력이 모두 세어진다 (직렬 처리)', async () => {
  const { lock } = mk();
  await lock.setPin('1234'); lock.lockNow();
  const rs = await Promise.all([lock.unlock('0000'), lock.unlock('0000'), lock.unlock('0000'), lock.unlock('0000'), lock.unlock('0000')]);
  assert.deepEqual(rs.map((r) => r.left ?? `w${r.waitSec}`), [4, 3, 2, 1, 'w30']);
});
