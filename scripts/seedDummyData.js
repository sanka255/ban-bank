const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function toDateValue(dateString) {
  return new Date(dateString);
}

async function seedDummyData() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to seed dummy data. Add it to your .env file or environment before running this script.');
  }

  console.log('Seeding dummy banquet data...');

  const lkr = await prisma.currency.upsert({
    where: { code: 'LKR' },
    update: {},
    create: { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs', isActive: true },
  });

  const usd = await prisma.currency.upsert({
    where: { code: 'USD' },
    update: {},
    create: { code: 'USD', name: 'US Dollar', symbol: '$', isActive: true },
  });

  await prisma.exchangeRate.upsert({
    where: {
      currencyId_effectiveDate: {
        currencyId: usd.id,
        effectiveDate: toDateValue('2026-10-01'),
      },
    },
    update: {},
    create: {
      currencyId: usd.id,
      rateToBase: 300.5,
      effectiveDate: toDateValue('2026-10-01'),
      createdBy: 1,
    },
  });

  const hall = await prisma.banquetHall.upsert({
    where: { legacyId: 1001 },
    update: {},
    create: {
      legacyId: 1001,
      name: 'Grand Ballroom',
      maxGuests: 300,
      isPartitioned: true,
    },
  });

  const partition = await prisma.hallPartition.upsert({
    where: { legacyId: 2001 },
    update: {},
    create: {
      legacyId: 2001,
      hallId: hall.id,
      name: 'Main Hall A',
      status: 'active',
      accountNo: '1100-100',
    },
  });

  const paxRange = await prisma.paxRange.upsert({
    where: { legacyId: 3001 },
    update: {},
    create: { legacyId: 3001, minGuests: 80, maxGuests: 160 },
  });

  await prisma.hallRate.upsert({
    where: { legacyId: 4001 },
    update: {},
    create: {
      legacyId: 4001,
      partitionId: partition.id,
      paxRangeId: paxRange.id,
      charge: 180000,
    },
  });

  const category = await prisma.menuCategory.upsert({
    where: { id: 1 },
    update: {},
    create: { name: 'Main Course' },
  });

  const menuItem = await prisma.menuItem.upsert({
    where: { id: 1 },
    update: {},
    create: {
      name: 'Chicken Biriyani',
      categoryId: category.id,
      charge: 2200,
      accountNo: '4200-10',
      isActive: true,
    },
  });

  const menu = await prisma.menu.upsert({
    where: { id: 1 },
    update: {},
    create: {
      name: 'Signature Banquet Menu',
      accountId: '5100',
      isActive: true,
    },
  });

  await prisma.menuToItem.upsert({
    where: { menuId_itemId: { menuId: menu.id, itemId: menuItem.id } },
    update: {},
    create: { menuId: menu.id, itemId: menuItem.id },
  });

  const ratePlan = await prisma.menuRatePlan.upsert({
    where: { id: 1 },
    update: {},
    create: {
      name: 'Standard Banquet Rate',
      fromDate: toDateValue('2026-01-01'),
      toDate: toDateValue('2026-12-31'),
      isActive: true,
    },
  });

  await prisma.menuRate.upsert({
    where: { ratePlanId_menuId: { ratePlanId: ratePlan.id, menuId: menu.id } },
    update: {},
    create: {
      ratePlanId: ratePlan.id,
      menuId: menu.id,
      charge: 3200,
    },
  });

  const guest = await prisma.banquetGuest.upsert({
    where: { legacyId: 9001 },
    update: {},
    create: {
      legacyId: 9001,
      title: 'Mr',
      firstName: 'John',
      lastName: 'Silva',
      phone: '+94771234567',
      email: 'john.silva@example.com',
      company: 'Lakeview Events',
      country: 'Sri Lanka',
    },
  });

  const reservation = await prisma.banquetReservation.upsert({
    where: { reservationCode: 'RES-1001' },
    update: {},
    create: {
      reservationCode: 'RES-1001',
      legacyReference: 'LEG-1001',
      guestId: guest.id,
      numberOfGuests: 120,
      discussedBy: 'Nimal',
      broughtBy: 'Sales Team',
      status: 'guaranteed',
      isComplementary: false,
      createdBy: 1,
      functionAccountId: null,
    },
  });

  const dateSlot = await prisma.banquetDateSlot.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      reservationId: reservation.id,
      partitionId: partition.id,
      fromDate: toDateValue('2026-11-05'),
      toDate: toDateValue('2026-11-05'),
      fromTime: new Date('1970-01-01T18:00:00Z'),
      toTime: new Date('1970-01-01T22:00:00Z'),
      charge: 250000,
      status: 'active',
    },
  });

  await prisma.requestedMenuItem.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      dateSlotId: dateSlot.id,
      menuId: menu.id,
      guestCount: 120,
      charge: 380000,
      isComplementary: false,
    },
  });

  await prisma.guestBillLine.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      reservationId: reservation.id,
      dateSlotId: dateSlot.id,
      billNo: 'BILL-1001',
      lineType: 'menu',
      description: 'Signature Banquet Menu',
      charge: 380000,
      taxAmount: 45600,
      chargeWithTax: 425600,
      fromPms: false,
      insertDate: toDateValue('2026-10-01'),
      userId: 1,
    },
  });

  await prisma.hallDeposit.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      reservationId: reservation.id,
      amount: 100000,
      paymentMethod: 'cash',
      currencyId: lkr.id,
      baseCurrencyAmount: 100000,
      exchangeRateUsed: 1,
      settled: true,
      receiptNo: 'REC-1001',
      remark: 'Dummy deposit',
    },
  });

  console.log('Dummy data inserted successfully.');
  console.log({ hallId: hall.id, partitionId: partition.id, reservationCode: reservation.reservationCode, guestId: guest.id });
}

async function main() {
  try {
    await seedDummyData();
  } catch (error) {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
