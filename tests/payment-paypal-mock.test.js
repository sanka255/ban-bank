const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPayPalOrderMock, buildPayPalCaptureMock } = require('../src/services/paymentGateway');

test('buildPayPalOrderMock returns a PayPal-style order payload', () => {
  const order = buildPayPalOrderMock({
    amount: 1500,
    currency: 'LKR',
    reservationId: 42,
  });

  assert.equal(order.intent, 'CAPTURE');
  assert.match(order.id, /^PAY-/);
  assert.equal(order.purchase_units[0].amount.value, '1500.00');
  assert.equal(order.purchase_units[0].reference_id, 'reservation_42');
  assert.ok(order.links.some((link) => link.rel === 'approve'));
});

test('buildPayPalCaptureMock returns a completed capture payload', () => {
  const capture = buildPayPalCaptureMock({
    orderId: 'PAY-123',
    amount: 1500,
    currency: 'LKR',
  });

  assert.equal(capture.status, 'COMPLETED');
  assert.match(capture.id, /^CAP-/);
  assert.equal(capture.purchase_units[0].payments.captures[0].amount.value, '1500.00');
});
