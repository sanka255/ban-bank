const express = require('express');
const prisma  = require('../prisma');
const { calculateTax }      = require('../services/taxService');
const { postBillLinesToRoom, verifyPmsReservation } = require('../services/pmsPostingService');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function billNo(dateSlotId) {
  return `BNQ-${dateSlotId}-${Date.now().toString(36).toUpperCase()}`;
}

// ─── POST /api/banquet/date-slots/:id/generate-bill ──────────────────────────
//
// Creates GuestBillLine rows for all charges on the date slot.
// Guard: if lines already exist for this slot, reject with 409 — use
// /regenerate-bill endpoint to supersede (test 4 is verified here).

router.post('/:id/generate-bill', async (req, res) => {
  const dateSlotId = Number(req.params.id);

  try {
    const slot = await prisma.banquetDateSlot.findUnique({
      where: { id: dateSlotId },
      include: {
        reservation: true,
        requestedItems:     { include: { item: true } },
        requestedMenuItems: { include: { menu: true } },
        guestBillLines: { select: { id: true } },
      },
    });
    if (!slot) return res.status(404).json({ error: 'Date slot not found' });

    // Guard: already billed — do not double-create
    if (slot.guestBillLines.length > 0) {
      return res.status(409).json({
        error: 'Bill already generated for this date slot. Use POST /regenerate-bill to supersede.',
        existingLineCount: slot.guestBillLines.length,
      });
    }

    const isCompReservation = slot.reservation.isComplementary;
    const eventDate = slot.fromDate;
    const no = billNo(dateSlotId);

    // Build charge entries: [{ description, lineType, baseCharge, isComp }]
    const entries = [];

    // 1. Hall charge
    entries.push({
      lineType:    'hall_charge',
      description: `Hall charge — ${slot.partition?.name ?? `Slot ${dateSlotId}`}`,
      baseCharge:  Number(slot.charge),
      isComp:      isCompReservation,
    });

    // 2. A-la-carte items
    for (const ri of slot.requestedItems) {
      entries.push({
        lineType:    'item',
        description: `${ri.item.name} × ${Number(ri.quantity)}`,
        baseCharge:  Number(ri.charge),
        isComp:      isCompReservation || ri.isComplementary,
      });
    }

    // 3. Menu selections
    for (const rm of slot.requestedMenuItems) {
      entries.push({
        lineType:    'menu',
        description: `${rm.menu.name} × ${rm.guestCount} covers`,
        baseCharge:  Number(rm.charge),
        isComp:      isCompReservation || rm.isComplementary,
      });
    }

    // Compute tax and create bill lines in a single transaction
    const createdLines = await prisma.$transaction(async (tx) => {
      const lines = [];
      for (const entry of entries) {
        let charge, taxAmount, chargeWithTax;
        if (entry.isComp) {
          // Complementary: zero billing, line still created for audit
          charge = 0; taxAmount = 0; chargeWithTax = 0;
        } else {
          const tax = await calculateTax(entry.baseCharge, eventDate);
          charge       = entry.baseCharge;
          taxAmount    = tax.taxAmount;
          chargeWithTax = tax.chargeWithTax;
        }

        const line = await tx.guestBillLine.create({
          data: {
            reservationId: slot.reservationId,
            dateSlotId,
            billNo: no,
            lineType: entry.lineType,
            description: entry.description,
            charge,
            taxAmount,
            chargeWithTax,
            fromPms: false,
            insertDate: new Date(eventDate.toISOString().slice(0, 10) + 'T00:00:00.000Z'),
            userId: req.user.id,
          },
        });
        lines.push(line);
      }
      return lines;
    });

    res.status(201).json({
      billNo: no,
      lines: createdLines,
      summary: {
        totalBaseCharge: createdLines.reduce((s, l) => s + Number(l.charge), 0),
        totalTax:        createdLines.reduce((s, l) => s + Number(l.taxAmount), 0),
        totalWithTax:    createdLines.reduce((s, l) => s + Number(l.chargeWithTax), 0),
        lineCount:       createdLines.length,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to generate bill' });
  }
});

// ─── POST /api/banquet/date-slots/:id/regenerate-bill ────────────────────────
//
// Supersedes existing bill lines: voids previous unposted lines, creates fresh ones.
// Refuses to regenerate if any lines are already posted to PMS (fromPms=true).

router.post('/:id/regenerate-bill', async (req, res) => {
  const dateSlotId = Number(req.params.id);
  try {
    const slot = await prisma.banquetDateSlot.findUnique({
      where: { id: dateSlotId },
      include: {
        reservation: true,
        requestedItems:     { include: { item: true } },
        requestedMenuItems: { include: { menu: true } },
        guestBillLines: true,
      },
    });
    if (!slot) return res.status(404).json({ error: 'Date slot not found' });

    const postedLines = slot.guestBillLines.filter(l => l.fromPms);
    if (postedLines.length > 0) {
      return res.status(409).json({
        error: 'Cannot regenerate — some lines are already posted to PMS. Void them in Synora PMS first.',
        postedCount: postedLines.length,
      });
    }

    // Delete old unposted lines then re-run generation via the same logic
    await prisma.guestBillLine.deleteMany({ where: { dateSlotId, fromPms: false } });

    // Delegate back to generate-bill logic by mutating the slot mock
    // (just redirect to the same handler — simplest: inline a re-call)
    const isCompReservation = slot.reservation.isComplementary;
    const eventDate = slot.fromDate;
    const no = billNo(dateSlotId);

    const entries = [
      { lineType: 'hall_charge', description: `Hall charge (re-generated)`, baseCharge: Number(slot.charge), isComp: isCompReservation },
      ...slot.requestedItems.map(ri => ({ lineType: 'item', description: `${ri.item.name} × ${Number(ri.quantity)}`, baseCharge: Number(ri.charge), isComp: isCompReservation || ri.isComplementary })),
      ...slot.requestedMenuItems.map(rm => ({ lineType: 'menu', description: `${rm.menu.name} × ${rm.guestCount} covers`, baseCharge: Number(rm.charge), isComp: isCompReservation || rm.isComplementary })),
    ];

    const createdLines = await prisma.$transaction(async (tx) => {
      const lines = [];
      for (const entry of entries) {
        let charge = 0, taxAmount = 0, chargeWithTax = 0;
        if (!entry.isComp) {
          const tax = await calculateTax(entry.baseCharge, eventDate);
          charge = entry.baseCharge; taxAmount = tax.taxAmount; chargeWithTax = tax.chargeWithTax;
        }
        lines.push(await tx.guestBillLine.create({
          data: { reservationId: slot.reservationId, dateSlotId, billNo: no, lineType: entry.lineType, description: entry.description, charge, taxAmount, chargeWithTax, fromPms: false, insertDate: new Date(eventDate.toISOString().slice(0, 10) + 'T00:00:00.000Z'), userId: req.user.id },
        }));
      }
      return lines;
    });

    res.status(201).json({
      billNo: no,
      lines: createdLines,
      regenerated: true,
      summary: {
        totalBaseCharge: createdLines.reduce((s, l) => s + Number(l.charge), 0),
        totalTax:        createdLines.reduce((s, l) => s + Number(l.taxAmount), 0),
        totalWithTax:    createdLines.reduce((s, l) => s + Number(l.chargeWithTax), 0),
        lineCount:       createdLines.length,
      },
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to regenerate bill' }); }
});

// ─── GET /api/banquet/reservations/:id/folio ────────────────────────────────

router.get('/reservations/:id/folio', async (req, res) => {
  try {
    const reservationId = Number(req.params.id);
    const reservation = await prisma.banquetReservation.findUnique({
      where: { id: reservationId },
      include: {
        guest: true,
        functionAccount: true,
        dateSlots: {
          include: {
            guestBillLines: { orderBy: { createdAt: 'asc' } },
            partition: { include: { hall: true } },
          },
          orderBy: { fromDate: 'asc' },
        },
        deposits: { orderBy: { insertDate: 'desc' } },
      },
    });
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

    // Flatten all lines across all date slots
    const allLines = reservation.dateSlots.flatMap(ds => ds.guestBillLines);
    const totalBase    = allLines.reduce((s, l) => s + Number(l.charge), 0);
    const totalTax     = allLines.reduce((s, l) => s + Number(l.taxAmount), 0);
    const totalWithTax = allLines.reduce((s, l) => s + Number(l.chargeWithTax), 0);

    const totalDeposits = reservation.deposits.reduce((s, d) => s + Number(d.amount), 0);
    const settledDeposits = reservation.deposits.filter(d => d.settled).reduce((s, d) => s + Number(d.amount), 0);
    const outstanding = Number((totalWithTax - settledDeposits).toFixed(2));

    res.json({
      reservation: {
        id: reservation.id,
        reservationCode: reservation.reservationCode,
        guest: reservation.guest,
        functionAccount: reservation.functionAccount,
        numberOfGuests: reservation.numberOfGuests,
        status: reservation.status,
        isComplementary: reservation.isComplementary,
      },
      dateSlots: reservation.dateSlots.map(ds => ({
        id: ds.id,
        fromDate: ds.fromDate.toISOString().slice(0, 10),
        toDate:   ds.toDate.toISOString().slice(0, 10),
        fromTime: ds.fromTime.toISOString().slice(11, 16),
        toTime:   ds.toTime.toISOString().slice(11, 16),
        hall: ds.partition?.hall?.name,
        partition: ds.partition?.name,
        status: ds.status,
        billLines: ds.guestBillLines,
      })),
      summary: {
        totalBaseCharge: Number(totalBase.toFixed(2)),
        totalTax:        Number(totalTax.toFixed(2)),
        totalWithTax:    Number(totalWithTax.toFixed(2)),
        totalDeposits:   Number(totalDeposits.toFixed(2)),
        settledDeposits: Number(settledDeposits.toFixed(2)),
        outstandingBalance: outstanding,
      },
      deposits: reservation.deposits,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch folio' }); }
});

// ─── POST /api/banquet/reservations/:id/post-to-room ─────────────────────────

router.post('/reservations/:id/post-to-room', async (req, res) => {
  try {
    const { pmsReservationId } = req.body;
    if (!pmsReservationId) return res.status(400).json({ error: 'pmsReservationId is required' });

    const result = await postBillLinesToRoom(Number(req.params.id), Number(pmsReservationId), req.user.id);
    res.json(result);
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error(e); res.status(500).json({ error: 'Failed to post to room' });
  }
});

// ─── GET /api/banquet/deposits ────────────────────────────────────────────────

router.get('/deposits', async (req, res) => {
  try {
    const { reservationId } = req.query;
    const deposits = await prisma.hallDeposit.findMany({
      where: reservationId ? { reservationId: Number(reservationId) } : undefined,
      include: { reservation: { select: { reservationCode: true } } },
      orderBy: { insertDate: 'desc' },
    });
    res.json(deposits);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch deposits' }); }
});

// ─── POST /api/banquet/deposits ───────────────────────────────────────────────

router.post('/deposits', async (req, res) => {
  try {
    const { reservationId, amount, paymentMethod, currencyId, receiptNo, remark } = req.body;
    if (!reservationId || !amount || !paymentMethod) {
      return res.status(400).json({ error: 'reservationId, amount, and paymentMethod are required' });
    }

    const currencySnapshot = currencyId != null && Number(currencyId) !== 0
      ? await snapshotCurrencyAmount(amount, Number(currencyId), new Date())
      : { currencyId: null, baseCurrencyAmount: Number(amount), exchangeRateUsed: 1 };

    const deposit = await prisma.hallDeposit.create({
      data: {
        reservationId: Number(reservationId),
        amount:  Number(amount),
        paymentMethod,
        currencyId: currencySnapshot.currencyId,
        baseCurrencyAmount: currencySnapshot.baseCurrencyAmount,
        exchangeRateUsed: currencySnapshot.exchangeRateUsed,
        receiptNo: receiptNo || null,
        remark:    remark    || null,
        settled:   false,
      },
      include: { reservation: { select: { reservationCode: true } } },
    });
    res.status(201).json(deposit);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create deposit' }); }
});

// ─── PUT /api/banquet/deposits/:id/settle ─────────────────────────────────────

router.put('/deposits/:id/settle', async (req, res) => {
  try {
    const deposit = await prisma.hallDeposit.update({
      where:  { id: Number(req.params.id) },
      data:   { settled: true },
      include: { reservation: { select: { reservationCode: true } } },
    });
    res.json(deposit);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Deposit not found' });
    console.error(e); res.status(500).json({ error: 'Failed to settle deposit' });
  }
});

module.exports = router;
