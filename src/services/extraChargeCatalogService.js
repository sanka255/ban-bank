const prisma = require('../prisma');

const MEMORY_STORE_KEY = '__extraChargeCatalogStore__';

function getMemoryStore() {
  if (!globalThis[MEMORY_STORE_KEY]) {
    globalThis[MEMORY_STORE_KEY] = [];
  }
  return globalThis[MEMORY_STORE_KEY];
}

function normalizeItemPayload(item = {}) {
  return {
    code: String(item.code || item.name || `EX-${Date.now()}`).trim(),
    name: String(item.name || '').trim(),
    chargeType: String(item.chargeType || 'miscellaneous').toLowerCase(),
    unitLabel: String(item.unitLabel || 'each').trim(),
    defaultPrice: Number(item.defaultPrice ?? 0),
    taxClassId: item.taxClassId == null ? null : Number(item.taxClassId),
    accountId: item.accountId == null ? null : Number(item.accountId),
    allowPriceOverride: Boolean(item.allowPriceOverride),
    allowComplementary: Boolean(item.allowComplementary),
    isQuickPick: Boolean(item.isQuickPick),
    sortOrder: Number(item.sortOrder ?? 0),
    isActive: item.isActive !== false,
    createdBy: Number(item.createdBy ?? 1),
    updatedBy: item.updatedBy == null ? null : Number(item.updatedBy),
  };
}

function applyMemoryFilter(items, { includeInactive = false, search = '', type = '', active = null } = {}) {
  let nextItems = [...items];

  if (active !== null) {
    nextItems = nextItems.filter((item) => item.isActive === Boolean(active));
  } else if (!includeInactive) {
    nextItems = nextItems.filter((item) => item.isActive !== false);
  }

  if (type) {
    nextItems = nextItems.filter((item) => String(item.chargeType || '').toLowerCase() === String(type).toLowerCase());
  }

  const keyword = String(search || '').trim().toLowerCase();
  if (keyword) {
    nextItems = nextItems.filter((item) => {
      const haystack = [item.code, item.name, item.chargeType, item.unitLabel].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }

  return nextItems.sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name)));
}

function isCatalogModelAvailable() {
  return !!(prisma && prisma.extraChargeItem);
}

function shouldUseMemoryFallback() {
  const url = String(process.env.DATABASE_URL || '');
  return !isCatalogModelAvailable() || !url || url.startsWith('prisma://');
}

async function listExtraChargeItems({ includeInactive = false, search = '', type = '', active = null, limit = 50 } = {}) {
  if (shouldUseMemoryFallback()) {
    const items = applyMemoryFilter(getMemoryStore(), { includeInactive, search, type, active });
    return items.slice(0, Number(limit || 50));
  }

  try {
    const where = {};
    if (active !== null) {
      where.isActive = Boolean(active);
    } else if (!includeInactive) {
      where.isActive = true;
    }
    if (type) {
      where.chargeType = String(type).toLowerCase();
    }
    const keyword = String(search || '').trim();
    if (keyword) {
      where.OR = [
        { code: { contains: keyword } },
        { name: { contains: keyword } },
      ];
    }

    return await prisma.extraChargeItem.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: Number(limit || 50),
    });
  } catch (error) {
    const items = applyMemoryFilter(getMemoryStore(), { includeInactive, search, type, active });
    return items.slice(0, Number(limit || 50));
  }
}

async function searchExtraChargeItems(search = '', includeInactive = false, type = '') {
  return listExtraChargeItems({ includeInactive, search, type, limit: 50 });
}

async function createExtraChargeItem(payload = {}, actorId = 1) {
  const item = normalizeItemPayload({ ...payload, createdBy: payload.createdBy ?? actorId });
  if (!item.code) throw new Error('Item code is required.');
  if (!item.name) throw new Error('Item name is required.');
  if (!item.chargeType) throw new Error('chargeType is required.');
  if (Number(item.defaultPrice) < 0) throw new Error('defaultPrice must be >= 0.');

  const stored = { ...item, id: Date.now() + Math.floor(Math.random() * 1000) };

  if (shouldUseMemoryFallback()) {
    const store = getMemoryStore();
    const existingIndex = store.findIndex((candidate) => String(candidate.code).toLowerCase() === String(item.code).toLowerCase());
    if (existingIndex >= 0) {
      const updated = { ...store[existingIndex], ...stored, id: store[existingIndex].id };
      store[existingIndex] = updated;
      return { ...updated };
    }
    store.push(stored);
    return { ...stored };
  }

  try {
    const existing = await prisma.extraChargeItem.findUnique({ where: { code: item.code } });
    if (existing) {
      return await prisma.extraChargeItem.update({
        where: { id: existing.id },
        data: {
          name: item.name,
          chargeType: item.chargeType,
          unitLabel: item.unitLabel,
          defaultPrice: item.defaultPrice,
          taxClassId: item.taxClassId,
          accountId: item.accountId,
          allowPriceOverride: item.allowPriceOverride,
          allowComplementary: item.allowComplementary,
          isQuickPick: item.isQuickPick,
          sortOrder: item.sortOrder,
          isActive: item.isActive,
          updatedBy: item.updatedBy,
        },
      });
    }

    return await prisma.extraChargeItem.create({
      data: {
        code: item.code,
        name: item.name,
        chargeType: item.chargeType,
        unitLabel: item.unitLabel,
        defaultPrice: item.defaultPrice,
        taxClassId: item.taxClassId,
        accountId: item.accountId,
        allowPriceOverride: item.allowPriceOverride,
        allowComplementary: item.allowComplementary,
        isQuickPick: item.isQuickPick,
        sortOrder: item.sortOrder,
        isActive: item.isActive,
        createdBy: item.createdBy,
        updatedBy: item.updatedBy,
      },
    });
  } catch (error) {
    const store = getMemoryStore();
    const existingIndex = store.findIndex((candidate) => String(candidate.code).toLowerCase() === String(item.code).toLowerCase());
    if (existingIndex >= 0) {
      const updated = { ...store[existingIndex], ...stored, id: store[existingIndex].id };
      store[existingIndex] = updated;
      return { ...updated };
    }
    store.push(stored);
    return { ...stored };
  }
}

async function updateExtraChargeItem(id, data = {}, actorId = 1) {
  const itemId = Number(id);
  if (shouldUseMemoryFallback()) {
    const store = getMemoryStore();
    const index = store.findIndex((item) => Number(item.id) === itemId);
    if (index === -1) throw new Error('Extra charge item not found.');
    const current = store[index];
    const next = normalizeItemPayload({ ...current, ...data, updatedBy: actorId });
    if (Number(next.defaultPrice) < 0) throw new Error('defaultPrice must be >= 0.');
    store[index] = { ...current, ...next, id: current.id };
    return { ...store[index] };
  }

  try {
    const existing = await prisma.extraChargeItem.findUnique({ where: { id: itemId } });
    if (!existing) throw new Error('Extra charge item not found.');
    const update = { ...data, updatedBy: actorId };
    if (update.defaultPrice != null && Number(update.defaultPrice) < 0) throw new Error('defaultPrice must be >= 0.');
    if (update.code != null && String(update.code).trim() === '') throw new Error('Item code is required.');
    return await prisma.extraChargeItem.update({ where: { id: itemId }, data: update });
  } catch (error) {
    if (error?.code === 'P2002') throw new Error('Extra charge code already exists.');
    const store = getMemoryStore();
    const index = store.findIndex((item) => Number(item.id) === itemId);
    if (index === -1) throw new Error('Extra charge item not found.');
    const current = store[index];
    const next = normalizeItemPayload({ ...current, ...data, updatedBy: actorId });
    store[index] = { ...current, ...next, id: current.id };
    return { ...store[index] };
  }
}

async function deleteExtraChargeItem(id) {
  const itemId = Number(id);
  return updateExtraChargeItem(itemId, { isActive: false }, 1);
}

module.exports = {
  listExtraChargeItems,
  searchExtraChargeItems,
  createExtraChargeItem,
  updateExtraChargeItem,
  deleteExtraChargeItem,
};
