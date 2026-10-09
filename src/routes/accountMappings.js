const express = require('express');
const prisma = require('../prisma');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAdmin, async (req, res) => {
  try {
    const mappings = await prisma.accountMapping.findMany({
      include: { account: true },
      orderBy: [{ mappingType: 'asc' }, { sourceId: 'asc' }],
    });
    res.json(mappings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch account mappings' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { mappingType, sourceId, accountId } = req.body || {};
    if (!mappingType || !accountId) {
      return res.status(400).json({ error: 'mappingType and accountId are required' });
    }

    const mapping = await prisma.accountMapping.create({
      data: {
        mappingType: String(mappingType),
        sourceId: sourceId != null ? Number(sourceId) : null,
        accountId: Number(accountId),
      },
      include: { account: true },
    });

    res.status(201).json(mapping);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create account mapping' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { mappingType, sourceId, accountId } = req.body || {};
    const mapping = await prisma.accountMapping.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(mappingType !== undefined && { mappingType: String(mappingType) }),
        ...(sourceId !== undefined && { sourceId: sourceId != null ? Number(sourceId) : null }),
        ...(accountId !== undefined && { accountId: Number(accountId) }),
      },
      include: { account: true },
    });
    res.json(mapping);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Account mapping not found' });
    console.error(error);
    res.status(500).json({ error: 'Failed to update account mapping' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.accountMapping.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Account mapping not found' });
    console.error(error);
    res.status(500).json({ error: 'Failed to delete account mapping' });
  }
});

module.exports = router;
