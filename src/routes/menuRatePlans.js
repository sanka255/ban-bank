const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const PLAN_INCLUDE = {
  rates: { include: { menu: { select: { id: true, name: true } } }, orderBy: { menuId: 'asc' } },
};

// ── GET /api/banquet/menu-rate-plans ─────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const plans = await prisma.menuRatePlan.findMany({ include: PLAN_INCLUDE, orderBy: { fromDate: 'asc' } });
    res.json(plans);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch rate plans' }); }
});

// ── GET /api/banquet/menu-rate-plans/:id ─────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const plan = await prisma.menuRatePlan.findUnique({ where: { id: Number(req.params.id) }, include: PLAN_INCLUDE });
    if (!plan) return res.status(404).json({ error: 'Rate plan not found' });
    res.json(plan);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch rate plan' }); }
});

// ── POST /api/banquet/menu-rate-plans  [admin] ───────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, fromDate, toDate, isActive } = req.body;
    if (!name?.trim() || !fromDate || !toDate) {
      return res.status(400).json({ error: 'name, fromDate, and toDate are required' });
    }
    const plan = await prisma.menuRatePlan.create({
      data: {
        name: name.trim(),
        fromDate: new Date(`${fromDate}T00:00:00.000Z`),
        toDate:   new Date(`${toDate}T00:00:00.000Z`),
        isActive: isActive !== false,
      },
      include: PLAN_INCLUDE,
    });
    res.status(201).json(plan);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create rate plan' }); }
});

// ── PUT /api/banquet/menu-rate-plans/:id  [admin] ────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, fromDate, toDate, isActive } = req.body;
    const plan = await prisma.menuRatePlan.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(name     != null && { name: name.trim() }),
        ...(fromDate != null && { fromDate: new Date(`${fromDate}T00:00:00.000Z`) }),
        ...(toDate   != null && { toDate:   new Date(`${toDate}T00:00:00.000Z`)   }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
      include: PLAN_INCLUDE,
    });
    res.json(plan);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Rate plan not found' });
    console.error(e); res.status(500).json({ error: 'Failed to update rate plan' });
  }
});

// ── DELETE /api/banquet/menu-rate-plans/:id  [admin] ─────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.menuRatePlan.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: 'Rate plan deleted' });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Rate plan not found' });
    console.error(e); res.status(500).json({ error: 'Failed to delete rate plan' });
  }
});

// ── GET /api/banquet/menu-rate-plans/:planId/rates ───────────────────────────
router.get('/:planId/rates', async (req, res) => {
  try {
    const rates = await prisma.menuRate.findMany({
      where: { ratePlanId: Number(req.params.planId) },
      include: { menu: true, ratePlan: true },
    });
    res.json(rates);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch rates' }); }
});

// ── POST /api/banquet/menu-rate-plans/:planId/rates  [admin] ─────────────────
router.post('/:planId/rates', requireAdmin, async (req, res) => {
  try {
    const { menuId, charge } = req.body;
    if (!menuId || charge == null) return res.status(400).json({ error: 'menuId and charge are required' });
    const rate = await prisma.menuRate.create({
      data: { ratePlanId: Number(req.params.planId), menuId: Number(menuId), charge: Number(charge) },
      include: { menu: true, ratePlan: true },
    });
    res.status(201).json(rate);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Rate already exists for this plan + menu combination' });
    console.error(e); res.status(500).json({ error: 'Failed to create rate' });
  }
});

// ── PUT /api/banquet/menu-rate-plans/:planId/rates/:rateId  [admin] ──────────
router.put('/:planId/rates/:rateId', requireAdmin, async (req, res) => {
  try {
    const { charge } = req.body;
    const rate = await prisma.menuRate.update({
      where: { id: Number(req.params.rateId) },
      data: { ...(charge != null && { charge: Number(charge) }) },
      include: { menu: true, ratePlan: true },
    });
    res.json(rate);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Rate not found' });
    console.error(e); res.status(500).json({ error: 'Failed to update rate' });
  }
});

// ── DELETE /api/banquet/menu-rate-plans/:planId/rates/:rateId  [admin] ───────
router.delete('/:planId/rates/:rateId', requireAdmin, async (req, res) => {
  try {
    await prisma.menuRate.delete({ where: { id: Number(req.params.rateId) } });
    res.json({ message: 'Rate deleted' });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Rate not found' });
    console.error(e); res.status(500).json({ error: 'Failed to delete rate' });
  }
});

module.exports = router;
