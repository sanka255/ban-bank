const express = require('express');
const prisma = require('../prisma');
const { checkPartitionAvailability } = require('../services/availabilityService');
const { cancelDateSlot } = require('../services/cancellationService');

const router = express.Router();

function parseDateSlotInput(slot) {
  return {
    fromDate: new Date(`${slot.fromDate}T00:00:00.000Z`),
    toDate:   new Date(`${slot.toDate}T00:00:00.000Z`),
    fromTime: new Date(`1970-01-01T${slot.fromTime}:00.000Z`),
    toTime:   new Date(`1970-01-01T${slot.toTime}:00.000Z`),
  };
}

// ─── PUT /api/banquet/date-slots/:id ─────────────────────────────────────────
// Edit a slot's date/time in-place (minor adjustments; for full postponement use /postpone)

router.put('/:id', async (req, res) => {
  try {
    const slotId = Number(req.params.id);
    const { fromDate, toDate, fromTime, toTime, charge } = req.body;

    const existing = await prisma.banquetDateSlot.findUnique({ where: { id: slotId } });
    if (!existing) return res.status(404).json({ error: 'Date slot not found' });
    if (existing.status === 'cancelled') return res.status(409).json({ error: 'Cannot edit a cancelled slot' });

    // Re-run availability excluding this slot
    if (fromDate || toDate || fromTime || toTime) {
      const avail = await checkPartitionAvailability({
        partitionId: existing.partitionId,
        fromDate:    fromDate  || existing.fromDate.toISOString().slice(0, 10),
        toDate:      toDate    || existing.toDate.toISOString().slice(0, 10),
        fromTime:    fromTime  || existing.fromTime.toISOString().slice(11, 16),
        toTime:      toTime    || existing.toTime.toISOString().slice(11, 16),
        excludeDateSlotId: slotId,
      });
      if (!avail.available) {
        return res.status(409).json({ error: 'Updated time conflicts with existing booking', conflicts: avail.conflicts });
      }
    }

    const updateData = {};
    if (fromDate) updateData.fromDate = new Date(`${fromDate}T00:00:00.000Z`);
    if (toDate)   updateData.toDate   = new Date(`${toDate}T00:00:00.000Z`);
    if (fromTime) updateData.fromTime = new Date(`1970-01-01T${fromTime}:00.000Z`);
    if (toTime)   updateData.toTime   = new Date(`1970-01-01T${toTime}:00.000Z`);
    if (charge != null) updateData.charge = Number(charge);

    const slot = await prisma.banquetDateSlot.update({
      where: { id: slotId },
      data: updateData,
      include: { partition: { include: { hall: true } }, reservation: true },
    });
    res.json(slot);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Date slot not found' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update date slot' });
  }
});

// ─── POST /api/banquet/date-slots/:id/cancel ─────────────────────────────────

router.post('/:id/cancel', async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await cancelDateSlot(Number(req.params.id), req.user.id, reason);

    res.json({
      ...result,
      // Explicitly surface the "no tier matched" case so staff see it clearly
      warning: !result.tierMatched
        ? `No cancellation tier matched ${result.daysBeforeEvent} days before event — refund defaulted to 0%`
        : undefined,
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to cancel date slot' });
  }
});

// ─── POST /api/banquet/date-slots/:id/postpone ───────────────────────────────
//
// Marks the existing slot `postponed` (preserving history) and creates a new
// `active` slot with the new dates on the same partition.

router.post('/:id/postpone', async (req, res) => {
  try {
    const slotId = Number(req.params.id);
    const { fromDate, toDate, fromTime, toTime } = req.body;

    if (!fromDate || !toDate || !fromTime || !toTime) {
      return res.status(400).json({ error: 'fromDate, toDate, fromTime, and toTime are required' });
    }

    const existing = await prisma.banquetDateSlot.findUnique({
      where: { id: slotId },
      include: { reservation: true },
    });
    if (!existing) return res.status(404).json({ error: 'Date slot not found' });
    if (existing.status !== 'active') {
      return res.status(409).json({ error: `Cannot postpone a slot with status '${existing.status}'` });
    }

    // Check availability for new window, excluding the current slot
    const avail = await checkPartitionAvailability({
      partitionId: existing.partitionId,
      fromDate,
      toDate,
      fromTime,
      toTime,
      excludeDateSlotId: slotId,
    });
    if (!avail.available) {
      return res.status(409).json({ error: 'New time slot conflicts with an existing booking', conflicts: avail.conflicts });
    }

    // Atomic: mark old slot postponed + create new active slot
    const [postponedSlot, newSlot] = await prisma.$transaction([
      prisma.banquetDateSlot.update({
        where: { id: slotId },
        data: { status: 'postponed' },
      }),
      prisma.banquetDateSlot.create({
        data: {
          reservationId: existing.reservationId,
          partitionId:   existing.partitionId,
          ...parseDateSlotInput({ fromDate, toDate, fromTime, toTime }),
          charge: existing.charge, // inherit charge; staff can edit separately
          status: 'active',
        },
        include: { partition: { include: { hall: true } } },
      }),
    ]);

    res.status(201).json({
      message: 'Slot postponed — original preserved, new slot created',
      postponedSlot,
      newSlot,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to postpone date slot' });
  }
});

// ─── POST /api/banquet/date-slots/:id/change-hall ─────────────────────────────
// Reassigns slot to a new hall partition with availability verification & audit log
router.post('/:id/change-hall', async (req, res) => {
  try {
    const slotId = Number(req.params.id);
    const { newPartitionId, reason } = req.body;

    if (!newPartitionId) {
      return res.status(400).json({ error: 'newPartitionId is required' });
    }

    const existing = await prisma.banquetDateSlot.findUnique({
      where: { id: slotId },
      include: { partition: true, reservation: true },
    });
    if (!existing) return res.status(404).json({ error: 'Date slot not found' });
    if (existing.status === 'cancelled') return res.status(409).json({ error: 'Cannot change hall for a cancelled slot' });

    const targetPartitionId = Number(newPartitionId);
    if (targetPartitionId === existing.partitionId) {
      return res.status(400).json({ error: 'Target partition is the same as current partition' });
    }

    // Verify availability on target partition
    const avail = await checkPartitionAvailability({
      partitionId: targetPartitionId,
      fromDate: existing.fromDate.toISOString().slice(0, 10),
      toDate: existing.toDate.toISOString().slice(0, 10),
      fromTime: existing.fromTime.toISOString().slice(11, 16),
      toTime: existing.toTime.toISOString().slice(11, 16),
      forStatus: existing.reservation.status,
    });

    if (existing.reservation.status === 'guaranteed' && avail.hasGuaranteedConflict) {
      return res.status(409).json({
        error: 'Target partition has a conflicting guaranteed reservation for this time slot',
        conflicts: avail.guaranteedConflicts,
      });
    }

    const [log, updatedSlot] = await prisma.$transaction([
      prisma.hallChangeLog.create({
        data: {
          reservationId: existing.reservationId,
          dateSlotId: slotId,
          oldPartitionId: existing.partitionId,
          newPartitionId: targetPartitionId,
          reason: reason?.trim() || null,
          changedBy: req.user?.id || 1,
        },
        include: { oldPartition: true, newPartition: true },
      }),
      prisma.banquetDateSlot.update({
        where: { id: slotId },
        data: { partitionId: targetPartitionId },
        include: { partition: { include: { hall: true } } },
      }),
    ]);

    res.json({
      message: 'Hall partition changed successfully',
      slot: updatedSlot,
      log,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to change hall partition' });
  }
});

// ─── POST /api/banquet/date-slots/:id/requested-packages ─────────────────────
router.post('/:id/requested-packages', async (req, res) => {
  try {
    const dateSlotId = Number(req.params.id);
    const { packageId, guestCount, isComplementary = false, reason } = req.body;

    if (!packageId || guestCount == null) {
      return res.status(400).json({ error: 'packageId and guestCount are required' });
    }
    if (isComplementary && !reason?.trim()) {
      return res.status(400).json({ error: 'reason is required when isComplementary is true' });
    }

    const pkg = await prisma.eventPackage.findUnique({ where: { id: Number(packageId) } });
    if (!pkg) return res.status(404).json({ error: 'Event package not found' });
    if (!pkg.isActive) return res.status(409).json({ error: 'Event package is inactive' });

    const count = Number(guestCount);
    const unitPrice = Number(pkg.price);
    const charge = isComplementary ? 0 : pkg.isPerHead ? Number((unitPrice * count).toFixed(2)) : unitPrice;

    const reqPkg = await prisma.requestedPackage.create({
      data: {
        dateSlotId,
        packageId: pkg.id,
        guestCount: count,
        unitPrice,
        charge,
        isComplementary: Boolean(isComplementary),
        reason: isComplementary ? reason.trim() : null,
      },
      include: { package: { include: { items: true } } },
    });

    res.status(201).json(reqPkg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to attach package to slot' });
  }
});

// ─── DELETE /api/banquet/date-slots/:id/requested-packages/:rpId ─────────────
router.delete('/:id/requested-packages/:rpId', async (req, res) => {
  try {
    const dateSlotId = Number(req.params.id);
    const rpId = Number(req.params.rpId);

    // Billed integrity guard (C5)
    const billedCount = await prisma.guestBillLine.count({ where: { dateSlotId } });
    if (billedCount > 0) {
      return res.status(409).json({
        error: 'Cannot delete package: a bill has already been generated for this date slot. Void or regenerate the bill first.',
      });
    }

    await prisma.requestedPackage.delete({ where: { id: rpId } });
    res.json({ message: 'Package removed from date slot' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Requested package not found' });
    console.error(err);
    res.status(500).json({ error: 'Failed to remove package from slot' });
  }
});

module.exports = router;
