const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/banquet/function-accounts
router.get('/', async (req, res) => {
  try {
    const accounts = await prisma.functionAccount.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(accounts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch function accounts' });
  }
});

// GET /api/banquet/function-accounts/:id
router.get('/:id', async (req, res) => {
  try {
    const account = await prisma.functionAccount.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!account) return res.status(404).json({ error: 'Function account not found' });
    res.json(account);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch function account' });
  }
});

// POST /api/banquet/function-accounts  [admin]
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, departmentId } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const account = await prisma.functionAccount.create({
      data: {
        name,
        departmentId: departmentId != null ? Number(departmentId) : null,
      },
    });
    res.status(201).json(account);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create function account' });
  }
});

// PUT /api/banquet/function-accounts/:id  [admin]
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, departmentId } = req.body;
    const account = await prisma.functionAccount.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(name != null && { name }),
        ...(departmentId !== undefined && { departmentId: departmentId != null ? Number(departmentId) : null }),
      },
    });
    res.json(account);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Function account not found' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update function account' });
  }
});

// DELETE /api/banquet/function-accounts/:id  [admin]
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.functionAccount.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: 'Function account deleted' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Function account not found' });
    console.error(err);
    res.status(500).json({ error: 'Failed to delete function account' });
  }
});

module.exports = router;
