const express = require('express');
const prisma  = require('../prisma');

const router = express.Router({ mergeParams: true });

// ─── GET /api/banquet/date-slots/:id/extra-charges ────────────────────────────
router.get('/', async (req, res) => {
  try {
    const dateSlotId = Number(req.params.id);
    const extras = await prisma.extraCharge.findMany({
      where: { dateSlotId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(extras);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch extra charges' });
  }
});

// ─── POST /api/banquet/date-slots/:id/extra-charges ───────────────────────────
router.post('/', async (req, res) => {
  try {
    const dateSlotId = Number(req.params.id);
    const { category, description, quantity = 1, unitPrice, isComplementary = false, reason } = req.body;

    if (!category || !description || unitPrice == null) {
      return res.status(400).json({ error: 'category, description, and unitPrice are required' });
    }
    if (isComplementary && !reason?.trim()) {
      return res.status(400).json({ error: 'reason is required when isComplementary is true' });
    }

    const slot = await prisma.banquetDateSlot.findUnique({ where: { id: dateSlotId } });
    if (!slot) return res.status(404).json({ error: 'Date slot not found' });

    const qty = Number(quantity);
    const price = Number(unitPrice);
    const charge = isComplementary ? 0 : Number((qty * price).toFixed(2));

    const extra = await prisma.extraCharge.create({
      data: {
        dateSlotId,
        category,
        description: description.trim(),
        quantity: qty,
        unitPrice: price,
        charge,
        isComplementary: Boolean(isComplementary),
        reason: isComplementary ? reason.trim() : null,
      },
    });

    res.status(201).json(extra);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create extra charge' });
  }
});

// ─── PUT /api/banquet/date-slots/:id/extra-charges/:extraId ──────────────────
router.put('/:extraId', async (req, res) => {
  try {
    const dateSlotId = Number(req.params.id);
    const extraId = Number(req.params.extraId);

    // Billed integrity check (C5)
    const billedCount = await prisma.guestBillLine.count({ where: { dateSlotId } });
    if (billedCount > 0) {
      return res.status(409).json({
        error: 'Cannot modify extra charge: a bill has already been generated for this date slot. Void or regenerate the bill first.',
      });
    }

    const existing = await prisma.extraCharge.findUnique({ where: { id: extraId } });
    if (!existing) return res.status(404).json({ error: 'Extra charge not found' });

    const { category, description, quantity, unitPrice, isComplementary, reason } = req.body;
    const qty = quantity != null ? Number(quantity) : Number(existing.quantity);
    const price = unitPrice != null ? Number(unitPrice) : Number(existing.unitPrice);
    const willBeComp = isComplementary !== undefined ? Boolean(isComplementary) : existing.isComplementary;
    const charge = willBeComp ? 0 : Number((qty * price).toFixed(2));

    const updated = await prisma.extraCharge.update({
      where: { id: extraId },
      data: {
        ...(category && { category }),
        ...(description && { description: description.trim() }),
        quantity: qty,
        unitPrice: price,
        charge,
        isComplementary: willBeComp,
        reason: willBeComp ? (reason?.trim() || existing.reason) : null,
      },
    });

    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update extra charge' });
  }
});

// ─── DELETE /api/banquet/date-slots/:id/extra-charges/:extraId ───────────────
router.delete('/:extraId', async (req, res) => {
  try {
    const dateSlotId = Number(req.params.id);
    const extraId = Number(req.params.extraId);

    // Billed integrity check (C5)
    const billedCount = await prisma.guestBillLine.count({ where: { dateSlotId } });
    if (billedCount > 0) {
      return res.status(409).json({
        error: 'Cannot delete extra charge: a bill has already been generated for this date slot. Void or regenerate the bill first.',
      });
    }

    await prisma.extraCharge.delete({ where: { id: extraId } });
    res.json({ message: 'Extra charge removed' });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Extra charge not found' });
    console.error(e);
    res.status(500).json({ error: 'Failed to delete extra charge' });
  }
});

module.exports = router;
