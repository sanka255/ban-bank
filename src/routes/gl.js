const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

function parsePeriod(query) {
  const from = query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = query.to || new Date().toISOString().slice(0, 10);
  return {
    from,
    to,
    fromStart: new Date(`${from}T00:00:00.000Z`),
    toEnd: new Date(`${to}T23:59:59.999Z`),
  };
}

router.get('/entries', requireAdmin, async (req, res) => {
  try {
    const { accountId, from, to } = req.query;
    const where = {};

    if (accountId) where.accountId = Number(accountId);
    if (from || to) {
      const period = parsePeriod(req.query);
      where.postedAt = { gte: period.fromStart, lte: period.toEnd };
    }

    const entries = await prisma.gLEntry.findMany({
      where,
      include: { account: true },
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
    });

    res.json(entries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch GL entries' });
  }
});

router.get('/reconciliation', requireAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    const { fromStart, toEnd } = parsePeriod(req.query);

    // billing: fetch GuestBillLine ids and sums for the event period (use insertDate/event date)
    const billLines = await prisma.guestBillLine.findMany({
      where: { insertDate: { gte: fromStart, lte: toEnd } },
      select: { id: true, chargeWithTax: true },
    });
    const billingTotalValue = billLines.reduce((s, b) => s + Number(b.chargeWithTax || 0), 0);

    // find withdrawals in the period (withdrawalDate)
    const withdrawals = await prisma.hallWithdrawal.findMany({
      where: { withdrawalDate: { gte: fromStart, lte: toEnd } },
      select: { id: true },
    });

    const billIds = billLines.map(b => b.id);
    const withdrawalIds = withdrawals.map(w => w.id);

    // Build combined filter: postedAt in period OR linked to bill lines OR linked to withdrawals
    const combinedWhereOr = [];
    combinedWhereOr.push({ postedAt: { gte: fromStart, lte: toEnd } });
    if (billIds.length > 0) combinedWhereOr.push({ sourceType: 'guest_bill_line', sourceId: { in: billIds } });
    if (withdrawalIds.length > 0) combinedWhereOr.push({ sourceType: 'hall_withdrawal', sourceId: { in: withdrawalIds } });

    // totals: sum debits/credits by GL either posted in the period OR linked to event-dated bill/withdrawal
    const totals = await prisma.gLEntry.groupBy({
      by: ['entryType'],
      where: { OR: combinedWhereOr },
      _sum: { amount: true },
    });

    // receivableAccount for lookups
    const receivableAccount = await prisma.chartOfAccount.findFirst({ where: { name: 'Banquet Receivable' } });

    // receivable debits for those bill lines (match by sourceType/sourceId) regardless of postedAt
    let receivableDebitAgg = { _sum: { amount: 0 } };
    if (receivableAccount && billIds.length > 0) {
      receivableDebitAgg = await prisma.gLEntry.aggregate({
        where: {
          accountId: receivableAccount.id,
          entryType: 'debit',
          sourceType: 'guest_bill_line',
          sourceId: { in: billIds },
        },
        _sum: { amount: true },
      });
    }

    const debitTotal = totals.find((entry) => entry.entryType === 'debit')?._sum?.amount || 0;
    const creditTotal = totals.find((entry) => entry.entryType === 'credit')?._sum?.amount || 0;
    const receivableDebitValue = Number(receivableDebitAgg._sum.amount || 0);
    const variance = Number((Number(debitTotal) - Number(creditTotal)).toFixed(2));
    const receivableVariance = Number((billingTotalValue - receivableDebitValue).toFixed(2));

    res.json({
      from,
      to,
      totals: {
        debits: Number(Number(debitTotal).toFixed(2)),
        credits: Number(Number(creditTotal).toFixed(2)),
        variance,
      },
      receivable: {
        billingTotal: Number(billingTotalValue.toFixed(2)),
        receivableDebits: Number(receivableDebitValue.toFixed(2)),
        variance: receivableVariance,
      },
      balanced: Math.abs(variance) < 0.01,
      billingMatchesReceivable: Math.abs(receivableVariance) < 0.01,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to reconcile GL postings' });
  }
});

module.exports = router;
