import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, money, addDays, fmtDate, shortTitle } from '../../www/js/format.js';

test('fmt: 부호와 천단위 구분, 0 은 부호 없음', () => {
  assert.equal(fmt(10000), '+10,000P');
  assert.equal(fmt(-1500), '-1,500P');
  assert.equal(fmt(0), '0P');
});

test('money: 부호 없이 천단위 구분', () => {
  assert.equal(money(1234567), '1,234,567');
  assert.equal(money(-3000), '-3,000');
});

test('addDays: 월말·연말·윤년 경계를 기기 시간대와 무관하게 계산', () => {
  assert.equal(addDays('2026-10-17', -1), '2026-10-16');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
});

test('fmtDate: 월/일(요일)', () => {
  assert.equal(fmtDate('2026-10-17'), '10/17(토)');
  assert.equal(fmtDate('2026-10-18'), '10/18(일)');
});

test('shortTitle: 괄호 설명을 떼고 짧게', () => {
  assert.equal(shortTitle('숙박비 (잠자리·방 제공)'), '숙박비');
  assert.equal(shortTitle('식비'), '식비');
});
