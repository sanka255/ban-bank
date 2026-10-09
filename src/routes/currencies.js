const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

router.get('/', async (_req, res) => {
  try {
    const currencies = await prisma.currency.findMany({
      orderBy: { code: 'asc' },
      include: { rates: { orderBy: { effectiveDate: 'desc' } } },
    });
    res.json(currencies);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch currencies' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { code, name, symbol, isActive = true } = req.body || {};
    if (!code || !name || !symbol) {
      return res.status(400).json({ error: 'code, name and symbol are required' });
    }

    const currency = await prisma.currency.create({
      data: {
        code: String(code).trim().toUpperCase(),
        name: String(name).trim(),
        symbol: String(symbol).trim(),
        isActive: Boolean(isActive),
      },
    });

    res.status(201).json(currency);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Currency code already exists' });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create currency' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const currencyId = Number(req.params.id);
    const { code, name, symbol, isActive } = req.body || {};

    const currency = await prisma.currency.update({
      where: { id: currencyId },
      data: {
        ...(code ? { code: String(code).trim().toUpperCase() } : {}),
        ...(name ? { name: String(name).trim() } : {}),
        ...(symbol ? { symbol: String(symbol).trim() } : {}),
        ...(typeof isActive === 'boolean' ? { isActive } : {}),
      },
    });

    res.json(currency);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Currency not found' });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Currency code already exists' });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to update currency' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const currencyId = Number(req.params.id);
    const currency = await prisma.currency.update({
      where: { id: currencyId },
      data: { isActive: false },
    });
    res.json({ ok: true, currency });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Currency not found' });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to deactivate currency' });
  }
});

module.exports = router;
