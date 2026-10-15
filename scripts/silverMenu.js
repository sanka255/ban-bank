const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const legacyMenu = await prisma.menu.findFirst({
    where: { name: 'Today Special Menu' },
  });

  if (legacyMenu) {
    await prisma.menu.update({
      where: { id: legacyMenu.id },
      data: { name: 'Silver Menu' },
    });
  }

  let menu = await prisma.menu.findFirst({
    where: { name: 'Silver Menu' },
  });

  if (!menu) {
    menu = await prisma.menu.create({
      data: { name: 'Silver Menu', isActive: true },
    });
  }

  const fromDate = new Date(today);
  fromDate.setUTCDate(today.getUTCDate() - 2);

  const toDate = new Date(today);
  toDate.setUTCDate(today.getUTCDate() + 7);

  let plan = await prisma.menuRatePlan.findFirst({
    where: { name: 'Silver Menu Date Range' },
  });

  if (!plan) {
    plan = await prisma.menuRatePlan.create({
      data: {
        name: 'Silver Menu Date Range',
        fromDate,
        toDate,
        isActive: true,
      },
    });
  }

  let rate = await prisma.menuRate.findFirst({
    where: { menuId: menu.id, ratePlanId: plan.id },
  });

  if (!rate) {
    rate = await prisma.menuRate.create({
      data: {
        menuId: menu.id,
        ratePlanId: plan.id,
        charge: 1800,
      },
    });
  }

  console.log(JSON.stringify({
    ok: true,
    menu: {
      id: menu.id,
      name: menu.name,
    },
    ratePlan: {
      id: plan.id,
      name: plan.name,
      fromDate: plan.fromDate.toISOString().slice(0, 10),
      toDate: plan.toDate.toISOString().slice(0, 10),
    },
    rate: {
      id: rate.id,
      charge: Number(rate.charge),
    },
    today: today.toISOString().slice(0, 10),
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
