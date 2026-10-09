const express = require('express');
const prisma = require('../prisma');
const { requireAdmin, requireFinancialAccess } = require('../middleware/auth');

const router = express.Router();

async function getTravelAgentOutstanding(travelAgentId) {
  const reservations = await prisma.banquetReservation.findMany({
    where: { guest: { travelAgentId: Number(travelAgentId) } },
    include: {
      guestBillLines: true,
      deposits: true,
    },
  });

  const totalCharges = reservations.reduce((sum, reservation) => {
    return sum + reservation.guestBillLines.reduce((lineSum, line) => lineSum + Number(line.chargeWithTax || 0), 0);
  }, 0);

  const totalSettledDeposits = reservations.reduce((sum, reservation) => {
    return sum + reservation.deposits.filter((deposit) => deposit.settled).reduce((depositSum, deposit) => depositSum + Number(deposit.amount || 0), 0);
  }, 0);

  const outstanding = Number(Math.max(totalCharges - totalSettledDeposits, 0).toFixed(2));
  return { totalCharges: Number(totalCharges.toFixed(2)), totalSettledDeposits: Number(totalSettledDeposits.toFixed(2)), outstanding };
}

router.get('/', async (req, res) => {
  try {
    const agents = await prisma.travelAgent.findMany({
      orderBy: { company: 'asc' },
      include: { guests: true },
    });
    res.json(agents);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch travel agents' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { company, contactInfo, vatRegNo, creditLimit, creditPeriodDays, isActive = true } = req.body;
    if (!company || !String(company).trim()) {
      return res.status(400).json({ error: 'company is required' });
    }

    const agent = await prisma.travelAgent.create({
      data: {
        company: String(company).trim(),
        contactInfo: contactInfo || null,
        vatRegNo: vatRegNo || null,
        creditLimit: creditLimit != null ? Number(creditLimit) : null,
        creditPeriodDays: creditPeriodDays != null ? Number(creditPeriodDays) : null,
        isActive: Boolean(isActive),
      },
    });

    res.status(201).json(agent);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create travel agent' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { company, contactInfo, vatRegNo, creditLimit, creditPeriodDays, isActive } = req.body;
    const agent = await prisma.travelAgent.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(company !== undefined && { company: String(company).trim() || null }),
        ...(contactInfo !== undefined && { contactInfo: contactInfo || null }),
        ...(vatRegNo !== undefined && { vatRegNo: vatRegNo || null }),
        ...(creditLimit !== undefined && { creditLimit: creditLimit != null ? Number(creditLimit) : null }),
        ...(creditPeriodDays !== undefined && { creditPeriodDays: creditPeriodDays != null ? Number(creditPeriodDays) : null }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });
    res.json(agent);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Travel agent not found' });
    console.error(error);
    res.status(500).json({ error: 'Failed to update travel agent' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.travelAgent.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Travel agent not found' });
    console.error(error);
    res.status(500).json({ error: 'Failed to delete travel agent' });
  }
});

router.get('/:id/reservations', async (req, res) => {
  try {
    const reservations = await prisma.banquetReservation.findMany({
      where: { guest: { travelAgentId: Number(req.params.id) } },
      include: {
        guest: true,
        dateSlots: true,
        guestBillLines: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(reservations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch agent reservations' });
  }
});

router.get('/:id/credit-status', requireFinancialAccess, async (req, res) => {
  try {
    const agent = await prisma.travelAgent.findUnique({ where: { id: Number(req.params.id) } });
    if (!agent) return res.status(404).json({ error: 'Travel agent not found' });

    const status = await getTravelAgentOutstanding(agent.id);
    const creditLimit = agent.creditLimit != null ? Number(agent.creditLimit) : null;

    res.json({
      agent,
      creditLimit,
      totalCharges: status.totalCharges,
      totalSettledDeposits: status.totalSettledDeposits,
      outstanding: status.outstanding,
      overLimit: creditLimit != null ? status.outstanding > creditLimit : false,
      remaining: creditLimit != null ? Number((creditLimit - status.outstanding).toFixed(2)) : null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to calculate travel agent credit status' });
  }
});

module.exports = router;
