const { PrismaClient } = require('@prisma/client');
const { resolveMenuRateForDate } = require('../src/services/menuSelectionService');

const prisma = new PrismaClient();

async function testAPIResponse() {
  console.log('=== Testing API Response for menus?availableOn=2026-10-13 ===\n');

  const availableOn = '2026-10-13';
  
  const menus = await prisma.menu.findMany({
    where: { isActive: true },
    include: {
      items: { include: { item: { include: { category: true } } } },
      rates: { include: { ratePlan: true } },
    },
    orderBy: { name: 'asc' },
  });

  const list = await Promise.all(menus.map(async (menu) => {
    const rate = await resolveMenuRateForDate({
      menuId: menu.id,
      eventDate: availableOn,
      findRate: async ({ menuId, eventDate }) => prisma.menuRate.findFirst({
        where: {
          menuId,
          ratePlan: {
            isActive: true,
            fromDate: { lte: new Date(`${eventDate}T00:00:00.000Z`) },
            toDate: { gte: new Date(`${eventDate}T00:00:00.000Z`) },
          },
        },
        include: { ratePlan: true },
      }),
    });

    if (rate) {
      return {
        id: menu.id,
        name: menu.name,
        rate: Number(rate.charge),
        ratePlanId: rate.ratePlanId,
      };
    }

    return {
      id: menu.id,
      name: menu.name,
      rate: null,
      ratePlanId: null,
      reason: 'No rate plan for this date',
    };
  }));

  console.log('API Response:');
  console.log(JSON.stringify(list, null, 2));

  const actionableMenus = list.filter((menu) => menu?.rate != null);
  console.log('\nActionable menus (rate != null):');
  console.log(JSON.stringify(actionableMenus, null, 2));
}

testAPIResponse().finally(() => prisma.$disconnect());