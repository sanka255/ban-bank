const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/banquet/cancellation-tiers
router.get('/', async (req, res) => {
  try {
    const tiers = await prisma.hallCancellationTier.findMany({ orderBy: { daysMin: 'asc' } });
    res.json(tiers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch cancellation tiers' });
  }
});

// GET /api/banquet/cancellation-tiers/:id
router.get('/:id', async (req, res) => {
  try {
    const tier = await prisma.hallCancellationTier.findUnique({ where: { id: Number(req.params.id) } });
    if (!tier) return res.status(404).json({ error: 'Tier not found' });
    res.json(tier);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch tier' });
  }
});

// POST /api/banquet/cancellation-tiers  [admin]
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { daysMin, daysMax, refundPct } = req.body;
    if (daysMin == null || daysMax == null || refundPct == null) {
      return res.status(400).json({ error: 'daysMin, daysMax, and refundPct are required' });
    }
    if (Number(daysMin) > Number(daysMax)) {
      return res.status(400).json({ error: 'daysMin must be <= daysMax' });
    }
    if (Number(refundPct) < 0 || Number(refundPct) > 100) {
      return res.status(400).json({ error: 'refundPct must be between 0 and 100' });
    }

    const tier = await prisma.hallCancellationTier.create({
      data: { daysMin: Number(daysMin), daysMax: Number(daysMax), refundPct: Number(refundPct) },
    });
    res.status(201).json(tier);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create tier' });
  }
});

// PUT /api/banquet/cancellation-tiers/:id  [admin]
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { daysMin, daysMax, refundPct } = req.body;
    const tier = await prisma.hallCancellationTier.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(daysMin   != null && { daysMin:   Number(daysMin)   }),
        ...(daysMax   != null && { daysMax:   Number(daysMax)   }),
        ...(refundPct != null && { refundPct: Number(refundPct) }),
      },
    });
    res.json(tier);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Tier not found' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update tier' });
  }
});

// DELETE /api/banquet/cancellation-tiers/:id  [admin]
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.hallCancellationTier.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: 'Tier deleted' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Tier not found' });
    console.error(err);
    res.status(500).json({ error: 'Failed to delete tier' });
  }
});

module.exports = router;
