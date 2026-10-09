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

module.exports = router;
