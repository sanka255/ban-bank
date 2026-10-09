const express = require('express');
const prisma = require('../prisma');
const router = express.Router();

router.get('/menus-test', async (req, res) => {
  try {
    const menus = await prisma.menu.findMany({ include: { items: true, rates: true } });
    res.json({ count: menus.length });
  } catch (e) {
    console.error('debug menus-test error', e && e.stack ? e.stack : e);
    res.status(500).json({ error: 'debug failed', detail: e && e.message ? e.message : String(e) });
  }
});

module.exports = router;
