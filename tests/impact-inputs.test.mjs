import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impactKoreanTimeToIso, impactRevenueToMinor, impactPeriodError } from '../components/dashboard/impact-inputs.ts';

test('Korean wall time always converts to UTC independent of browser timezone', () => {
  assert.equal(impactKoreanTimeToIso('2026-10-18T19:25'), '2026-10-18T10:25:00.000Z');
  assert.equal(impactKoreanTimeToIso('2026-10-19T08:59'), '2026-10-18T23:59:00.000Z');
  assert.throws(() => impactKoreanTimeToIso('2026-02-30T10:30'));
  assert.throws(() => impactKoreanTimeToIso('2026-10-18'));
});

test('money entry preserves missing, zero, decimals and currency minor units exactly', () => {
  assert.equal(impactRevenueToMinor('', 'KRW'), null);
  assert.equal(impactRevenueToMinor('  ', 'USD'), null);
  assert.equal(impactRevenueToMinor('0', 'KRW'), 0);
  assert.equal(impactRevenueToMinor('123456', 'KRW'), 123456);
  assert.equal(impactRevenueToMinor('19.99', 'USD'), 1999);
  assert.equal(impactRevenueToMinor('0.29', 'USD'), 29);
  assert.equal(impactRevenueToMinor('1.2', 'EUR'), 120);
  assert.equal(impactRevenueToMinor('001.23', 'USD'), 123);
  assert.throws(() => impactRevenueToMinor('19.1', 'KRW'));
  assert.throws(() => impactRevenueToMinor('1.001', 'USD'));
  assert.throws(() => impactRevenueToMinor('-1', 'USD'));
  assert.throws(() => impactRevenueToMinor('1e3', 'USD'));
  assert.throws(() => impactRevenueToMinor('10000000000.01', 'USD'));
});

test('date range uses inclusive UTC days and keeps content change out of baseline', () => {
  const valid = { beforeStart: '2026-09-01', beforeEnd: '2026-09-07', afterStart: '2026-09-09', afterEnd: '2026-09-15', changedAt: '2026-09-08T03:00:00.000Z' };
  assert.equal(impactPeriodError(valid), '');
  assert.match(impactPeriodError({ ...valid, afterEnd: '2026-09-16' }), /길이/);
  assert.match(impactPeriodError({ ...valid, changedAt: '2026-09-07T23:59:59.000Z' }), /적용 시각/);
  assert.equal(impactPeriodError({ ...valid, changedAt: '2026-09-08T00:00:00.000Z' }), '');
  assert.equal(impactPeriodError({ ...valid, changedAt: '2026-09-09T00:00:00.000Z' }), '');
  assert.match(impactPeriodError({ ...valid, changedAt: '2026-09-09T00:00:01.000Z' }), /적용 시각/);
  assert.match(impactPeriodError({ ...valid, beforeEnd: '2026-09-09' }), /겹치지/);
  assert.match(impactPeriodError({ ...valid, beforeStart: '2026-02-30' }), /올바른 날짜/);
});
