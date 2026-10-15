const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const stamp = Date.now().toString(36).toUpperCase();
  const reservationCode = `QA-MENU-SELECT-${stamp}`;

  // 1. Hall & Partition
  let hall = await prisma.banquetHall.findFirst({ where: { name: 'QA Hall Menu Select' } });
  if (!hall) {
    hall = await prisma.banquetHall.create({ data: { name: 'QA Hall Menu Select', maxGuests: 200 } });
  }

  let partition = await prisma.hallPartition.findFirst({ where: { hallId: hall.id, name: 'QA Partition Menu Select' } });
  if (!partition) {
    partition = await prisma.hallPartition.create({
      data: { hallId: hall.id, name: 'QA Partition Menu Select', status: 'active' },
    });
  }

  // 2. Guest
  const guest = await prisma.banquetGuest.create({
    data: {
      firstName: 'QA',
      lastName: 'Menu Select',
      email: `qa-menu-select-${stamp}@example.com`,
      phone: '0770000000',
    },
  });

  // 3. Reservation
  const reservation = await prisma.banquetReservation.create({
    data: {
      reservationCode,
      guestId: guest.id,
      numberOfGuests: 40,
      discussedBy: 'QA',
      createdBy: 2,
      status: 'tentative',
    },
  });

  // 4. Create date slot with hall charge 50000
  const slot = await prisma.banquetDateSlot.create({
    data: {
      reservationId: reservation.id,
      partitionId: partition.id,
      fromDate: new Date(today),
      toDate: new Date(today),
      fromTime: new Date('1970-01-01T09:00:00.000Z'),
      toTime: new Date('1970-01-01T12:00:00.000Z'),
      charge: 50000,
      status: 'active',
    },
  });

  console.log('Slot created:', slot.id);

  // 5. Add two extra charges
  await prisma.extraCharge.create({
    data: {
      dateSlotId: slot.id,
      reservationId: reservation.id,
      chargeType: 'miscellaneous',
      category: 'AV',
      description: 'Sound System Rental',
      quantity: 1,
      unitPrice: 8000,
      charge: 8000,
      isComplementary: false,
      createdBy: 2,
    },
  });

  await prisma.extraCharge.create({
    data: {
      dateSlotId: slot.id,
      reservationId: reservation.id,
      chargeType: 'miscellaneous',
      category: 'Decorations',
      description: 'Floral Arrangements',
      quantity: 1,
      unitPrice: 12000,
      charge: 12000,
      isComplementary: false,
      createdBy: 2,
    },
  });

  console.log('Two extra charges added');

  // 6. Attach menu
  const menu = await prisma.menu.findFirst({ where: { name: 'Signature Banquet Menu' } });
  const menuRate = await prisma.menuRate.findFirst({
    where: { menuId: menu.id, ratePlan: { isActive: true } },
  });

  await prisma.requestedMenuItem.create({
    data: {
      dateSlotId: slot.id,
      menuId: menu.id,
      guestCount: 40,
      charge: Number(menuRate.charge) * 40,
      isComplementary: false,
    },
  });

  console.log('Menu attached:', menu.name);

  // 7. Generate bill via API
  const loginRes = await fetch('http://localhost:4003/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'cashier', password: 'denna' }),
  });
  const login = await loginRes.json();

  const billRes = await fetch(`http://localhost:4003/api/banquet/date-slots/${slot.id}/generate-bill`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${login.token}`,
    },
  });
  const bill = await billRes.json();

  console.log('\n=== BILL GENERATED ===');
  console.log('Reservation:', reservation.reservationCode);
  console.log('Slot ID:', slot.id);
  console.log('\nBill Lines:');
  for (const line of bill.lines) {
    console.log(`  ${line.lineType}: ${line.description} | Base: ${line.charge} | Tax: ${line.taxAmount} | Total: ${line.chargeWithTax}`);
  }

  console.log('\n=== SUMMARY ===');
  console.log('Total Base Charge:', bill.summary.totalBaseCharge);
  console.log('Total Tax:', bill.summary.totalTax);
  console.log('Total With Tax:', bill.summary.totalWithTax);

  // 8. Get folio
  const folioRes = await fetch(`http://localhost:4003/api/banquet/reservations/${reservation.id}/folio`, {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  const folio = await folioRes.json();

  console.log('\n=== FOLIO ===');
  console.log('Reservation:', folio.reservation.reservationCode);
  console.log('Charge Breakdown:');
  for (const item of folio.summary.chargeBreakdown) {
    console.log(`  ${item.label}: Base ${item.base} | Tax ${item.tax} | Total ${item.total}`);
  }
  console.log('Total Base Charge:', folio.summary.totalBaseCharge);
  console.log('Total Tax:', folio.summary.totalTax);
  console.log('Total With Tax:', folio.summary.totalWithTax);
  console.log('Total Deposits:', folio.summary.totalDeposits);
  console.log('Total Received:', folio.summary.totalReceived);
  console.log('Outstanding Balance:', folio.summary.outstandingBalance);
  console.log('\n=== QA COMPLETE ===');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });