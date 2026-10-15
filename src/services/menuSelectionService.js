function resolveMenuRateForDate({ menuId, eventDate, findRate }) {
  return findRate({ menuId, eventDate });
}

function buildSlotMenuSummary({ slotCharge = 0, requestedMenuItems = [], requestedItems = [] }) {
  const itemsTotal = requestedItems.reduce((sum, item) => sum + Number(item.charge || 0), 0);
  const menusTotal = requestedMenuItems.reduce((sum, item) => sum + Number(item.charge || 0), 0);
  const hallCharge = Number(slotCharge || 0);

  return {
    hallCharge,
    itemsTotal,
    menusTotal,
    grandTotal: hallCharge + itemsTotal + menusTotal,
  };
}

function checkMenuAlreadyAttached({ existingMenuItems = [], menuId }) {
  return existingMenuItems.some((item) => Number(item.menuId) === Number(menuId));
}

module.exports = {
  resolveMenuRateForDate,
  buildSlotMenuSummary,
  checkMenuAlreadyAttached,
};
