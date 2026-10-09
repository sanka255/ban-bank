const express = require('express');
const prisma = require('../prisma');

const router = express.Router({ mergeParams: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Look up the active MenuRate for `menuId` on a given event date.
 * "Active" = rate plan is active AND eventDate falls inside plan.fromDate..toDate.
 * Returns null if none found.
 */
async function findMenuRate(menuId, eventDate) {
  const eventDateObj = new Date(`${eventDate}T00:00:00.000Z`);
  return prisma.menuRate.findFirst({
    where: {
      menuId,
      ratePlan: {
        isActive: true,
        fromDate: { lte: eventDateObj },
        toDate:   { gte: eventDateObj },
      },
    },
    include: { ratePlan: true },
  });
}

// ─── Requested Items (a-la-carte) ─────────────────────────────────────────────

/**
 * POST /api/banquet/date-slots/:id/requested-items
 *
 * Snapshots unitPrice from MenuItem.charge at attach time so that later
 * price edits to the item master do NOT silently change existing bookings.
 */
router.post('/:id/requested-items', async (req, res) => {
  try {
    const dateSlotId = Number(req.params.id);
    const { itemId, quantity, unitPrice: overridePrice, isComplementary = false, reason } = req.body;

    if (!itemId || quantity == null) {
      return res.status(400).json({ error: 'itemId and quantity are required' });
    }
    if (isComplementary && !reason?.trim()) {
      return res.status(400).json({ error: 'reason is required when isComplementary is true' });
    }

    // Verify slot exists
    const slot = await prisma.banquetDateSlot.findUnique({ where: { id: dateSlotId } });
    if (!slot) return res.status(404).json({ error: 'Date slot not found' });

    // Load item to snapshot price
    const item = await prisma.menuItem.findUnique({ where: { id: Number(itemId) } });
    if (!item) return res.status(404).json({ error: 'Menu item not found' });
    if (item.isActive === false) return res.status(409).json({ error: 'Menu item is inactive' });

    // SNAPSHOT: use item.charge unless caller explicitly overrides
    const unitPrice = overridePrice != null ? Number(overridePrice) : Number(item.charge);
    const qty       = Number(quantity);
    const charge    = Number((unitPrice * qty).toFixed(2));

    const ri = await prisma.requestedItem.create({
      data: {
        dateSlotId,
        itemId: Number(itemId),
        quantity: qty,
        unitPrice,
        charge,
        isComplementary: Boolean(isComplementary),
        reason: isComplementary ? reason.trim() : null,
      },
      include: { item: { include: { category: true } } },
    });
    res.status(201).json(ri);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to attach item' }); }
});

/**
 * PUT /api/banquet/date-slots/:id/requested-items/:riId
 * Edit quantity/price — charge is recomputed.
 */
router.put('/:id/requested-items/:riId', async (req, res) => {
  try {
    const { quantity, unitPrice, isComplementary, reason } = req.body;
    const existing = await prisma.requestedItem.findUnique({ where: { id: Number(req.params.riId) } });
    if (!existing) return res.status(404).json({ error: 'Requested item not found' });

    const willBeComp = isComplementary !== undefined ? Boolean(isComplementary) : existing.isComplementary;
    const newReason  = reason !== undefined ? reason : existing.reason;
    if (willBeComp && !newReason?.trim()) {
      return res.status(400).json({ error: 'reason is required when isComplementary is true' });
    }

    const newQty   = quantity  != null ? Number(quantity)   : Number(existing.quantity);
    const newPrice = unitPrice != null ? Number(unitPrice)  : Number(existing.unitPrice);
    const charge   = Number((newQty * newPrice).toFixed(2));

    const ri = await prisma.requestedItem.update({
      where: { id: Number(req.params.riId) },
      data: {
        quantity: newQty, unitPrice: newPrice, charge,
        isComplementary: willBeComp,
        reason: willBeComp ? (newReason?.trim() || null) : null,
      },
      include: { item: { include: { category: true } } },
    });
    res.json(ri);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Requested item not found' });
    console.error(e); res.status(500).json({ error: 'Failed to update requested item' });
  }
});

/**
 * DELETE /api/banquet/date-slots/:id/requested-items/:riId
 */
router.delete('/:id/requested-items/:riId', async (req, res) => {
  try {
    await prisma.requestedItem.delete({ where: { id: Number(req.params.riId) } });
    res.json({ message: 'Item removed from date slot' });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Requested item not found' });
    console.error(e); res.status(500).json({ error: 'Failed to remove item' });
  }
});

// ─── Requested Menus ──────────────────────────────────────────────────────────

/**
 * POST /api/banquet/date-slots/:id/requested-menus
 *
 * Finds the active MenuRate for the menu on the slot's event date.
 * Rejects with 422 if no rate plan covers that date — never silently uses 0.
 */
router.post('/:id/requested-menus', async (req, res) => {
  try {
    const dateSlotId = Number(req.params.id);
    const { menuItemId, menuId, guestCount, isComplementary = false, reason } = req.body;
    const resolvedMenuId = menuId != null ? Number(menuId) : menuItemId != null ? Number(menuItemId) : null;

    if (!resolvedMenuId || guestCount == null) {
      return res.status(400).json({ error: 'menuId and guestCount are required' });
    }
    if (isComplementary && !reason?.trim()) {
      return res.status(400).json({ error: 'reason is required when isComplementary is true' });
    }

    const slot = await prisma.banquetDateSlot.findUnique({ where: { id: dateSlotId } });
    if (!slot) return res.status(404).json({ error: 'Date slot not found' });

    const menu = await prisma.menu.findUnique({ where: { id: resolvedMenuId } });
    if (!menu) return res.status(404).json({ error: 'Menu not found' });
    if (menu.isActive === false) return res.status(409).json({ error: 'Menu is inactive' });

    const eventDate = slot.fromDate.toISOString().slice(0, 10);
    const rate = await findMenuRate(menu.id, eventDate);

    if (!rate) {
      return res.status(422).json({
        error: `No active rate plan covers the event date ${eventDate} for menu "${menu.name}". ` +
               `Configure a rate plan that covers this date before attaching the menu.`,
        eventDate,
        menuId: menu.id,
        menuName: menu.name,
      });
    }

    const count  = Number(guestCount);
    const charge = Number((Number(rate.charge) * count).toFixed(2));

    const rm = await prisma.requestedMenuItem.create({
      data: {
        dateSlotId,
        menuId: menu.id,
        guestCount: count,
        charge,
        isComplementary: Boolean(isComplementary),
        reason: isComplementary ? reason.trim() : null,
      },
      include: { menu: true },
    });
    res.status(201).json({ ...rm, appliedRate: rate });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to attach menu' }); }
});

/**
 * DELETE /api/banquet/date-slots/:id/requested-menus/:rmId
 */
router.delete('/:id/requested-menus/:rmId', async (req, res) => {
  try {
    await prisma.requestedMenuItem.delete({ where: { id: Number(req.params.rmId) } });
    res.json({ message: 'Menu removed from date slot' });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Requested menu not found' });
    console.error(e); res.status(500).json({ error: 'Failed to remove menu' });
  }
});

// ─── GET full date-slot with all selections ───────────────────────────────────
router.get('/:id/items-summary', async (req, res) => {
  try {
    const slot = await prisma.banquetDateSlot.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        requestedItems: { include: { item: { include: { category: true } } } },
        requestedMenuItems: { include: { menu: true } },
        partition: { include: { hall: true } },
        reservation: { select: { reservationCode: true, numberOfGuests: true } },
      },
    });
    if (!slot) return res.status(404).json({ error: 'Date slot not found' });

    const itemsTotal = slot.requestedItems.reduce((s, i) => s + Number(i.charge), 0);
    const menusTotal = slot.requestedMenuItems.reduce((s, m) => s + Number(m.charge), 0);

    res.json({
      slot,
      subtotals: {
        hallCharge: Number(slot.charge),
        itemsTotal,
        menusTotal,
        grandTotal: Number(slot.charge) + itemsTotal + menusTotal,
      },
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch slot summary' }); }
});

module.exports = router;
