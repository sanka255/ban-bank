const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateExtraChargeAmounts,
  buildExtraChargeSummary,
  buildReservationChargeSummary,
  buildReservationPaymentSummary,
  validateExtraChargePayload,
} = require('../src/services/extraChargeService');
const {
  listExtraChargeItems,
  searchExtraChargeItems,
  createExtraChargeItem,
  updateExtraChargeItem,
  deleteExtraChargeItem,
} = require('../src/services/extraChargeCatalogService');
const { resolveReservationId } = require('../src/routes/extraCharges');

test('calculateExtraChargeAmounts multiplies price and quantity and applies tax once', () => {
  const result = calculateExtraChargeAmounts({
    unitPrice: 2500,
    quantity: 5,
    taxRate: 0.18,
    isComplementary: false,
  });

  assert.equal(result.charge, 12500);
  assert.equal(result.taxAmount, 2250);
  assert.equal(result.chargeWithTax, 14750);
});

test('complementary extras still record the cost but bill at zero and require a reason', () => {
  const validation = validateExtraChargePayload({
    chargeType: 'hall',
    description: 'Extra hour',
    unitPrice: 1500,
    quantity: 1,
    isComplementary: true,
    reason: '',
  });
  assert.equal(validation.valid, false);
  assert.match(validation.error, /reason/i);

  const result = calculateExtraChargeAmounts({
    unitPrice: 1500,
    quantity: 1,
    taxRate: 0.18,
    isComplementary: true,
  });

  assert.equal(result.charge, 1500);
  assert.equal(result.taxAmount, 270);
  assert.equal(result.chargeWithTax, 1770);
  assert.equal(result.billableAmount, 0);
});

test('buildExtraChargeSummary excludes voided rows from totals but keeps them in list output', () => {
  const summary = buildExtraChargeSummary([
    { status: 'active', charge: 2000, taxAmount: 360, chargeWithTax: 2360 },
    { status: 'voided', charge: 1000, taxAmount: 180, chargeWithTax: 1180 },
  ]);

  assert.equal(summary.totalWithoutTax, 2000);
  assert.equal(summary.totalTax, 360);
  assert.equal(summary.totalWithTax, 2360);
  assert.equal(summary.voidedCount, 1);
});

test('extra charge catalog supports create, search, update and delete', async () => {
  const created = await createExtraChargeItem({
    name: 'Corkage',
    chargeType: 'beverage',
    defaultPrice: 1200,
    accountId: 9,
  });

  assert.ok(created.id);
  assert.equal(created.name, 'Corkage');

  const found = await searchExtraChargeItems('cork');
  assert.ok(found.some((item) => item.name === 'Corkage'));

  const updated = await updateExtraChargeItem(created.id, {
    defaultPrice: 1500,
    isActive: true,
  });
  assert.equal(Number(updated.defaultPrice), 1500);

  const deleted = await deleteExtraChargeItem(created.id);
  assert.equal(deleted.isActive, false);

  const remaining = await listExtraChargeItems({ includeInactive: true, limit: 50 });
  assert.ok(!remaining.some((item) => item.id === created.id && item.isActive));
});

test('buildReservationChargeSummary includes pending extra charges without double counting billed ones', () => {
  const summary = buildReservationChargeSummary({
    billLines: [
      { charge: 1000, taxAmount: 180, chargeWithTax: 1180 },
      { charge: 500, taxAmount: 90, chargeWithTax: 590 },
    ],
    extraCharges: [
      { status: 'active', billLineId: null, charge: 800, taxAmount: 160, chargeWithTax: 960, isComplementary: false },
      { status: 'active', billLineId: 55, charge: 300, taxAmount: 60, chargeWithTax: 360, isComplementary: false },
      { status: 'voided', billLineId: null, charge: 250, taxAmount: 50, chargeWithTax: 300, isComplementary: false },
    ],
  });

  assert.equal(summary.totalBaseCharge, 1500 + 800);
  assert.equal(summary.totalTax, 180 + 90 + 160);
  assert.equal(summary.totalWithTax, 1180 + 590 + 960);
  assert.equal(summary.extraChargeTotal, 960);
  assert.equal(summary.pendingExtraChargeCount, 1);
});

test('buildReservationChargeSummary includes unbilled selected hall and menu charges in the summary', () => {
  const summary = buildReservationChargeSummary({
    billLines: [],
    extraCharges: [],
    dateSlots: [
      {
        charge: 100000,
        guestBillLines: [],
        requestedItems: [{ charge: 25000 }],
        requestedMenuItems: [{ charge: 10000 }],
      },
    ],
  });

  assert.equal(summary.totalBaseCharge, 135000);
  assert.equal(summary.totalWithTax, 135000);
  assert.equal(summary.chargeBreakdown.find((item) => item.type === 'hall_charge')?.total, 100000);
  assert.equal(summary.chargeBreakdown.find((item) => item.type === 'item')?.total, 25000);
  assert.equal(summary.chargeBreakdown.find((item) => item.type === 'menu')?.total, 10000);
});

test('buildReservationPaymentSummary shows pending payment totals separately from received totals', () => {
  const summary = buildReservationPaymentSummary({
    totalWithTax: 380000,
    deposits: [
      { amount: 100000, settled: false },
      { amount: 50000, settled: true },
    ],
    paymentTransactions: [
      { amount: 100000, status: 'captured' },
      { amount: 50000, status: 'pending' },
      { amount: 25000, status: 'failed' },
    ],
  });

  assert.equal(summary.totalDeposits, 150000);
  assert.equal(summary.capturedPayments, 100000);
  assert.equal(summary.pendingPaymentTotal, 50000);
  assert.equal(summary.pendingPaymentCount, 1);
  assert.equal(summary.totalReceived, 250000);
  assert.equal(summary.outstandingBalance, 130000);
});

test('extra charge route resolves reservation id from URL or body', () => {
  assert.equal(resolveReservationId({ params: { id: 24 } }), 24);
  assert.equal(resolveReservationId({ params: { reservationId: 25 } }), 25);
  assert.equal(resolveReservationId({ body: { reservationId: 26 } }), 26);
});
