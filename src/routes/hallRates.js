const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/banquet/hall-rates  (optionally filter by ?partitionId=)
router.get('/', async (req, res) => {
  try {
    const where = req.query.partitionId
      ? { partitionId: Number(req.query.partitionId) }
      : {};

    const rates = await prisma.hallRate.findMany({
      where,
      include: {
        paxRange: true,
        partition: { select: { id: true, name: true } },
      },
      orderBy: [{ partitionId: 'asc' }, { paxRangeId: 'asc' }],
    });
    res.json(rates);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch hall rates' });
  }
});

// GET /api/banquet/hall-rates/:id
router.get('/:id', async (req, res) => {
  try {
    const rate = await prisma.hallRate.findUnique({
      where: { id: Number(req.params.id) },
      include: { paxRange: true, partition: true },
    });
    if (!rate) return res.status(404).json({ error: 'Rate not found' });
    res.json(rate);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch rate' });
  }
});

// POST /api/banquet/hall-rates  [admin]
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { partitionId, paxRangeId, charge } = req.body;
    if (!partitionId || !paxRangeId || charge == null) {
      return res.status(400).json({ error: 'partitionId, paxRangeId, and charge are required' });
    }

    const rate = await prisma.hallRate.create({
      data: {
        partitionId: Number(partitionId),
        paxRangeId: Number(paxRangeId),
        charge: Number(charge),
      },
      include: { paxRange: true },
    });
    res.status(201).json(rate);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create rate' });
  }
});

// PUT /api/banquet/hall-rates/:id  [admin]
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { partitionId, paxRangeId, charge } = req.body;
    const rate = await prisma.hallRate.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(partitionId != null && { partitionId: Number(partitionId) }),
        ...(paxRangeId  != null && { paxRangeId:  Number(paxRangeId)  }),
        ...(charge      != null && { charge:       Number(charge)      }),
      },
      include: { paxRange: true },
    });
    res.json(rate);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Rate not found' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update rate' });
  }
});

// DELETE /api/banquet/hall-rates/:id  [admin]
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.hallRate.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: 'Rate deleted' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Rate not found' });
    console.error(err);
    res.status(500).json({ error: 'Failed to delete rate' });
  }
});

module.exports = router;
