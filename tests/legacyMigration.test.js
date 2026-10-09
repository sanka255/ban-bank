const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveLegacyReservationStatus,
  mapLegacyHallStatus,
  classifyBillType,
  normalizeLegacyUser,
} = require('../scripts/sprint9/legacyMigration');

test('resolveLegacyReservationStatus maps guaranteed active reservations correctly', () => {
  assert.equal(resolveLegacyReservationStatus({ Guaranteed: 1, Reservation_Is_Done: 1 }), 'guaranteed');
  assert.equal(resolveLegacyReservationStatus({ Guaranteed: 0, Reservation_Is_Done: 1 }), 'tentative');
  assert.equal(resolveLegacyReservationStatus({ Guaranteed: 0, Reservation_Is_Done: 2 }), 'cancelled');
});

test('mapLegacyHallStatus handles excluded partition code 3', () => {
  assert.equal(mapLegacyHallStatus('3'), 'maintenance');
  assert.equal(mapLegacyHallStatus('1'), 'active');
  assert.equal(mapLegacyHallStatus('0'), 'inactive');
});

test('classifyBillType separates debit and credit entries', () => {
  assert.equal(classifyBillType('Credit'), 'credit');
  assert.equal(classifyBillType('Debit'), 'debit');
  assert.equal(classifyBillType('debit'), 'debit');
});

test('normalizeLegacyUser preserves the legacy-user mapping contract', () => {
  assert.equal(normalizeLegacyUser({ UserId: 77 }), 'legacy_user_77');
  assert.equal(normalizeLegacyUser({ UserId: null }), 'legacy_import_user');
});
