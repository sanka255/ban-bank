const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ─── Halls ──────────────────────────────────────────────────────────────────

// GET /api/banquet/halls
router.get('/', async (req, res) => {
  try {
    const halls = await prisma.banquetHall.findMany({
      include: { partitions: true },
      orderBy: { id: 'asc' },
    });
    res.json(halls);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch halls' });
  }
});

// GET /api/banquet/halls/:id
router.get('/:id', async (req, res) => {
  try {
    const hall = await prisma.banquetHall.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        partitions: {
          include: { rates: { include: { paxRange: true } } },
        },
      },
    });
    if (!hall) return res.status(404).json({ error: 'Hall not found' });
    res.json(hall);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch hall' });
  }
});

// POST /api/banquet/halls  [admin]
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, maxGuests, isPartitioned } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const hall = await prisma.banquetHall.create({
      data: {
        name,
        maxGuests: maxGuests != null ? Number(maxGuests) : null,
        isPartitioned: Boolean(isPartitioned),
      },
    });
    res.status(201).json(hall);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create hall' });
  }
});

// PUT /api/banquet/halls/:id  [admin]
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, maxGuests, isPartitioned } = req.body;
    const hall = await prisma.banquetHall.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(name != null && { name }),
        ...(maxGuests !== undefined && { maxGuests: maxGuests != null ? Number(maxGuests) : null }),
        ...(isPartitioned !== undefined && { isPartitioned: Boolean(isPartitioned) }),
      },
    });
    res.json(hall);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Hall not found' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update hall' });
  }
});

// DELETE /api/banquet/halls/:id  [admin]
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.banquetHall.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: 'Hall deleted' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Hall not found' });
    console.error(err);
    res.status(500).json({ error: 'Failed to delete hall' });
  }
});

// ─── Partitions (nested under a hall) ───────────────────────────────────────

// GET /api/banquet/halls/:hallId/partitions
router.get('/:hallId/partitions', async (req, res) => {
  try {
    const partitions = await prisma.hallPartition.findMany({
      where: { hallId: Number(req.params.hallId) },
      include: { rates: { include: { paxRange: true } } },
      orderBy: { id: 'asc' },
    });
    res.json(partitions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch partitions' });
  }
});

// GET /api/banquet/halls/:hallId/partitions/:id
router.get('/:hallId/partitions/:id', async (req, res) => {
  try {
    const partition = await prisma.hallPartition.findFirst({
      where: { id: Number(req.params.id), hallId: Number(req.params.hallId) },
      include: { rates: { include: { paxRange: true } } },
    });
    if (!partition) return res.status(404).json({ error: 'Partition not found' });
    res.json(partition);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch partition' });
  }
});

// POST /api/banquet/halls/:hallId/partitions  [admin]
router.post('/:hallId/partitions', requireAdmin, async (req, res) => {
  try {
    const { name, status, accountNo } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const partition = await prisma.hallPartition.create({
      data: {
        hallId: Number(req.params.hallId),
        name,
        status: status || 'active',
        accountNo: accountNo || null,
      },
    });
    res.status(201).json(partition);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create partition' });
  }
});

// PUT /api/banquet/halls/:hallId/partitions/:id  [admin]
router.put('/:hallId/partitions/:id', requireAdmin, async (req, res) => {
  try {
    const { name, status, accountNo } = req.body;
    const partition = await prisma.hallPartition.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(name != null && { name }),
        ...(status != null && { status }),
        ...(accountNo !== undefined && { accountNo: accountNo || null }),
      },
    });
    res.json(partition);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Partition not found' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update partition' });
  }
});

// DELETE /api/banquet/halls/:hallId/partitions/:id  [admin]
router.delete('/:hallId/partitions/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.hallPartition.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: 'Partition deleted' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Partition not found' });
    console.error(err);
    res.status(500).json({ error: 'Failed to delete partition' });
  }
});

module.exports = router;
