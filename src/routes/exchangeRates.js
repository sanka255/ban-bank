const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('../middleware/auth');
const { getEffectiveRate, toDateOnly } = require('../services/exchangeRateService');

const router = express.Router();
router.use(requireAdmin);

router.get('/', async (req, res) => {
  try {
    const { currencyId } = req.query;
    const rates = await prisma.exchangeRate.findMany({
      where: currencyId ? { currencyId: Number(currencyId) } : undefined,
      orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }],
      include: { currency: { select: { id: true, code: true, name: true, symbol: true } } },
    });
    res.json(rates);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch exchange rates' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { currencyId, rateToBase, effectiveDate, createdBy } = req.body || {};
    if (!currencyId || rateToBase == null || !effectiveDate) {
      return res.status(400).json({ error: 'currencyId, rateToBase and effectiveDate are required' });
    }

    const numericCurrencyId = Number(currencyId);
    const numericRate = Number(rateToBase);

    if (!Number.isFinite(numericCurrencyId) || !Number.isFinite(numericRate) || numericRate <= 0) {
      return res.status(400).json({ error: 'currencyId and rateToBase must be valid positive numbers' });
    }

    const currency = await prisma.currency.findUnique({ where: { id: numericCurrencyId } });
    if (!currency) {
      return res.status(404).json({ error: 'Currency not found' });
    }

    const dateValue = toDateOnly(new Date(effectiveDate));
    const existing = await prisma.exchangeRate.findUnique({
      where: {
        currencyId_effectiveDate: {
          currencyId: numericCurrencyId,
          effectiveDate: dateValue,
        },
      },
    });

    if (existing) {
      return res.status(409).json({ error: 'A rate already exists for this currency on that effective date' });
    }

    const rate = await prisma.exchangeRate.create({
      data: {
        currencyId: numericCurrencyId,
        rateToBase: numericRate,
        effectiveDate: dateValue,
        createdBy: Number(createdBy || req.user?.id || 1),
      },
      include: { currency: { select: { id: true, code: true, name: true, symbol: true } } },
    });

    res.status(201).json(rate);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create exchange rate' });
  }
});

router.get('/:currencyId/current', async (req, res) => {
  try {
    const currencyId = Number(req.params.currencyId);
    const rate = await getEffectiveRate(currencyId, new Date());
    res.json(rate);
  } catch (error) {
    console.error(error);
    res.status(404).json({ error: error.message || 'No current rate configured' });
  }
});

module.exports = router;
