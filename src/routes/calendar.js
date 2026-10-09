const express = require('express');
const prisma = require('../prisma');

const router = express.Router();

/**
 * GET /api/banquet/calendar
 *
 * Query params:
 *   fromDate {string} required  "YYYY-MM-DD"
 *   toDate   {string} required  "YYYY-MM-DD"
 *   hallId   {number} optional  filter to one hall
 *
 * Returns all non-cancelled date slots in the range, grouped by hall → partition,
 * ready for the tape-chart calendar UI.
 */
router.get('/', async (req, res) => {
  const { fromDate, toDate, hallId } = req.query;
  if (!fromDate || !toDate) {
    return res.status(400).json({ error: 'fromDate and toDate are required' });
  }

  const fromDateObj = new Date(`${fromDate}T00:00:00.000Z`);
  const toDateObj   = new Date(`${toDate}T00:00:00.000Z`);

  try {
    // Load halls (optionally filtered)
    const halls = await prisma.banquetHall.findMany({
      where: hallId ? { id: Number(hallId) } : undefined,
      include: {
        partitions: {
          where: { status: 'active' },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: { id: 'asc' },
    });

    // Load slots in date range (date-overlap: slot.fromDate ≤ toDate AND slot.toDate ≥ fromDate)
    const slots = await prisma.banquetDateSlot.findMany({
      where: {
        status: { not: 'cancelled' },
        fromDate: { lte: toDateObj },
        toDate:   { gte: fromDateObj },
        ...(hallId
          ? { partition: { hallId: Number(hallId) } }
          : {}),
      },
      include: {
        reservation: {
          include: { guest: { select: { firstName: true, lastName: true } } },
        },
        partition: { select: { id: true, name: true, hallId: true } },
      },
      orderBy: { fromDate: 'asc' },
    });

    // Group slots by partitionId for quick lookup
    const slotsByPartition = {};
    for (const slot of slots) {
      (slotsByPartition[slot.partitionId] ??= []).push(slot);
    }

    // Build response: halls → partitions → slots
    const response = halls.map((hall) => ({
      id: hall.id,
      name: hall.name,
      isPartitioned: hall.isPartitioned,
      partitions: hall.partitions.map((partition) => ({
        id: partition.id,
        name: partition.name,
        status: partition.status,
        slots: (slotsByPartition[partition.id] ?? []).map((s) => ({
          id: s.id,
          reservationId: s.reservationId,
          reservationCode: s.reservation.reservationCode,
          reservationStatus: s.reservation.status,
          guestName: `${s.reservation.guest.firstName} ${s.reservation.guest.lastName ?? ''}`.trim(),
          numberOfGuests: s.reservation.numberOfGuests,
          fromDate: s.fromDate.toISOString().slice(0, 10),
          toDate:   s.toDate.toISOString().slice(0, 10),
          fromTime: s.fromTime.toISOString().slice(11, 16),
          toTime:   s.toTime.toISOString().slice(11, 16),
          charge: s.charge,
          status: s.status,
        })),
      })),
    }));

    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch calendar data' });
  }
});

module.exports = router;
