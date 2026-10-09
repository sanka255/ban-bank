const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/banquet/pax-ranges
router.get('/', async (req, res) => {
  try {
    const ranges = await prisma.paxRange.findMany({
      orderBy: { minGuests: 'asc' },
    });
    res.json(ranges);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pax ranges' });
  }
});

// GET /api/banquet/pax-ranges/:id
router.get('/:id', async (req, res) => {
  try {
    const range = await prisma.paxRange.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!range) return res.status(404).json({ error: 'Pax range not found' });
    res.json(range);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pax range' });
  }
});

// POST /api/banquet/pax-ranges  [admin]
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { minGuests, maxGuests } = req.body;
    if (minGuests == null || maxGuests == null) {
      return res.status(400).json({ error: 'minGuests and maxGuests are required' });
    }
    if (Number(minGuests) > Number(maxGuests)) {
      return res.status(400).json({ error: 'minGuests must be <= maxGuests' });
    }

    const range = await prisma.paxRange.create({
      data: { minGuests: Number(minGuests), maxGuests: Number(maxGuests) },
    });
    res.status(201).json(range);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create pax range' });
  }
});

// PUT /api/banquet/pax-ranges/:id  [admin]
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { minGuests, maxGuests } = req.body;
    const range = await prisma.paxRange.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(minGuests != null && { minGuests: Number(minGuests) }),
        ...(maxGuests != null && { maxGuests: Number(maxGuests) }),
      },
    });
    res.json(range);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Pax range not found' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update pax range' });
  }
});

// DELETE /api/banquet/pax-ranges/:id  [admin]
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.paxRange.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: 'Pax range deleted' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Pax range not found' });
    console.error(err);
    res.status(500).json({ error: 'Failed to delete pax range' });
  }
});

module.exports = router;
