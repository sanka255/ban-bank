const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const fromDate = new Date(today);
  fromDate.setUTCDate(today.getUTCDate() - 2);

  const toDate = new Date(today);
  toDate.setUTCDate(today.getUTCDate() + 7);

  const menuName = 'QA Current Date Range Menu';
  const planName = 'QA Current Date Range';

  let menu = await prisma.menu.findFirst({
    where: { name: menuName, isActive: true },
  });

  if (!menu) {
    menu = await prisma.menu.create({
      data: { name: menuName, isActive: true },
    });
  }

  let plan = await prisma.menuRatePlan.findFirst({
    where: { name: planName, isActive: true },
  });

  if (!plan) {
    plan = await prisma.menuRatePlan.create({
      data: {
        name: planName,
        fromDate,
        toDate,
        isActive: true,
      },
    });
  }

  let rate = await prisma.menuRate.findFirst({
    where: { ratePlanId: plan.id, menuId: menu.id },
  });

  if (!rate) {
    rate = await prisma.menuRate.create({
      data: {
        ratePlanId: plan.id,
        menuId: menu.id,
        charge: 1850,
      },
    });
  }

  console.log(JSON.stringify({
    ok: true,
    menu: { id: menu.id, name: menu.name },
    ratePlan: {
      id: plan.id,
      name: plan.name,
      fromDate: plan.fromDate.toISOString().slice(0, 10),
      toDate: plan.toDate.toISOString().slice(0, 10),
    },
    menuRate: {
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
