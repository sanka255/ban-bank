const express = require('express');
const prisma  = require('../prisma');

const router = express.Router({ mergeParams: true });

// ─── GET /api/banquet/reservations/:id/discounts ──────────────────────────────
router.get('/', async (req, res) => {
  try {
    const reservationId = Number(req.params.id);
    const discounts = await prisma.reservationDiscount.findMany({
      where: { reservationId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(discounts);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch discounts' });
  }
});

// ─── POST /api/banquet/reservations/:id/discounts ─────────────────────────────
router.post('/', async (req, res) => {
  try {
    const reservationId = Number(req.params.id);
    const { discountType = 'fixed', value, category = 'overall', reason } = req.body;

    if (value == null || !reason?.trim()) {
      return res.status(400).json({ error: 'value and reason are required' });
    }

    const reservation = await prisma.banquetReservation.findUnique({
      where: { id: reservationId },
      include: {
        guestBillLines: true,
      },
    });
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

    let discountAmount = 0;
    const val = Number(value);

    if (discountType === 'percentage') {
      const baseTotal = reservation.guestBillLines.reduce(
        (sum, line) => sum + Number(line.charge || 0),
        0
      );
      discountAmount = Number(((baseTotal * val) / 100).toFixed(2));
    } else {
      discountAmount = Number(val.toFixed(2));
    }

    const discount = await prisma.reservationDiscount.create({
      data: {
        reservationId,
        discountType,
        value: val,
        amount: discountAmount,
        category,
        reason: reason.trim(),
        authorizedBy: req.user?.id || 1,
      },
    });

    res.status(201).json(discount);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create discount' });
  }
});

// ─── DELETE /api/banquet/reservations/:id/discounts/:discountId ───────────────
router.delete('/:discountId', async (req, res) => {
  try {
    const discountId = Number(req.params.discountId);
    await prisma.reservationDiscount.delete({ where: { id: discountId } });
    res.json({ message: 'Discount deleted successfully' });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Discount not found' });
    console.error(e);
    res.status(500).json({ error: 'Failed to delete discount' });
  }
});

module.exports = router;
