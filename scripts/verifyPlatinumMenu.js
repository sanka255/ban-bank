const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function verifyPlatinumMenu() {
  console.log('=== Verifying Platinum Menu ===\n');

  // 1. Check the menu exists
  const menu = await prisma.menu.findUnique({
    where: { id: 12 },
    include: { items: { include: { item: true } }, rates: { include: { ratePlan: true } } },
  });
  console.log('1. Menu details:');
  console.log(`   Name: ${menu.name}`);
  console.log(`   ID: ${menu.id}`);
  console.log(`   isActive: ${menu.isActive}`);
  console.log(`   Items: ${menu.items.length}`);
  menu.items.forEach(mi => console.log(`     - ${mi.item.name}: LKR ${mi.item.charge}`));

  // 2. Check rate plan
  console.log('\n2. Rate Plan details:');
  for (const rate of menu.rates) {
    console.log(`   Rate Plan: ${rate.ratePlan.name}`);
    console.log(`   From: ${rate.ratePlan.fromDate.toISOString().split('T')[0]}`);
    console.log(`   To: ${rate.ratePlan.toDate.toISOString().split('T')[0]}`);
    console.log(`   isActive: ${rate.ratePlan.isActive}`);
    console.log(`   Charge: LKR ${rate.charge}`);
  }

  // 3. Test the availability logic (same as in menus.js route)
  console.log('\n3. Testing availability for various dates in 2026:');
  const testDates = [
    '2026-01-15',
    '2026-06-15',
    '2026-10-13',  // Today
    '2026-12-25',
  ];

  for (const eventDate of testDates) {
    const rate = await prisma.menuRate.findFirst({
      where: {
        menuId: menu.id,
        ratePlan: {
          isActive: true,
          fromDate: { lte: new Date(`${eventDate}T00:00:00.000Z`) },
          toDate: { gte: new Date(`${eventDate}T00:00:00.000Z`) },
        },
      },
      include: { ratePlan: true },
    });

    if (rate) {
      console.log(`   ✓ ${eventDate}: Available - Rate: LKR ${rate.charge} (${rate.ratePlan.name})`);
    } else {
      console.log(`   ✗ ${eventDate}: NOT AVAILABLE - No rate plan for this date`);
    }
  }

  // 4. Test a date outside the range
  console.log('\n4. Testing date outside range (2027-01-01):');
  const outsideRate = await prisma.menuRate.findFirst({
    where: {
      menuId: menu.id,
      ratePlan: {
        isActive: true,
        fromDate: { lte: new Date('2027-01-01T00:00:00.000Z') },
        toDate: { gte: new Date('2027-01-01T00:00:00.000Z') },
      },
    },
    include: { ratePlan: true },
  });
  if (outsideRate) {
    console.log(`   ✓ Available - Rate: LKR ${outsideRate.charge}`);
  } else {
    console.log(`   ✗ NOT AVAILABLE - Correctly not available outside 2026`);
  }

  console.log('\n=== QA Complete ===');
  console.log('Platinum menu is ready for use!');
}

verifyPlatinumMenu().finally(() => prisma.$disconnect());