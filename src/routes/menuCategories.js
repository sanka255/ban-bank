const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/banquet/menu-categories ─────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const cats = await prisma.menuCategory.findMany({
      include: { items: { where: { isActive: true }, orderBy: { name: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    res.json(cats);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch categories' }); }
});

// ── GET /api/banquet/menu-categories/:id ─────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const cat = await prisma.menuCategory.findUnique({
      where: { id: Number(req.params.id) },
      include: { items: { orderBy: { name: 'asc' } } },
    });
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    res.json(cat);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch category' }); }
});

// ── POST /api/banquet/menu-categories  [admin] ───────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const cat = await prisma.menuCategory.create({ data: { name: name.trim() } });
    res.status(201).json(cat);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create category' }); }
});

// ── PUT /api/banquet/menu-categories/:id  [admin] ────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    const cat = await prisma.menuCategory.update({
      where: { id: Number(req.params.id) },
      data: { ...(name && { name: name.trim() }) },
    });
    res.json(cat);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Category not found' });
    console.error(e); res.status(500).json({ error: 'Failed to update category' });
  }
});

// ── DELETE /api/banquet/menu-categories/:id  [admin] ─────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.menuCategory.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: 'Category deleted' });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Category not found' });
    console.error(e); res.status(500).json({ error: 'Failed to delete category' });
  }
});

module.exports = router;
