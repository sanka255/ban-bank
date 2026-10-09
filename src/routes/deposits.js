const express = require('express');
const prisma = require('../prisma');
const { postDepositToGL, settleDepositToRevenue } = require('../services/glService');
const { snapshotCurrencyAmount } = require('../services/exchangeRateService');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { reservationId } = req.query;
    const deposits = await prisma.hallDeposit.findMany({
      where: reservationId ? { reservationId: Number(reservationId) } : {},
      orderBy: { insertDate: 'desc' },
    });
    res.json(deposits);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch deposits' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { reservationId, amount, paymentMethod, currencyId, receiptNo, remark } = req.body;
    if (!reservationId || amount == null) {
      return res.status(400).json({ error: 'reservationId and amount are required' });
    }

    const reservation = await prisma.banquetReservation.findUnique({ where: { id: Number(reservationId) } });
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

    const currencySnapshot = currencyId != null && Number(currencyId) !== 0
      ? await snapshotCurrencyAmount(amount, Number(currencyId), new Date())
      : { currencyId: null, baseCurrencyAmount: Number(amount), exchangeRateUsed: 1 };

    const deposit = await prisma.$transaction(async (tx) => {
      const created = await tx.hallDeposit.create({
        data: {
          reservationId: Number(reservationId),
          amount: Number(amount),
          paymentMethod: paymentMethod || 'cash',
          currencyId: currencySnapshot.currencyId,
          baseCurrencyAmount: currencySnapshot.baseCurrencyAmount,
          exchangeRateUsed: currencySnapshot.exchangeRateUsed,
          settled: false,
          receiptNo: receiptNo || null,
          insertDate: new Date(),
          remark: remark || null,
        },
      });

      await postDepositToGL(tx, created, req.user?.id || 1);
      return created;
    });

    res.status(201).json(deposit);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to record deposit' });
  }
});

router.put('/:id/settle', async (req, res) => {
  try {
    const depositId = Number(req.params.id);
    const deposit = await prisma.$transaction(async (tx) => {
      const updated = await tx.hallDeposit.update({
        where: { id: depositId },
        data: { settled: true },
      });
      await settleDepositToRevenue(tx, updated, req.user?.id || 1);
      return updated;
    });
    res.json(deposit);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Deposit not found' });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to settle deposit' });
  }
});

module.exports = router;
