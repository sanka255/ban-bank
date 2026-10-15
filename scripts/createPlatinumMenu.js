const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function toDateValue(dateString) {
  return new Date(dateString);
}

async function createPlatinumMenu() {
  console.log('Creating Platinum menu...');

  // Create a menu category for Platinum items
  const category = await prisma.menuCategory.create({
    data: { name: 'Platinum Selection' },
  });

  // Create Platinum menu items
  const items = [
    { name: 'Lobster Thermidor', charge: 4500 },
    { name: 'Wagyu Beef Tenderloin', charge: 6800 },
    { name: 'Pan-Seared Foie Gras', charge: 3200 },
    { name: 'Truffle Risotto', charge: 2800 },
    { name: 'Champagne Sorbet', charge: 1500 },
  ];

  const createdItems = [];
  for (const itemData of items) {
    const item = await prisma.menuItem.create({
      data: {
        name: itemData.name,
        categoryId: category.id,
        charge: itemData.charge,
        accountNo: '4200-20',
        isActive: true,
      },
    });
    createdItems.push(item);
  }

  // Create Platinum menu
  const menu = await prisma.menu.create({
    data: {
      name: 'Platinum',
      accountId: '5101',
      isActive: true,
    },
  });

  // Link items to Platinum menu
  for (const item of createdItems) {
    await prisma.menuToItem.create({
      data: { menuId: menu.id, itemId: item.id },
    });
  }

  // Create rate plan covering all of 2026
  const ratePlan = await prisma.menuRatePlan.create({
    data: {
      name: 'Platinum Banquet Rate 2026',
      fromDate: toDateValue('2026-01-01'),
      toDate: toDateValue('2026-12-31'),
      isActive: true,
    },
  });

  // Create menu rate for Platinum (premium pricing)
  await prisma.menuRate.create({
    data: {
      ratePlanId: ratePlan.id,
      menuId: menu.id,
      charge: 5500, // Premium per-person rate
    },
  });

  console.log('Platinum menu created successfully!');
  console.log({
    menuId: menu.id,
    menuName: menu.name,
    ratePlanId: ratePlan.id,
    ratePlanName: ratePlan.name,
    rate: 5500,
    items: createdItems.map(i => ({ name: i.name, charge: i.charge })),
  });
}

async function main() {
  try {
    await createPlatinumMenu();
  } catch (error) {
    console.error('Failed to create Platinum menu:', error.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();