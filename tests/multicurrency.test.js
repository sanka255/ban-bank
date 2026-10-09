const test = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../src/prisma');
const {
  convertToBase,
  getEffectiveRate,
  snapshotCurrencyAmount,
} = require('../src/services/exchangeRateService');

const createdCurrencyIds = [];

async function createCurrency(code, symbol = '$') {
  const currency = await prisma.currency.create({
    data: {
      code,
      name: `${code} Test Currency`,
      symbol,
      isActive: true,
    },
  });
  createdCurrencyIds.push(currency.id);
  return currency;
}

test('convertToBase multiplies amount by the configured rate', () => {
  const result = convertToBase(100, { rateToBase: 312.75 });
  assert.equal(Number(result), 31275);
});

test('getEffectiveRate uses the latest eligible rate, not a future one', async () => {
  const currency = await createCurrency(`T${Date.now()}USD`, '$');
  const today = new Date();
  const earlier = new Date(today);
  earlier.setDate(today.getDate() - 10);
  const later = new Date(today);
  later.setDate(today.getDate() + 10);

  await prisma.exchangeRate.createMany({
    data: [
      { currencyId: currency.id, rateToBase: 305.5, effectiveDate: earlier, createdBy: 1 },
      { currencyId: currency.id, rateToBase: 320.25, effectiveDate: later, createdBy: 1 },
    ],
  });

  const rate = await getEffectiveRate(currency.id, today);
  assert.equal(Number(rate.rateToBase), 305.5);
});

test('snapshotCurrencyAmount locks the base amount and rate at transaction time', async () => {
  const currency = await createCurrency(`T${Date.now()}EUR`, '€');
  const day = new Date();
  const historical = new Date(day);
  historical.setDate(day.getDate() - 20);

  await prisma.exchangeRate.create({
    data: {
      currencyId: currency.id,
      rateToBase: 0.88,
      effectiveDate: historical,
      createdBy: 1,
    },
  });

  const snapshot = await snapshotCurrencyAmount(150, currency.id, new Date());
  assert.equal(Number(snapshot.baseCurrencyAmount), 132);
  assert.equal(Number(snapshot.exchangeRateUsed), 0.88);
  assert.equal(snapshot.currencyId, currency.id);
});

test('getEffectiveRate rejects currencies with no configured rate', async () => {
  const currency = await createCurrency(`T${Date.now()}JPY`, '¥');
  await assert.rejects(() => getEffectiveRate(currency.id, new Date()), /No exchange rate configured/);
});

test.after(async () => {
  const ids = createdCurrencyIds;
  if (ids.length === 0) return;
  await prisma.exchangeRate.deleteMany({ where: { currencyId: { in: ids } } });
  await prisma.currency.deleteMany({ where: { id: { in: ids } } });
});
