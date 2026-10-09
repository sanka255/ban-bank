const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('../middleware/auth');
const { checkPartitionAvailability } = require('../services/availabilityService');
const { cancelReservation } = require('../services/cancellationService');
const { getActivePmsReservation, ensureGuestChargeExists } = require('../services/pmsService');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateReservationCode() {
  const d = new Date();
  const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `BNQ-${dateStr}-${rand}`;
}

/** Looks up the HallRate charge for a partition + pax count. Returns 0 if none found. */
async function lookupCharge(tx, partitionId, numberOfGuests) {
  const rate = await tx.hallRate.findFirst({
    where: {
      partitionId,
      paxRange: {
        minGuests: { lte: Number(numberOfGuests) },
        maxGuests: { gte: Number(numberOfGuests) },
      },
    },
  });
  return rate ? rate.charge : 0;
}

const RESERVATION_INCLUDE = {
  guest: true,
  functionAccount: true,
  dateSlots: {
    include: { partition: { include: { hall: true } } },
    orderBy: { fromDate: 'asc' },
  },
};

function parseDateSlotInput(slot) {
  return {
    partitionId: Number(slot.partitionId),
    fromDate: new Date(`${slot.fromDate}T00:00:00.000Z`),
    toDate:   new Date(`${slot.toDate}T00:00:00.000Z`),
    fromTime: new Date(`1970-01-01T${slot.fromTime}:00.000Z`),
    toTime:   new Date(`1970-01-01T${slot.toTime}:00.000Z`),
  };
}

function parseReservationId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function getTravelAgentWarning(tx, guestId) {
  const guest = await tx.banquetGuest.findUnique({
    where: { id: Number(guestId) },
    include: { travelAgent: true },
  });

  if (!guest?.travelAgentId || !guest.travelAgent) {
    return null;
  }

  const creditLimit = Number(guest.travelAgent.creditLimit || 0);
  if (!Number.isFinite(creditLimit) || creditLimit <= 0) {
    return null;
  }

  const reservations = await tx.banquetReservation.findMany({
    where: { guest: { travelAgentId: guest.travelAgentId } },
    include: { guestBillLines: true, deposits: true },
  });

  const totalBill = reservations.reduce((sum, reservation) => {
    const lineTotal = reservation.guestBillLines.reduce((lineSum, line) => lineSum + Number(line.chargeWithTax || 0), 0);
    const depositTotal = reservation.deposits.filter((deposit) => deposit.settled).reduce((depositSum, deposit) => depositSum + Number(deposit.amount || 0), 0);
    return sum + (lineTotal - depositTotal);
  }, 0);

  const outstanding = Number(totalBill.toFixed(2));
  if (outstanding <= creditLimit) {
    return null;
  }

  return {
    travelAgentId: guest.travelAgentId,
    company: guest.travelAgent.company,
    creditLimit,
    outstanding,
    overBy: Number((outstanding - creditLimit).toFixed(2)),
    message: `Travel agent ${guest.travelAgent.company} is above its credit limit by ${Number((outstanding - creditLimit).toFixed(2))}.`,
  };
}

// ─── POST /api/banquet/reservations ──────────────────────────────────────────

router.post('/', async (req, res) => {
  const {
    guestId,
    guest: guestData,
    functionAccountId,
    numberOfGuests,
    discussedBy,
    broughtBy,
    isComplementary = false,
    complementaryReason,
    dateSlots: slotRequests,
  } = req.body;

  // ── Validate ─────────────────────────────────────────────────────────────
  if (!numberOfGuests) return res.status(400).json({ error: 'numberOfGuests is required' });
  if (!guestId && !guestData) return res.status(400).json({ error: 'Either guestId or guest data is required' });
  if (isComplementary && !complementaryReason?.trim()) {
    return res.status(400).json({ error: 'complementaryReason is required when isComplementary is true' });
  }
  if (!slotRequests?.length) return res.status(400).json({ error: 'At least one date slot is required' });

  // ── Availability check BEFORE transaction (prevent partial creation) ──────
  const conflictResults = [];
  for (const slot of slotRequests) {
    const avail = await checkPartitionAvailability({
      partitionId: Number(slot.partitionId),
      fromDate: slot.fromDate,
      toDate:   slot.toDate,
      fromTime: slot.fromTime,
      toTime:   slot.toTime,
    });
    if (!avail.available) conflictResults.push({ requestedSlot: slot, conflicts: avail.conflicts });
  }

  if (conflictResults.length > 0) {
    return res.status(409).json({
      error: 'One or more date slots conflict with existing bookings — reservation not created',
      conflictingSlots: conflictResults,
    });
  }

  // ── Transaction: guest → reservation → all slots atomically ──────────────
  try {
    const reservationCode = generateReservationCode();

    const result = await prisma.$transaction(async (tx) => {
      // Create or resolve guest
      let resolvedGuestId = guestId ? Number(guestId) : null;
      if (!resolvedGuestId && guestData) {
        const guest = await tx.banquetGuest.create({ data: guestData });
        resolvedGuestId = guest.id;
      }

      // Create reservation
      const reservation = await tx.banquetReservation.create({
        data: {
          reservationCode,
          guestId: resolvedGuestId,
          functionAccountId: functionAccountId ? Number(functionAccountId) : null,
          numberOfGuests: Number(numberOfGuests),
          discussedBy: discussedBy || null,
          broughtBy: broughtBy || null,
          isComplementary: Boolean(isComplementary),
          complementaryReason: isComplementary ? complementaryReason.trim() : null,
          createdBy: req.user.id,
          status: 'tentative',
        },
      });

      const travelAgentWarning = await getTravelAgentWarning(tx, resolvedGuestId);

      // Create all date slots
      const createdSlots = [];
      for (const slotReq of slotRequests) {
        const charge = slotReq.charge != null
          ? Number(slotReq.charge)
          : await lookupCharge(tx, Number(slotReq.partitionId), numberOfGuests);

        const slot = await tx.banquetDateSlot.create({
          data: {
            reservationId: reservation.id,
            ...parseDateSlotInput(slotReq),
            charge,
            status: 'active',
          },
        });
        createdSlots.push(slot);
      }

      return { ...reservation, dateSlots: createdSlots, travelAgentWarning };
    });

    res.status(201).json(result);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Reservation code collision — please retry' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to create reservation' });
  }
});

// ─── GET /api/banquet/reservations ────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { status, fromDate, toDate, guestId, search, page = 1, limit = 20 } = req.query;

    const where = {};
    if (status) where.status = status;
    if (guestId) where.guestId = Number(guestId);
    if (search) {
      where.OR = [
        { reservationCode:   { contains: search } },
        { guest: { firstName: { contains: search } } },
        { guest: { lastName:  { contains: search } } },
      ];
    }
    if (fromDate || toDate) {
      where.dateSlots = {
        some: {
          status: { not: 'cancelled' },
          ...(fromDate ? { fromDate: { gte: new Date(`${fromDate}T00:00:00.000Z`) } } : {}),
          ...(toDate   ? { toDate:   { lte: new Date(`${toDate}T00:00:00.000Z`)   } } : {}),
        },
      };
    }

    const [reservations, total] = await prisma.$transaction([
      prisma.banquetReservation.findMany({
        where,
        include: {
          guest: { select: { id: true, firstName: true, lastName: true, phone: true } },
          functionAccount: { select: { id: true, name: true } },
          dateSlots: { where: { status: { not: 'cancelled' } }, orderBy: { fromDate: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.banquetReservation.count({ where }),
    ]);

    res.json({ reservations, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch reservations' });
  }
});

// ─── GET /api/banquet/reservations/:id ───────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const reservationId = parseReservationId(req.params.id);
    if (reservationId === null) {
      return res.status(400).json({ error: 'A valid reservation ID is required.' });
    }

    const reservation = await prisma.banquetReservation.findUnique({
      where: { id: reservationId },
      include: RESERVATION_INCLUDE,
    });
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    res.json(reservation);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch reservation' });
  }
});

// ─── PUT /api/banquet/reservations/:id ───────────────────────────────────────

router.put('/:id', async (req, res) => {
  try {
    const {
      functionAccountId,
      numberOfGuests,
      discussedBy,
      broughtBy,
      status,
      isComplementary,
      complementaryReason,
    } = req.body;

    // Validate complementary change
    const existing = await prisma.banquetReservation.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Reservation not found' });

    const willBeComplementary = isComplementary != null ? Boolean(isComplementary) : existing.isComplementary;
    if (willBeComplementary && !(complementaryReason ?? existing.complementaryReason)?.trim()) {
      return res.status(400).json({ error: 'complementaryReason is required when isComplementary is true' });
    }

    const reservation = await prisma.banquetReservation.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(functionAccountId !== undefined && { functionAccountId: functionAccountId ? Number(functionAccountId) : null }),
        ...(numberOfGuests != null && { numberOfGuests: Number(numberOfGuests) }),
        ...(discussedBy    !== undefined && { discussedBy: discussedBy || null }),
        ...(broughtBy      !== undefined && { broughtBy: broughtBy || null }),
        ...(status         != null && { status }),
        ...(isComplementary !== undefined && { isComplementary: Boolean(isComplementary) }),
        ...(complementaryReason !== undefined && { complementaryReason: complementaryReason || null }),
      },
      include: RESERVATION_INCLUDE,
    });

    const travelAgentWarning = await getTravelAgentWarning(prisma, reservation.guestId);
    res.json({ ...reservation, travelAgentWarning });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Reservation not found' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update reservation' });
  }
});

// ─── POST /api/banquet/reservations/:id/date-slots ───────────────────────────

router.post('/:id/date-slots', async (req, res) => {
  try {
    const reservationId = parseReservationId(req.params.id);
    if (reservationId === null) {
      return res.status(400).json({ error: 'A valid reservation ID is required.' });
    }

    const reservation = await prisma.banquetReservation.findUnique({
      where: { id: reservationId },
      select: { id: true, numberOfGuests: true, status: true },
    });
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    if (reservation.status === 'cancelled') {
      return res.status(409).json({ error: 'Cannot add a slot to a cancelled reservation' });
    }

    const { partitionId, fromDate, toDate, fromTime, toTime, charge } = req.body;
    if (!partitionId || !fromDate || !toDate || !fromTime || !toTime) {
      return res.status(400).json({ error: 'partitionId, fromDate, toDate, fromTime, toTime are required' });
    }

    // Availability check
    const avail = await checkPartitionAvailability({ partitionId: Number(partitionId), fromDate, toDate, fromTime, toTime });
    if (!avail.available) {
      return res.status(409).json({ error: 'Slot conflicts with existing booking', conflicts: avail.conflicts });
    }

    const resolvedCharge = charge != null
      ? Number(charge)
      : await lookupCharge(prisma, Number(partitionId), reservation.numberOfGuests);

    const slot = await prisma.banquetDateSlot.create({
      data: {
        reservationId,
        ...parseDateSlotInput({ partitionId, fromDate, toDate, fromTime, toTime }),
        charge: resolvedCharge,
        status: 'active',
      },
      include: { partition: { include: { hall: true } } },
    });
    res.status(201).json(slot);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add date slot' });
  }
});

// ─── POST /api/banquet/reservations/:id/cancel ───────────────────────────────

router.post('/:id/cancel', async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await cancelReservation(Number(req.params.id), req.user.id, reason);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to cancel reservation' });
  }
});

router.get('/:id/folio', async (req, res) => {
  try {
    const reservationId = parseReservationId(req.params.id);
    if (reservationId === null) {
      return res.status(400).json({ error: 'A valid reservation ID is required.' });
    }

    const reservation = await prisma.banquetReservation.findUnique({
      where: { id: reservationId },
      include: {
        guest: true,
        dateSlots: {
          include: { partition: { include: { hall: true } } },
          orderBy: { fromDate: 'asc' },
        },
        guestBillLines: { orderBy: { createdAt: 'asc' } },
        deposits: { orderBy: { insertDate: 'desc' } },
      },
    });

    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

    const baseCharges = reservation.guestBillLines.reduce((sum, line) => sum + Number(line.charge || 0), 0);
    const taxAmount = reservation.guestBillLines.reduce((sum, line) => sum + Number(line.taxAmount || 0), 0);
    const totalWithTax = reservation.guestBillLines.reduce((sum, line) => sum + Number(line.chargeWithTax || 0), 0);
    const depositsTotal = reservation.deposits.reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
    const settledDeposits = reservation.deposits.filter((deposit) => deposit.settled).reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);

    res.json({
      reservation,
      billLines: reservation.guestBillLines,
      deposits: reservation.deposits,
      totals: {
        baseCharges: Number(baseCharges.toFixed(2)),
        taxAmount: Number(taxAmount.toFixed(2)),
        totalWithTax: Number(totalWithTax.toFixed(2)),
        depositsTotal: Number(depositsTotal.toFixed(2)),
        settledDeposits: Number(settledDeposits.toFixed(2)),
        outstandingBalance: Number((totalWithTax - settledDeposits).toFixed(2)),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch folio' });
  }
});

router.post('/:id/post-to-room', async (req, res) => {
  try {
    const reservationId = parseReservationId(req.params.id);
    if (reservationId === null) {
      return res.status(400).json({ error: 'A valid reservation ID is required.' });
    }

    const { pmsReservationId } = req.body || {};

    if (!pmsReservationId) {
      return res.status(400).json({ error: 'pmsReservationId is required' });
    }

    const banquetReservation = await prisma.banquetReservation.findUnique({
      where: { id: reservationId },
      include: {
        guestBillLines: {
          where: { fromPms: false },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!banquetReservation) return res.status(404).json({ error: 'Reservation not found' });

    const pmsReservation = await getActivePmsReservation(pmsReservationId);
    if (!pmsReservation) return res.status(404).json({ error: 'No active PMS reservation found for the provided pmsReservationId' });

    const postedLines = [];
    for (const billLine of banquetReservation.guestBillLines) {
      const posted = await ensureGuestChargeExists({
        pmsReservationId: pmsReservation.id,
        billLine,
        userId: req.user.id,
      });

      if (posted.created || posted.id) {
        await prisma.guestBillLine.update({
          where: { id: billLine.id },
          data: { fromPms: true },
        });
        postedLines.push({ billLineId: billLine.id, guestChargeId: posted.id, created: posted.created });
      }
    }

    res.json({
      reservationId,
      pmsReservationId: pmsReservation.id,
      postedCount: postedLines.length,
      postedLines,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to post charges to room folio' });
  }
});

module.exports = router;
