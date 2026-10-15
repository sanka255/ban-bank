const test = require('node:test');
const assert = require('node:assert/strict');

const { canPostChargesToPms } = require('../src/services/pmsPostingService');
const { isCurrentlyInHousePmsReservationStatus } = require('../src/services/pmsService');

test('posting to PMS stays allowed when the folio is fully settled', () => {
  const result = canPostChargesToPms({
    hasUnpostedLines: true,
    outstandingBalance: 0,
  });

  assert.equal(result, true);
});

test('posting to PMS is blocked only when there are no unposted charges', () => {
  const result = canPostChargesToPms({
    hasUnpostedLines: false,
    outstandingBalance: 0,
  });

  assert.equal(result, false);
});

test('only currently in-house PMS reservations are eligible room targets', () => {
  assert.equal(isCurrentlyInHousePmsReservationStatus('in_house'), true);
  assert.equal(isCurrentlyInHousePmsReservationStatus('checked_in'), false);
  assert.equal(isCurrentlyInHousePmsReservationStatus('guaranteed'), false);
  assert.equal(isCurrentlyInHousePmsReservationStatus('confirmed'), false);
});
