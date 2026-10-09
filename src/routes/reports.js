const express = require('express');
const prisma = require('../prisma');
const { requireFinancialAccess } = require('../middleware/auth');

const router = express.Router();

function parseDateRange(query, defaultDays = 30) {
  const fromDate = query.fromDate || new Date(Date.now() - defaultDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const toDate = query.toDate || new Date().toISOString().slice(0, 10);

  const fromStart = new Date(`${fromDate}T00:00:00.000Z`);
  const toEnd = new Date(`${toDate}T23:59:59.999Z`);

  return { fromDate, toDate, fromStart, toEnd };
}

router.get('/availability', async (req, res) => {
  try {
    const { fromDate, toDate, fromStart, toEnd } = parseDateRange(req.query, 30);
    const partitions = await prisma.hallPartition.findMany({
      include: { hall: true },
      orderBy: [{ hallId: 'asc' }, { id: 'asc' }],
    });

    const activeSlots = await prisma.banquetDateSlot.findMany({
      where: {
        status: 'active',
        fromDate: { lte: toEnd },
        toDate: { gte: fromStart },
      },
      include: { partition: true },
    });

    const slotMap = new Map();
    activeSlots.forEach((slot) => {
      const start = new Date(slot.fromDate);
      const end = new Date(slot.toDate);
      let cursor = new Date(start.getTime());
      while (cursor <= end) {
        const key = `${slot.partitionId}|${cursor.toISOString().slice(0, 10)}`;
        slotMap.set(key, true);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    });

    const results = [];
    for (const partition of partitions) {
      const current = new Date(fromStart.getTime());
      while (current <= toEnd) {
        const dayKey = current.toISOString().slice(0, 10);
        const isBooked = slotMap.has(`${partition.id}|${dayKey}`);
        results.push({
          partitionId: partition.id,
          partitionName: partition.name,
          hallName: partition.hall?.name || null,
          date: dayKey,
          booked: isBooked,
        });
        current.setUTCDate(current.getUTCDate() + 1);
      }
    }

    res.json({ fromDate, toDate, rows: results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch availability report' });
  }
});

router.get('/revenue', requireFinancialAccess, async (req, res) => {
  try {
    const { fromDate, toDate, fromStart, toEnd } = parseDateRange(req.query, 30);
    const billLines = await prisma.guestBillLine.findMany({
      where: {
        insertDate: { gte: fromStart, lte: toEnd },
      },
      include: { reservation: true },
      orderBy: { insertDate: 'asc' },
    });

    const totals = {
      hall_charge: { base: 0, tax: 0, total: 0 },
      item: { base: 0, tax: 0, total: 0 },
      menu: { base: 0, tax: 0, total: 0 },
      package: { base: 0, tax: 0, total: 0 },
      extra: { base: 0, tax: 0, total: 0 },
    };

    let complementaryCount = 0;
    for (const line of billLines) {
      const lineType = line.lineType;
      const charge = Number(line.charge || 0);
      const tax = Number(line.taxAmount || 0);
      if (charge === 0) {
        complementaryCount += 1;
        continue;
      }
      if (!totals[lineType]) {
        totals[lineType] = { base: 0, tax: 0, total: 0 };
      }
      totals[lineType].base += charge;
      totals[lineType].tax += tax;
      totals[lineType].total += Number(line.chargeWithTax || 0);
    }

    const rows = Object.entries(totals).map(([lineType, metrics]) => ({
      lineType,
      baseCharges: Number(metrics.base.toFixed(2)),
      taxAmount: Number(metrics.tax.toFixed(2)),
      totalWithTax: Number(metrics.total.toFixed(2)),
    }));

    const totalBaseCharges = rows.reduce((sum, row) => sum + row.baseCharges, 0);
    const totalTaxAmount = rows.reduce((sum, row) => sum + row.taxAmount, 0);
    const totalRevenue = rows.reduce((sum, row) => sum + row.totalWithTax, 0);

    res.json({
      fromDate,
      toDate,
      complementaryCount,
      rows,
      totals: {
        baseCharges: Number(totalBaseCharges.toFixed(2)),
        taxAmount: Number(totalTaxAmount.toFixed(2)),
        totalWithTax: Number(totalRevenue.toFixed(2)),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch revenue report' });
  }
});

router.get('/deposits', requireFinancialAccess, async (req, res) => {
  try {
    const { fromDate, toDate, fromStart, toEnd } = parseDateRange(req.query, 30);
    const deposits = await prisma.hallDeposit.findMany({
      where: {
        insertDate: { gte: fromStart, lte: toEnd },
      },
      include: { reservation: { include: { guest: true } } },
      orderBy: { insertDate: 'desc' },
    });

    const totalTaken = deposits.reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
    const totalSettled = deposits.filter((deposit) => deposit.settled).reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
    const totalOutstanding = deposits.filter((deposit) => !deposit.settled).reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);

    res.json({
      fromDate,
      toDate,
      totalTaken: Number(totalTaken.toFixed(2)),
      totalSettled: Number(totalSettled.toFixed(2)),
      totalOutstanding: Number(totalOutstanding.toFixed(2)),
      deposits,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch deposits report' });
  }
});

router.get('/cancellations', async (req, res) => {
  try {
    const { fromDate, toDate, fromStart, toEnd } = parseDateRange(req.query, 30);
    const withdrawals = await prisma.hallWithdrawal.findMany({
      where: {
        withdrawalDate: { gte: fromStart, lte: toEnd },
      },
      include: {
        reservation: { include: { guest: true } },
        dateSlot: true,
        tier: true,
      },
      orderBy: { withdrawalDate: 'desc' },
    });

    res.json({
      fromDate,
      toDate,
      rows: withdrawals.map((entry) => ({
        id: entry.id,
        reservationId: entry.reservationId,
        reservationCode: entry.reservation?.reservationCode || null,
        guestName: entry.reservation?.guest ? `${entry.reservation.guest.firstName} ${entry.reservation.guest.lastName || ''}`.trim() : '',
        dateSlotId: entry.dateSlotId,
        withdrawalDate: entry.withdrawalDate,
        refundableAmount: Number(entry.refundableAmount || 0),
        refundPercentage: Number(entry.refundPercentage || 0),
        cancellationFee: Number(entry.cancellationFee || 0),
        fullCharge: Number(entry.fullCharge || 0),
        tierIdApplied: entry.tierIdApplied,
        tier: entry.tier,
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch cancellations report' });
  }
});

router.get('/travel-agent-summary', requireFinancialAccess, async (req, res) => {
  try {
    const agents = await prisma.travelAgent.findMany({
      include: { guests: { include: { reservations: { include: { guestBillLines: true, deposits: true } } } } },
      orderBy: { company: 'asc' },
    });

    const rows = agents.map((agent) => {
      const reservations = agent.guests.flatMap((guest) => guest.reservations);
      const bookingCount = reservations.length;
      const revenue = reservations.reduce((sum, reservation) => {
        return sum + reservation.guestBillLines.reduce((lineSum, line) => lineSum + Number(line.chargeWithTax || 0), 0);
      }, 0);
      const settledDeposits = reservations.reduce((sum, reservation) => {
        return sum + reservation.deposits.filter((deposit) => deposit.settled).reduce((depositSum, deposit) => depositSum + Number(deposit.amount || 0), 0);
      }, 0);
      const outstanding = Math.max(revenue - settledDeposits, 0);
      const creditLimit = agent.creditLimit != null ? Number(agent.creditLimit) : null;

      return {
        agentId: agent.id,
        company: agent.company,
        contactInfo: agent.contactInfo,
        creditLimit,
        bookings: bookingCount,
        revenue: Number(revenue.toFixed(2)),
        settledDeposits: Number(settledDeposits.toFixed(2)),
        outstanding: Number(outstanding.toFixed(2)),
        overLimit: creditLimit != null ? outstanding > creditLimit : false,
      };
    });

    res.json({ rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch travel agent summary' });
  }
});

module.exports = router;
