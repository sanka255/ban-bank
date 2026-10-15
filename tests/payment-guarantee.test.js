const test = require('node:test');
const assert = require('node:assert/strict');
const {
  transitionToGuaranteed,
  applyReservationPaymentCategory,
} = require('../src/services/paymentGuaranteeService');

function makeReservation(status = 'tentative') {
  return {
    id: 42,
    status,
    dateSlots: [{
      id: 7,
      partitionId: 11,
      fromDate: new Date('2026-01-01T00:00:00Z'),
      toDate: new Date('2026-01-01T00:00:00Z'),
      fromTime: new Date('1970-01-01T09:00:00Z'),
      toTime: new Date('1970-01-01T12:00:00Z'),
      partition: { name: 'Grand Hall' },
    }],
  };
}

test('advance on tentative gives guaranteed', async () => {
  const reservation = makeReservation('tentative');
  const calls = [];
  const tx = {
    banquetReservation: {
      update: async ({ where, data }) => {
        calls.push({ type: 'reservation-update', where, data });
        return { ...reservation, status: data.status };
      },
    },
    reservationAuditLog: {
      create: async ({ data }) => {
        calls.push({ type: 'audit', data });
        return data;
      },
    },
    banquetDateSlot: {
      findMany: async () => reservation.dateSlots,
    },
  };

  const result = await applyReservationPaymentCategory({
    tx,
    reservation,
    category: 'advance',
    amount: 500,
    userId: 9,
    paymentId: 202,
    note: 'advance payment',
    checkAvailability: async () => ({ hasGuaranteedConflict: false, guaranteedConflicts: [] }),
  });

  assert.equal(result.changed, true);
  assert.equal(result.newStatus, 'guaranteed');
  assert.equal(calls.some((call) => call.type === 'reservation-update'), true);
  assert.equal(calls.some((call) => call.type === 'audit'), true);
});

test('advance on already-guaranteed reservation changes nothing', async () => {
  const reservation = makeReservation('guaranteed');
  const calls = [];
  const tx = {
    banquetReservation: {
      update: async ({ where, data }) => {
        calls.push({ type: 'reservation-update', where, data });
        return { ...reservation, status: data.status };
      },
    },
    reservationAuditLog: {
      create: async ({ data }) => {
        calls.push({ type: 'audit', data });
        return data;
      },
    },
    banquetDateSlot: {
      findMany: async () => reservation.dateSlots,
    },
  };

  const result = await applyReservationPaymentCategory({
    tx,
    reservation,
    category: 'advance',
    amount: 500,
    userId: 9,
    paymentId: 203,
    note: 'advance payment',
    checkAvailability: async () => ({ hasGuaranteedConflict: true, guaranteedConflicts: [{}] }),
  });

  assert.equal(result.changed, false);
  assert.equal(calls.length, 0);
});

test('room conflict returns a clear 409 instead of failing silently', async () => {
  const reservation = makeReservation('tentative');
  const tx = {
    banquetReservation: { update: async () => ({}) },
    reservationAuditLog: { create: async () => ({}) },
    banquetDateSlot: { findMany: async () => reservation.dateSlots },
  };

  await assert.rejects(
    () => applyReservationPaymentCategory({
      tx,
      reservation,
      category: 'full',
      amount: 500,
      userId: 9,
      paymentId: 204,
      note: 'full payment',
      checkAvailability: async () => ({ hasGuaranteedConflict: true, guaranteedConflicts: [{ reservation: { reservationCode: 'BNQ-123' } }] }),
    }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /room conflict|guaranteed reservation/i);
      return true;
    }
  );
});
