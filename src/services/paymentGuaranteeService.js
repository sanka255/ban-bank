const { checkPartitionAvailability } = require('./availabilityService');

function normalizePaymentCategory(category) {
  const raw = typeof category === 'string' ? category.trim().toLowerCase() : '';
  return raw === 'full' || raw === 'advance' ? raw : 'advance';
}

async function transitionToGuaranteed({
  tx,
  reservation,
  category,
  amount,
  userId,
  paymentId,
  note,
  checkAvailability = checkPartitionAvailability,
}) {
  if (!reservation || reservation.status !== 'tentative') {
    return { changed: false, previousStatus: reservation?.status || null, newStatus: reservation?.status || null };
  }

  const normalizedCategory = normalizePaymentCategory(category);
  if (!['advance', 'full'].includes(normalizedCategory)) {
    return { changed: false, previousStatus: reservation.status, newStatus: reservation.status };
  }

  const slots = await tx.banquetDateSlot.findMany({
    where: { reservationId: reservation.id, status: 'active' },
    include: { partition: true },
  });

  for (const slot of slots) {
    const availability = await checkAvailability({
      partitionId: slot.partitionId,
      fromDate: slot.fromDate,
      toDate: slot.toDate,
      fromTime: slot.fromTime,
      toTime: slot.toTime,
      excludeDateSlotId: slot.id,
      forStatus: 'guaranteed',
    });

    if (availability?.hasGuaranteedConflict) {
      const conflict = availability.guaranteedConflicts?.[0] || null;
      const partitionName = slot.partition?.name || `partition ${slot.partitionId}`;
      const error = new Error(
        `Cannot promote tentative reservation to guaranteed: room conflict on ${partitionName}. Another guaranteed reservation already occupies this slot.`
      );
      error.statusCode = 409;
      error.conflicts = availability.guaranteedConflicts || [];
      error.reservationCode = conflict?.reservation?.reservationCode || reservation.reservationCode || null;
      throw error;
    }
  }

  console.log('[transitionToGuaranteed]', {
    reservationId: reservation.id,
    previousStatus: reservation.status,
    newStatus: 'guaranteed',
    category: normalizedCategory,
    amount,
    paymentId,
    userId,
    note,
  });

  const updated = await tx.banquetReservation.update({
    where: { id: reservation.id },
    data: { status: 'guaranteed' },
  });

  if (tx.reservationAuditLog && typeof tx.reservationAuditLog.create === 'function') {
    try {
      await tx.reservationAuditLog.create({
        data: {
          reservationId: reservation.id,
          actorId: userId || null,
          action: 'payment_guarantee_transition',
          oldStatus: 'tentative',
          newStatus: 'guaranteed',
          paymentCategory: normalizedCategory,
          amount: amount != null ? Number(amount) : null,
          note: note || `${normalizedCategory} payment promoted reservation to guaranteed`,
        },
      });
    } catch (auditErr) {
      if (auditErr?.code !== 'P2021') {
        throw auditErr;
      }
      console.warn('[transitionToGuaranteed] ReservationAuditLog table missing; skipping audit entry.', {
        reservationId: reservation.id,
        action: 'payment_guarantee_transition',
      });
    }
  }

  return { changed: true, previousStatus: reservation.status, newStatus: updated.status };
}

async function applyReservationPaymentCategory(params) {
  return transitionToGuaranteed(params);
}

module.exports = {
  normalizePaymentCategory,
  transitionToGuaranteed,
  applyReservationPaymentCategory,
};
