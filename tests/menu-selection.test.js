const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveMenuRateForDate,
  buildSlotMenuSummary,
  checkMenuAlreadyAttached,
} = require('../src/services/menuSelectionService');

test('resolveMenuRateForDate returns the active rate plan rate for the event date', async () => {
  const ratePlan = { id: 8, isActive: true, fromDate: new Date('2026-10-01T00:00:00Z'), toDate: new Date('2026-10-31T00:00:00Z') };
  const rate = await resolveMenuRateForDate({
    menuId: 5,
    eventDate: '2026-10-15',
    findRate: async () => ({ id: 101, menuId: 5, ratePlanId: 8, charge: 4500, ratePlan }),
  });

  assert.equal(rate.charge, 4500);
  assert.equal(rate.ratePlanId, 8);
});

test('buildSlotMenuSummary sums hall, menu and item charges', () => {
  const summary = buildSlotMenuSummary({
    slotCharge: 1000,
    requestedMenuItems: [{ charge: 500 }, { charge: 300 }],
    requestedItems: [{ charge: 200 }, { charge: 150 }],
  });

  assert.equal(summary.itemsTotal, 350);
  assert.equal(summary.menusTotal, 800);
  assert.equal(summary.grandTotal, 2150);
});

test('checkMenuAlreadyAttached rejects duplicate menu on the same slot', () => {
  const conflict = checkMenuAlreadyAttached({
    existingMenuItems: [{ menuId: 22 }, { menuId: 21 }],
    menuId: 22,
  });

  assert.equal(conflict, true);
});
