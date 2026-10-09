const prisma = require('../prisma');

function toDateOnly(dateValue = new Date()) {
  const date = new Date(dateValue);
  date.setHours(0, 0, 0, 0);
  return date;
}

async function ensureBaseCurrency() {
  const existing = await prisma.currency.findUnique({ where: { code: 'LKR' } });
  if (existing) return existing;

  const created = await prisma.currency.create({
    data: {
      code: 'LKR',
      name: 'Sri Lankan Rupee',
      symbol: 'Rs',
      isActive: true,
    },
  });

  await prisma.exchangeRate.upsert({
    where: {
      currencyId_effectiveDate: {
        currencyId: created.id,
        effectiveDate: toDateOnly(new Date()),
      },
    },
    update: { rateToBase: 1 },
    create: {
      currencyId: created.id,
      rateToBase: 1,
      effectiveDate: toDateOnly(new Date()),
      createdBy: 1,
    },
  });

  return created;
}

async function getEffectiveRate(currencyId, date = new Date()) {
  const currencyIdentifier = Number(currencyId);
  if (!currencyIdentifier) {
    await ensureBaseCurrency();
    return {
      id: null,
      currencyId: null,
      rateToBase: 1,
      effectiveDate: toDateOnly(date),
      createdBy: 1,
      createdAt: new Date(),
    };
  }

  const currency = await prisma.currency.findUnique({
    where: { id: currencyIdentifier },
    select: { id: true, code: true },
  });

  if (!currency) {
    throw new Error('Currency not found.');
  }

  const rate = await prisma.exchangeRate.findFirst({
    where: {
      currencyId: currencyIdentifier,
      effectiveDate: {
        lte: toDateOnly(date),
      },
    },
    orderBy: {
      effectiveDate: 'desc',
    },
  });

  if (!rate) {
    if (currency.code === 'LKR') {
      const created = await prisma.exchangeRate.upsert({
        where: {
          currencyId_effectiveDate: {
            currencyId: currency.id,
            effectiveDate: toDateOnly(date),
          },
        },
        update: { rateToBase: 1 },
        create: {
          currencyId: currency.id,
          rateToBase: 1,
          effectiveDate: toDateOnly(date),
          createdBy: 1,
        },
      });
      return created;
    }

    throw new Error('No exchange rate configured for this currency as of this date');
  }

  return rate;
}

function convertToBase(amount, rate) {
  return Number(amount) * Number(rate.rateToBase);
}

async function snapshotCurrencyAmount(amount, currencyId, date = new Date()) {
  const numericAmount = Number(amount);

  if (!currencyId || Number(currencyId) === 0) {
    return {
      currencyId: null,
      baseCurrencyAmount: numericAmount,
      exchangeRateUsed: 1,
    };
  }

  const rate = await getEffectiveRate(currencyId, date);
  return {
    currencyId: Number(currencyId),
    baseCurrencyAmount: convertToBase(numericAmount, rate),
    exchangeRateUsed: Number(rate.rateToBase),
  };
}

module.exports = {
  ensureBaseCurrency,
  getEffectiveRate,
  convertToBase,
  snapshotCurrencyAmount,
  toDateOnly,
};
