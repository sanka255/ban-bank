const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const MENU_INCLUDE = {
  items: {
    include: { item: { include: { category: true } } },
  },
  rates: {
    include: { ratePlan: true },
  },
};

// ── GET /api/banquet/menus ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    console.log('GET /api/banquet/menus called with query:', req.query);
    const { isActive } = req.query;
    const where = {};
    if (isActive !== undefined) where.isActive = isActive === 'true';
    console.log('Finding menus with where=', JSON.stringify(where));
    // Avoid complex include to prevent Prisma validation issues; return basic menu list and let clients fetch details separately
    const menus = await prisma.menu.findMany({ where, orderBy: { name: 'asc' } });
    console.log('Found menus count=', Array.isArray(menus) ? menus.length : 0);
    res.json(menus);
  } catch (e) { console.error('Error in GET /api/banquet/menus:', e && e.stack ? e.stack : e); res.status(500).json({ error: 'Failed to fetch menus', detail: e && e.message ? e.message : String(e) }); }
});

// ── GET /api/banquet/menus/:id ────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const menu = await prisma.menu.findUnique({ where: { id: Number(req.params.id) }, include: MENU_INCLUDE });
    if (!menu) return res.status(404).json({ error: 'Menu not found' });
    res.json(menu);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch menu' }); }
});

// ── POST /api/banquet/menus  [admin] ─────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, accountId, isActive } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const menu = await prisma.menu.create({
      data: { name: name.trim(), accountId: accountId || null, isActive: isActive !== false },
    });
    res.status(201).json(menu);
  } catch (e) { console.error(e && e.stack ? e.stack : e); res.status(500).json({ error: 'Failed to create menu', detail: e && e.message ? e.message : String(e) }); }
});

// ── PUT /api/banquet/menus/:id  [admin] ──────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, accountId, isActive } = req.body;
    const menu = await prisma.menu.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(name      != null && { name: name.trim() }),
        ...(accountId !== undefined && { accountId: accountId || null }),
        ...(isActive  !== undefined && { isActive: Boolean(isActive) }),
      },
      include: MENU_INCLUDE,
    });
    res.json(menu);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Menu not found' });
    console.error(e); res.status(500).json({ error: 'Failed to update menu' });
  }
});

// ── DELETE /api/banquet/menus/:id  [admin] ───────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.menu.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: 'Menu deleted' });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Menu not found' });
    console.error(e); res.status(500).json({ error: 'Failed to delete menu' });
  }
});

// ── POST /api/banquet/menus/:menuId/items/:itemId  [admin] ───────────────────
router.post('/:menuId/items/:itemId', requireAdmin, async (req, res) => {
  try {
    const menuId = Number(req.params.menuId);
    const itemId = Number(req.params.itemId);

    const [menu, item] = await Promise.all([
      prisma.menu.findUnique({ where: { id: menuId } }),
      prisma.menuItem.findUnique({ where: { id: itemId } }),
    ]);

    if (!menu || !item) {
      return res.status(404).json({ error: 'Menu or item not found' });
    }

    await prisma.menuToItem.upsert({
      where: { menuId_itemId: { menuId, itemId } },
      update: {},
      create: { menuId, itemId },
    });

    const updatedMenu = await prisma.menu.findUnique({
      where: { id: menuId },
      include: MENU_INCLUDE,
    });

    res.status(201).json(updatedMenu);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to add item to menu' });
  }
});

// ── DELETE /api/banquet/menus/:menuId/items/:itemId  [admin] ─────────────────
router.delete('/:menuId/items/:itemId', requireAdmin, async (req, res) => {
  try {
    const menuId = Number(req.params.menuId);
    const itemId = Number(req.params.itemId);

    const link = await prisma.menuToItem.findUnique({
      where: { menuId_itemId: { menuId, itemId } },
    });

    if (!link) {
      return res.status(404).json({ error: 'Menu item link not found' });
    }

    await prisma.menuToItem.delete({
      where: { menuId_itemId: { menuId, itemId } },
    });

    const updatedMenu = await prisma.menu.findUnique({
      where: { id: menuId },
      include: MENU_INCLUDE,
    });

    res.json({ message: 'Item removed from menu', menu: updatedMenu });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to remove item from menu' });
  }
});

module.exports = router;
