const express = require('express');
const prisma  = require('../prisma');

const router = express.Router({ mergeParams: true });

// ─── GET /api/banquet/reservations/:id/beo ────────────────────────────────────
// Returns full BEO details including all department notes, schedule, menu,
// requested items, packages, and setup instructions for printable view.
router.get('/', async (req, res) => {
  try {
    const reservationId = Number(req.params.id);

    const reservation = await prisma.banquetReservation.findUnique({
      where: { id: reservationId },
      include: {
        guest: true,
        functionAccount: true,
        dateSlots: {
          where: { status: 'active' },
          include: {
            partition: { include: { hall: true } },
            requestedItems: { include: { item: { include: { category: true } } } },
            requestedMenuItems: { include: { menu: true } },
            extraCharges: true,
            requestedPackages: { include: { package: { include: { items: true } } } },
          },
          orderBy: { fromDate: 'asc' },
        },
        beo: true,
        discounts: true,
      },
    });

    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

    res.json({
      reservation,
      beo: reservation.beo || {
        reservationId,
        operationsNotes: '',
        kitchenNotes: '',
        housekeepingNotes: '',
        frontOfficeNotes: '',
        engineeringNotes: '',
        chiefStewardNotes: '',
        securityNotes: '',
        specialInstructions: '',
        roomSetupDetails: '',
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch BEO' });
  }
});

// ─── PUT /api/banquet/reservations/:id/beo ────────────────────────────────────
// Upsert departmental notes for the Function Sheet
router.put('/', async (req, res) => {
  try {
    const reservationId = Number(req.params.id);
    const {
      operationsNotes,
      kitchenNotes,
      housekeepingNotes,
      frontOfficeNotes,
      engineeringNotes,
      chiefStewardNotes,
      securityNotes,
      specialInstructions,
      roomSetupDetails,
    } = req.body;

    const beo = await prisma.banquetEventOrder.upsert({
      where: { reservationId },
      update: {
        operationsNotes:     operationsNotes     !== undefined ? operationsNotes : undefined,
        kitchenNotes:        kitchenNotes        !== undefined ? kitchenNotes : undefined,
        housekeepingNotes:   housekeepingNotes   !== undefined ? housekeepingNotes : undefined,
        frontOfficeNotes:    frontOfficeNotes    !== undefined ? frontOfficeNotes : undefined,
        engineeringNotes:    engineeringNotes    !== undefined ? engineeringNotes : undefined,
        chiefStewardNotes:   chiefStewardNotes   !== undefined ? chiefStewardNotes : undefined,
        securityNotes:       securityNotes       !== undefined ? securityNotes : undefined,
        specialInstructions: specialInstructions !== undefined ? specialInstructions : undefined,
        roomSetupDetails:    roomSetupDetails    !== undefined ? roomSetupDetails : undefined,
        updatedBy:           req.user?.id || 1,
      },
      create: {
        reservationId,
        operationsNotes:     operationsNotes     || null,
        kitchenNotes:        kitchenNotes        || null,
        housekeepingNotes:   housekeepingNotes   || null,
        frontOfficeNotes:    frontOfficeNotes    || null,
        engineeringNotes:    engineeringNotes    || null,
        chiefStewardNotes:   chiefStewardNotes   || null,
        securityNotes:       securityNotes       || null,
        specialInstructions: specialInstructions || null,
        roomSetupDetails:    roomSetupDetails    || null,
        updatedBy:           req.user?.id || 1,
      },
    });

    res.json(beo);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update BEO' });
  }
});

module.exports = router;
