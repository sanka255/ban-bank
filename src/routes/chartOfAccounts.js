const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAdmin, async (req, res) => {
  try {
    const accounts = await prisma.chartOfAccount.findMany({
      orderBy: [{ accountNo: 'asc' }, { name: 'asc' }],
    });
    res.json(accounts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch chart of accounts' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { accountNo, name, accountType, isActive = true } = req.body || {};
    if (!accountNo || !name || !accountType) {
      return res.status(400).json({ error: 'accountNo, name, and accountType are required' });
    }

    const account = await prisma.chartOfAccount.create({
      data: {
        accountNo: String(accountNo),
        name: String(name).trim(),
        accountType: String(accountType),
        isActive: isActive !== false,
      },
    });

    res.status(201).json(account);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Chart of account number already exists' });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create chart of account' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { accountNo, name, accountType, isActive } = req.body || {};
    const account = await prisma.chartOfAccount.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(accountNo !== undefined && { accountNo: String(accountNo) }),
        ...(name !== undefined && { name: String(name).trim() }),
        ...(accountType !== undefined && { accountType: String(accountType) }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });
    res.json(account);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Chart of account not found' });
    if (error.code === 'P2002') return res.status(409).json({ error: 'Chart of account number already exists' });
    console.error(error);
    res.status(500).json({ error: 'Failed to update chart of account' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.chartOfAccount.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Chart of account not found' });
    console.error(error);
    res.status(500).json({ error: 'Failed to delete chart of account' });
  }
});

module.exports = router;
