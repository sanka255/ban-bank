const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const ITEM_INCLUDE = {
  category: true,
  menuLinks: { include: { menu: { select: { id: true, name: true } } } },
};

// ── GET /api/banquet/menu-items ───────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { categoryId, isActive } = req.query;
    const where = {};
    if (categoryId) where.categoryId = Number(categoryId);
    if (isActive !== undefined) where.isActive = isActive === 'true';
    const items = await prisma.menuItem.findMany({
      where,
      include: ITEM_INCLUDE,
      orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
    });
    res.json(items);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch items' }); }
});

// ── GET /api/banquet/menu-items/:id ──────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const item = await prisma.menuItem.findUnique({ where: { id: Number(req.params.id) }, include: ITEM_INCLUDE });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch item' }); }
});

// ── POST /api/banquet/menu-items  [admin] ─────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, categoryId, charge, accountNo, isActive } = req.body;
    if (!name?.trim() || !categoryId || charge == null) {
      return res.status(400).json({ error: 'name, categoryId, and charge are required' });
    }
    const item = await prisma.menuItem.create({
      data: {
        name: name.trim(),
        categoryId: Number(categoryId),
        charge: Number(charge),
        accountNo: accountNo || null,
        isActive: isActive !== false,
      },
      include: ITEM_INCLUDE,
    });
    res.status(201).json(item);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create item' }); }
});

// ── PUT /api/banquet/menu-items/:id  [admin] ──────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, categoryId, charge, accountNo, isActive } = req.body;
    const item = await prisma.menuItem.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(name       != null && { name: name.trim() }),
        ...(categoryId != null && { categoryId: Number(categoryId) }),
        ...(charge     != null && { charge: Number(charge) }),
        ...(accountNo  !== undefined && { accountNo: accountNo || null }),
        ...(isActive   !== undefined && { isActive: Boolean(isActive) }),
      },
      include: ITEM_INCLUDE,
    });
    res.json(item);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Item not found' });
    console.error(e); res.status(500).json({ error: 'Failed to update item' });
  }
});

// ── DELETE /api/banquet/menu-items/:id  [admin] ───────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.menuItem.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: 'Item deleted' });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Item not found' });
    console.error(e); res.status(500).json({ error: 'Failed to delete item' });
  }
});

module.exports = router;
