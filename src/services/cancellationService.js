const prisma = require('../prisma');
const { Prisma } = require('@prisma/client');
const { postCancellationToGL } = require('./glService');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * toMinutes — mirrors availabilityService.js for date-only comparisons here.
 * `daysBeforeEvent` computed in integer days so we don't need this, but kept
 * in module for any future time arithmetic.
 */
function toDec(val) {
  return new Prisma.Decimal(String(val));
}

// ─── Core cancellation logic ─────────────────────────────────────────────────

/**
 * cancelDateSlot
 *
 * Computes the refund based on the matching HallCancellationTier, creates a
 * HallWithdrawal record, marks the slot `cancelled`, and — if all sibling slots
 * are now cancelled — marks the parent reservation `cancelled` too.
 *
 * All DB writes in a single transaction.
 *
 * @returns {{ withdrawal, slot, tierMatched: boolean, reservationCancelled: boolean }}
 */
async function cancelDateSlot(dateSlotId, userId, reason = null) {
  // ── 1. Load slot + siblings ──────────────────────────────────────────────
  const slot = await prisma.banquetDateSlot.findUnique({
    where: { id: dateSlotId },
    include: { reservation: { include: { dateSlots: true } } },
  });

  if (!slot) throw Object.assign(new Error('Date slot not found'), { statusCode: 404 });
  if (slot.status === 'cancelled') throw Object.assign(new Error('Slot is already cancelled'), { statusCode: 409 });

  // ── 2. Compute days before event ─────────────────────────────────────────
  // slot.fromDate is a Date object (from @db.Date); compare to start of today UTC
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daysBeforeEvent = Math.floor((slot.fromDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  // ── 3. Find matching cancellation tier ───────────────────────────────────
  const tier = await prisma.hallCancellationTier.findFirst({
    where: {
      daysMin: { lte: daysBeforeEvent },
      daysMax: { gte: daysBeforeEvent },
    },
  });
  const tierMatched = !!tier;
  const refundPct = tier ? toDec(tier.refundPct) : toDec(0);

  // ── 4. Compute amounts ───────────────────────────────────────────────────
  const fullCharge = toDec(slot.charge);
  const refundableAmount = fullCharge.mul(refundPct).div(100).toDecimalPlaces(2);
  const cancellationFee = fullCharge.sub(refundableAmount).toDecimalPlaces(2);

  // ── 5. Determine if parent reservation will be fully cancelled ───────────
  const siblingStatuses = slot.reservation.dateSlots
    .filter((s) => s.id !== dateSlotId)
    .map((s) => s.status);
  const allWillBeCancelled = siblingStatuses.every((s) => s === 'cancelled' || s === 'postponed');

  // ── 6. Transaction: write withdrawal + update slot (+ maybe reservation) ─
  const [withdrawal, updatedSlot] = await prisma.$transaction([
    prisma.hallWithdrawal.create({
      data: {
        reservationId: slot.reservationId,
        dateSlotId: slot.id,
        tierIdApplied: tier ? tier.id : null,
        refundableAmount,
        refundPercentage: refundPct,
        cancellationFee,
        fullCharge,
        userId,
        reason: reason || null,
      },
    }),
    prisma.banquetDateSlot.update({
      where: { id: dateSlotId },
      data: { status: 'cancelled' },
    }),
    ...(allWillBeCancelled
      ? [
          prisma.banquetReservation.update({
            where: { id: slot.reservationId },
            data: { status: 'cancelled' },
          }),
        ]
      : []),
  ]);

  await prisma.$transaction(async (tx) => {
    await postCancellationToGL(tx, {
      id: withdrawal.id,
      refundableAmount: refundableAmount.toNumber ? refundableAmount.toNumber() : Number(refundableAmount),
      cancellationFee: cancellationFee.toNumber ? cancellationFee.toNumber() : Number(cancellationFee),
    }, userId);
  });

  return {
    withdrawal,
    slot: updatedSlot,
    tierMatched,
    daysBeforeEvent,
    refundPct: refundPct.toNumber(),
    refundableAmount: refundableAmount.toNumber(),
    cancellationFee: cancellationFee.toNumber(),
    reservationCancelled: allWillBeCancelled,
  };
}

/**
 * cancelReservation
 *
 * Cancels all active/postponed date slots for a reservation in one atomic
 * transaction and sets the reservation status to `cancelled`.
 *
 * @returns {{ withdrawals[], reservationId, slotsCancelled: number }}
 */
async function cancelReservation(reservationId, userId, reason = null) {
  const reservation = await prisma.banquetReservation.findUnique({
    where: { id: reservationId },
    include: { dateSlots: true },
  });
  if (!reservation) throw Object.assign(new Error('Reservation not found'), { statusCode: 404 });
  if (reservation.status === 'cancelled') {
    throw Object.assign(new Error('Reservation is already cancelled'), { statusCode: 409 });
  }

  const activeSlots = reservation.dateSlots.filter((s) => s.status === 'active' || s.status === 'postponed');

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Build withdrawal data for each slot
  const withdrawalData = await Promise.all(
    activeSlots.map(async (slot) => {
      const daysBeforeEvent = Math.floor((slot.fromDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const tier = await prisma.hallCancellationTier.findFirst({
        where: { daysMin: { lte: daysBeforeEvent }, daysMax: { gte: daysBeforeEvent } },
      });
      const refundPct = tier ? toDec(tier.refundPct) : toDec(0);
      const fullCharge = toDec(slot.charge);
      const refundableAmount = fullCharge.mul(refundPct).div(100).toDecimalPlaces(2);
      const cancellationFee = fullCharge.sub(refundableAmount).toDecimalPlaces(2);
      return { slot, tier, refundPct, refundableAmount, cancellationFee, fullCharge, tierMatched: !!tier };
    })
  );

  // Execute everything in one transaction
  const createdWithdrawals = await prisma.$transaction([
    ...withdrawalData.map(({ slot, refundPct, refundableAmount, cancellationFee, fullCharge, tier }) =>
      prisma.hallWithdrawal.create({
        data: {
          reservationId,
          dateSlotId: slot.id,
          tierIdApplied: tier ? tier.id : null,
          refundableAmount,
          refundPercentage: refundPct,
          cancellationFee,
          fullCharge,
          userId,
          reason: reason || null,
        },
      })
    ),
    ...activeSlots.map((slot) =>
      prisma.banquetDateSlot.update({ where: { id: slot.id }, data: { status: 'cancelled' } })
    ),
    prisma.banquetReservation.update({ where: { id: reservationId }, data: { status: 'cancelled' } }),
  ]);

  for (const withdrawal of createdWithdrawals.slice(0, activeSlots.length)) {
    await prisma.$transaction(async (tx) => {
      await postCancellationToGL(tx, {
        id: withdrawal.id,
        refundableAmount: Number(withdrawal.refundableAmount || 0),
        cancellationFee: Number(withdrawal.cancellationFee || 0),
      }, userId);
    });
  }

  return {
    reservationId,
    slotsCancelled: activeSlots.length,
    withdrawals: withdrawalData.map((d) => ({
      slotId: d.slot.id,
      tierMatched: d.tierMatched,
      refundPct: d.refundPct.toNumber(),
      refundableAmount: d.refundableAmount.toNumber(),
      cancellationFee: d.cancellationFee.toNumber(),
    })),
  };
}

module.exports = { cancelDateSlot, cancelReservation };
