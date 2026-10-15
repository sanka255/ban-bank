const express = require('express');
const prisma  = require('../prisma');
const { requireAdmin, requireAdminOrFrontOffice } = require('../middleware/auth');
const {
  calculateExtraChargeAmounts,
  validateExtraChargePayload,
  buildExtraChargeSummary,
} = require('../services/extraChargeService');
const {
  listExtraChargeItems,
  searchExtraChargeItems,
  createExtraChargeItem,
  updateExtraChargeItem,
  deleteExtraChargeItem,
} = require('../services/extraChargeCatalogService');

const router = express.Router({ mergeParams: true });

function resolveReservationId(req = {}) {
  const candidates = [
    req?.params?.reservationId,
    req?.params?.id,
    req?.query?.reservationId,
    req?.body?.reservationId,
  ];

  for (const value of candidates) {
    if (value == null || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function getReservationId(req) {
  return resolveReservationId(req);
}

function getDateSlotId(req) {
  if (req.params.dateSlotId != null) return Number(req.params.dateSlotId);
  if (req.params.id != null && req.originalUrl.includes('/date-slots/')) return Number(req.params.id);
  if (req.query.dateSlotId != null) return Number(req.query.dateSlotId);
  return null;
}

router.get('/', requireAdminOrFrontOffice, async (req, res) => {
  try {
    if (req.originalUrl.includes('/extra-charge-items')) {
      if (!req.user || !['admin', 'manager'].includes(req.user.role?.toLowerCase())) {
        return res.status(403).json({ error: 'Admin access required.' });
      }

      const items = await listExtraChargeItems({
        includeInactive: req.query.active === 'false' || req.query.includeInactive === 'true',
        active: req.query.active != null ? req.query.active === 'true' : null,
        search: req.query.q || req.query.search || '',
        type: req.query.type || '',
        limit: req.query.limit || 50,
      });
      return res.json(items);
    }

    const reservationId = getReservationId(req);
    const dateSlotId = getDateSlotId(req);
    const where = {};
    if (reservationId) where.reservationId = reservationId;
    if (dateSlotId) where.dateSlotId = dateSlotId;

    const extras = await prisma.extraCharge.findMany({
      where,
      include: { dateSlot: true },
      orderBy: { createdAt: 'asc' },
    });

    return res.json({
      extras,
      totals: buildExtraChargeSummary(extras),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch extra charges' });
  }
});

router.post('/', requireAdminOrFrontOffice, async (req, res) => {
  try {
    if (req.originalUrl.includes('/extra-charge-items')) {
      if (!req.user || !['admin', 'manager'].includes(req.user.role?.toLowerCase())) {
        return res.status(403).json({ error: 'Admin access required.' });
      }

      try {
        const item = await createExtraChargeItem(req.body, req.user.id);
        return res.status(201).json(item);
      } catch (err) {
        return res.status(400).json({ error: err.message || 'Failed to create extra charge item.' });
      }
    }

    const reservationId = getReservationId(req);
    const dateSlotId = getDateSlotId(req);
    const payload = { ...req.body };

    if (!reservationId) {
      return res.status(400).json({ error: 'reservationId is required.' });
    }

    const idemKey = (req.headers['idempotency-key'] || payload.idempotencyKey || '').toString().trim();
    if (idemKey) {
      const existing = await prisma.extraCharge.findFirst({
        where: { idempotencyKey: idemKey, reservationId },
      });
      if (existing) {
        return res.status(200).json(existing);
      }
    }

    const validation = validateExtraChargePayload(payload);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const reservation = await prisma.banquetReservation.findUnique({
      where: { id: reservationId },
      include: { dateSlots: true },
    });
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    if (reservation.status === 'cancelled') {
      return res.status(409).json({ error: 'Extra charges cannot be added to a cancelled reservation.' });
    }

    const row = calculateExtraChargeAmounts({
      unitPrice: Number(payload.unitPrice || 0),
      quantity: Number(payload.quantity || 1),
      taxRate: Number(payload.taxRate || 0),
      isComplementary: Boolean(payload.isComplementary),
    });

    const created = await prisma.extraCharge.create({
      data: {
        reservationId,
        dateSlotId: dateSlotId || null,
        catalogueItemId: payload.catalogueItemId ? Number(payload.catalogueItemId) : null,
        chargeType: (payload.chargeType || payload.category || 'miscellaneous').toLowerCase(),
        category: payload.category || (payload.chargeType || 'miscellaneous').toLowerCase(),
        description: String(payload.description).trim(),
        quantity: Number(payload.quantity || 1),
        unitPrice: row.unitPrice,
        charge: row.charge,
        taxAmount: row.taxAmount,
        chargeWithTax: row.chargeWithTax,
        reason: payload.reason ? String(payload.reason).trim() : null,
        explanation: payload.explanation ? String(payload.explanation).trim() : null,
        isComplementary: Boolean(payload.isComplementary),
        status: 'active',
        createdBy: req.user.id,
        idempotencyKey: idemKey || null,
      },
    });

    return res.status(201).json(created);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create extra charge' });
  }
});

router.put('/:id', requireAdminOrFrontOffice, async (req, res) => {
  try {
    if (req.originalUrl.includes('/extra-charge-items')) {
      if (!req.user || !['admin', 'manager'].includes(req.user.role?.toLowerCase())) {
        return res.status(403).json({ error: 'Admin access required.' });
      }

      try {
        const item = await updateExtraChargeItem(req.params.id, req.body, req.user.id);
        return res.json(item);
      } catch (err) {
        return res.status(404).json({ error: err.message || 'Extra charge item not found.' });
      }
    }

    const extraId = Number(req.params.id);
    const existing = await prisma.extraCharge.findUnique({ where: { id: extraId } });
    if (!existing) return res.status(404).json({ error: 'Extra charge not found' });
    if (existing.billLineId != null || existing.status === 'voided') {
      return res.status(409).json({ error: 'Only unbilled, active extras can be edited.' });
    }

    const nextPayload = {
      ...(req.body.chargeType && { chargeType: String(req.body.chargeType).toLowerCase() }),
      ...(req.body.description != null && { description: String(req.body.description).trim() }),
      ...(req.body.unitPrice != null && { unitPrice: Number(req.body.unitPrice) }),
      ...(req.body.quantity != null && { quantity: Number(req.body.quantity) }),
      ...(req.body.reason != null && { reason: String(req.body.reason).trim() }),
      ...(req.body.explanation != null && { explanation: String(req.body.explanation).trim() }),
      ...(req.body.isComplementary != null && { isComplementary: Boolean(req.body.isComplementary) }),
    };

    const validation = validateExtraChargePayload({
      ...existing,
      ...nextPayload,
    });

    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const row = calculateExtraChargeAmounts({
      unitPrice: nextPayload.unitPrice ?? Number(existing.unitPrice),
      quantity: nextPayload.quantity ?? Number(existing.quantity),
      taxRate: 0,
      isComplementary: nextPayload.isComplementary ?? Boolean(existing.isComplementary),
    });

    const updated = await prisma.extraCharge.update({
      where: { id: extraId },
      data: {
        ...nextPayload,
        charge: row.charge,
        taxAmount: row.taxAmount,
        chargeWithTax: row.chargeWithTax,
      },
    });

    return res.json(updated);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Extra charge item not found' });
    console.error(e);
    res.status(500).json({ error: 'Failed to update extra charge' });
  }
});

router.post('/:extraId/void', requireAdminOrFrontOffice, async (req, res) => {
  try {
    const extraId = Number(req.params.extraId);
    const reason = String(req.body.reason || '').trim();
    if (!reason) {
      return res.status(400).json({ error: 'Void reason is required.' });
    }

    const existing = await prisma.extraCharge.findUnique({ where: { id: extraId } });
    if (!existing) return res.status(404).json({ error: 'Extra charge not found' });

    const voided = await prisma.extraCharge.update({
      where: { id: extraId },
      data: {
        status: 'voided',
        voidReason: reason,
        voidedBy: req.user.id,
        voidedAt: new Date(),
      },
    });

    res.json({
      message: 'Extra charge voided successfully.',
      extra: voided,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to void extra charge' });
  }
});

router.patch('/:id/active', requireAdmin, async (req, res) => {
  try {
    if (!req.originalUrl.includes('/extra-charge-items')) {
      return res.status(404).json({ error: 'Route not found.' });
    }

    const item = await updateExtraChargeItem(req.params.id, { isActive: Boolean(req.body.isActive) }, req.user.id);
    return res.json(item);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Unable to update item active state.' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    if (!req.originalUrl.includes('/extra-charge-items')) {
      return res.status(404).json({ error: 'Route not found.' });
    }

    const item = await deleteExtraChargeItem(req.params.id);
    return res.json({ message: 'Extra charge item removed successfully.', item });
  } catch (err) {
    return res.status(404).json({ error: err.message || 'Extra charge item not found.' });
  }
});

router.get('/search', requireAdmin, async (req, res) => {
  try {
    const items = await searchExtraChargeItems(req.query.search || '', req.query.includeInactive === 'true', req.query.type || '');
    return res.json(items);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to search extra charge items.' });
  }
});

module.exports = router;
module.exports.resolveReservationId = resolveReservationId;
module.exports.router = router;
