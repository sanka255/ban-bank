const express = require('express');
const prisma  = require('../prisma');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ─── GET /api/banquet/packages ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const packages = await prisma.eventPackage.findMany({
      where: { isActive: true },
      include: {
        items: {
          include: {
            item: { select: { id: true, name: true, charge: true } },
            menu: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    res.json(packages);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch packages' });
  }
});

// ─── GET /api/banquet/packages/:id ────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pkg = await prisma.eventPackage.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        items: {
          include: {
            item: true,
            menu: true,
          },
        },
      },
    });
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    res.json(pkg);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch package' });
  }
});

// ─── POST /api/banquet/packages [admin] ────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, description, price, isPerHead = true, items = [] } = req.body;
    if (!name?.trim() || price == null) {
      return res.status(400).json({ error: 'name and price are required' });
    }

    const pkg = await prisma.eventPackage.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        price: Number(price),
        isPerHead: Boolean(isPerHead),
        isActive: true,
        items: {
          create: items.map(it => ({
            itemId: it.itemId ? Number(it.itemId) : null,
            menuId: it.menuId ? Number(it.menuId) : null,
            customName: it.customName || null,
            quantity: Number(it.quantity || 1),
          })),
        },
      },
      include: { items: { include: { item: true, menu: true } } },
    });

    res.status(201).json(pkg);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create package' });
  }
});

// ─── PUT /api/banquet/packages/:id [admin] ─────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, description, price, isPerHead, isActive } = req.body;
    const pkg = await prisma.eventPackage.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(name && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(price != null && { price: Number(price) }),
        ...(isPerHead !== undefined && { isPerHead: Boolean(isPerHead) }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
      include: { items: { include: { item: true, menu: true } } },
    });
    res.json(pkg);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Package not found' });
    console.error(e);
    res.status(500).json({ error: 'Failed to update package' });
  }
});

// ─── POST /api/banquet/packages/:id/items [admin] ─────────────────────────────
router.post('/:id/items', requireAdmin, async (req, res) => {
  try {
    const packageId = Number(req.params.id);
    const { itemId, menuId, customName, quantity = 1 } = req.body;

    const packageItem = await prisma.packageItem.create({
      data: {
        packageId,
        itemId: itemId ? Number(itemId) : null,
        menuId: menuId ? Number(menuId) : null,
        customName: customName || null,
        quantity: Number(quantity),
      },
      include: { item: true, menu: true },
    });

    res.status(201).json(packageItem);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to add item to package' });
  }
});

// ─── DELETE /api/banquet/packages/:id/items/:itemId [admin] ───────────────────
router.delete('/:id/items/:itemId', requireAdmin, async (req, res) => {
  try {
    await prisma.packageItem.delete({ where: { id: Number(req.params.itemId) } });
    res.json({ message: 'Item removed from package' });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Item not found in package' });
    console.error(e);
    res.status(500).json({ error: 'Failed to remove item from package' });
  }
});

module.exports = router;
