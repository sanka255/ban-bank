function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function calculateExtraChargeAmounts({ unitPrice, quantity, taxRate = 0, isComplementary = false }) {
  const price = round2(unitPrice ?? 0);
  const qty = Number(quantity ?? 0);
  const charge = round2(price * qty);
  const taxAmount = round2(charge * Number(taxRate || 0));
  const chargeWithTax = round2(charge + taxAmount);

  return {
    unitPrice: price,
    quantity: qty,
    charge,
    taxAmount,
    chargeWithTax,
    billableAmount: isComplementary ? 0 : chargeWithTax,
  };
}

function validateExtraChargePayload(payload = {}) {
  const chargeType = (payload.chargeType || payload.category || '').toLowerCase();
  const allowed = ['hall', 'food', 'beverage', 'item', 'miscellaneous'];

  if (!allowed.includes(chargeType)) {
    return { valid: false, error: 'chargeType must be one of: hall, food, beverage, item, miscellaneous.' };
  }

  if (!payload.description || !String(payload.description).trim()) {
    return { valid: false, error: 'description is required.' };
  }

  const unitPrice = Number(payload.unitPrice ?? 0);
  const quantity = Number(payload.quantity ?? 0);

  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return { valid: false, error: 'unitPrice must be a valid non-negative number.' };
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { valid: false, error: 'quantity must be greater than zero.' };
  }

  if (payload.isComplementary && (!payload.reason || !String(payload.reason).trim())) {
    return { valid: false, error: 'reason is required when the charge is complementary.' };
  }

  return { valid: true };
}

function buildExtraChargeSummary(rows = []) {
  const activeRows = rows.filter((row) => row?.status !== 'voided');
  const voidedRows = rows.filter((row) => row?.status === 'voided');

  const totals = activeRows.reduce(
    (acc, row) => {
      const charge = Number(row?.charge ?? 0);
      const tax = Number(row?.taxAmount ?? 0);
      const total = Number(row?.chargeWithTax ?? charge + tax);
      acc.totalWithoutTax += charge;
      acc.totalTax += tax;
      acc.totalWithTax += total;
      return acc;
    },
    { totalWithoutTax: 0, totalTax: 0, totalWithTax: 0 }
  );

  return {
    ...totals,
    voidedCount: voidedRows.length,
    activeCount: activeRows.length,
  };
}

function buildReservationChargeSummary({ billLines = [], extraCharges = [], dateSlots = [] } = {}) {
  const lineRows = Array.isArray(billLines) ? billLines : [];
  const extraRows = Array.isArray(extraCharges) ? extraCharges : [];
  const slotRows = Array.isArray(dateSlots) ? dateSlots : [];

  const categoryMap = {
    hall_charge: { label: 'Hall Charge', base: 0, tax: 0, total: 0 },
    item: { label: 'Item Charges', base: 0, tax: 0, total: 0 },
    menu: { label: 'Menu Charges', base: 0, tax: 0, total: 0 },
    extra: { label: 'Extra Charges', base: 0, tax: 0, total: 0 },
  };

  for (const line of lineRows) {
    const type = String(line?.lineType ?? 'item').toLowerCase();
    const base = Number(line?.charge ?? 0);
    const tax = Number(line?.taxAmount ?? 0);
    const total = Number(line?.chargeWithTax ?? base + tax);
    const target = categoryMap[type] || categoryMap.item;
    target.base += base;
    target.tax += tax;
    target.total += total;
  }

  const pendingSlotBreakdown = slotRows
    .filter((slot) => !Array.isArray(slot?.guestBillLines) || slot.guestBillLines.length === 0)
    .reduce((acc, slot) => {
      const hallCharge = Number(slot?.charge ?? 0);
      const itemCharge = Array.isArray(slot?.requestedItems)
        ? slot.requestedItems.reduce((sum, item) => sum + Number(item?.charge ?? 0), 0)
        : 0;
      const menuCharge = Array.isArray(slot?.requestedMenuItems)
        ? slot.requestedMenuItems.reduce((sum, item) => sum + Number(item?.charge ?? 0), 0)
        : 0;

      acc.hall += hallCharge;
      acc.item += itemCharge;
      acc.menu += menuCharge;
      return acc;
    }, { hall: 0, item: 0, menu: 0 });

  categoryMap.hall_charge.base += pendingSlotBreakdown.hall;
  categoryMap.hall_charge.total += pendingSlotBreakdown.hall;
  categoryMap.item.base += pendingSlotBreakdown.item;
  categoryMap.item.total += pendingSlotBreakdown.item;
  categoryMap.menu.base += pendingSlotBreakdown.menu;
  categoryMap.menu.total += pendingSlotBreakdown.menu;

  const billedBase = lineRows.reduce((sum, line) => sum + Number(line?.charge ?? 0), 0);
  const billedTax = lineRows.reduce((sum, line) => sum + Number(line?.taxAmount ?? 0), 0);
  const billedWithTax = lineRows.reduce((sum, line) => sum + Number(line?.chargeWithTax ?? Number(line?.charge ?? 0) + Number(line?.taxAmount ?? 0)), 0);

  const pendingExtraCharges = extraRows.filter((row) => row?.status !== 'voided' && row?.billLineId == null);
  const pendingBase = pendingExtraCharges.reduce((sum, row) => sum + (row?.isComplementary ? 0 : Number(row?.charge ?? 0)), 0);
  const pendingTax = pendingExtraCharges.reduce((sum, row) => sum + (row?.isComplementary ? 0 : Number(row?.taxAmount ?? 0)), 0);
  const pendingWithTax = pendingExtraCharges.reduce((sum, row) => sum + (row?.isComplementary ? 0 : Number(row?.chargeWithTax ?? Number(row?.charge ?? 0) + Number(row?.taxAmount ?? 0))), 0);

  const baseFromPendingSelections = pendingSlotBreakdown.hall + pendingSlotBreakdown.item + pendingSlotBreakdown.menu;
  const totalBaseCharge = Number((billedBase + pendingBase + baseFromPendingSelections).toFixed(2));
  const totalTax = Number((billedTax + pendingTax).toFixed(2));
  const totalWithTax = Number((billedWithTax + pendingWithTax + baseFromPendingSelections).toFixed(2));

  const chargeBreakdown = Object.entries(categoryMap)
    .map(([key, value]) => ({
      type: key,
      label: value.label,
      base: Number(value.base.toFixed(2)),
      tax: Number(value.tax.toFixed(2)),
      total: Number(value.total.toFixed(2)),
    }))
    .filter((item) => item.total > 0 || item.type === 'extra');

  const extraBreakdown = pendingExtraCharges.reduce((acc, row) => {
    const base = row?.isComplementary ? 0 : Number(row?.charge ?? 0);
    const tax = row?.isComplementary ? 0 : Number(row?.taxAmount ?? 0);
    const total = row?.isComplementary ? 0 : Number(row?.chargeWithTax ?? base + tax);
    acc.base += base;
    acc.tax += tax;
    acc.total += total;
    return acc;
  }, { base: 0, tax: 0, total: 0 });

  const extraEntry = chargeBreakdown.find((item) => item.type === 'extra');
  if (extraEntry) {
    extraEntry.base = Number((extraEntry.base + extraBreakdown.base).toFixed(2));
    extraEntry.tax = Number((extraEntry.tax + extraBreakdown.tax).toFixed(2));
    extraEntry.total = Number((extraEntry.total + extraBreakdown.total).toFixed(2));
  } else if (extraBreakdown.total > 0) {
    chargeBreakdown.push({
      type: 'extra',
      label: 'Extra Charges',
      base: Number(extraBreakdown.base.toFixed(2)),
      tax: Number(extraBreakdown.tax.toFixed(2)),
      total: Number(extraBreakdown.total.toFixed(2)),
    });
  }

  return {
    totalBaseCharge,
    totalTax,
    totalWithTax,
    extraChargeTotal: Number(pendingWithTax.toFixed(2)),
    pendingExtraChargeCount: pendingExtraCharges.length,
    pendingExtraCharges,
    chargeBreakdown,
  };
}

function buildReservationPaymentSummary({ totalWithTax = 0, deposits = [], paymentTransactions = [] } = {}) {
  const depositRows = Array.isArray(deposits) ? deposits : [];
  const txRows = Array.isArray(paymentTransactions) ? paymentTransactions : [];

  const totalDeposits = depositRows.reduce((sum, deposit) => sum + Number(deposit?.amount ?? 0), 0);
  const settledDeposits = depositRows.filter((deposit) => Boolean(deposit?.settled)).reduce((sum, deposit) => sum + Number(deposit?.amount ?? 0), 0);

  const capturedPayments = txRows
    .filter((tx) => String(tx?.status ?? '').toLowerCase() === 'captured')
    .reduce((sum, tx) => sum + Number(tx?.amount ?? 0), 0);

  const pendingPayments = txRows.filter((tx) => {
    const status = String(tx?.status ?? '').toLowerCase();
    return status === 'pending' || status === 'processing';
  });

  const pendingPaymentTotal = pendingPayments.reduce((sum, tx) => sum + Number(tx?.amount ?? 0), 0);
  const pendingPaymentCount = pendingPayments.length;

  const totalReceived = Number((totalDeposits + capturedPayments).toFixed(2));
  const outstandingBalance = Number(Math.max(0, Number(totalWithTax ?? 0) - totalReceived).toFixed(2));

  return {
    totalDeposits: Number(totalDeposits.toFixed(2)),
    settledDeposits: Number(settledDeposits.toFixed(2)),
    capturedPayments: Number(capturedPayments.toFixed(2)),
    pendingPaymentTotal: Number(pendingPaymentTotal.toFixed(2)),
    pendingPaymentCount,
    pendingPayments,
    totalReceived,
    outstandingBalance,
  };
}

module.exports = {
  calculateExtraChargeAmounts,
  validateExtraChargePayload,
  buildExtraChargeSummary,
  buildReservationChargeSummary,
  buildReservationPaymentSummary,
};
