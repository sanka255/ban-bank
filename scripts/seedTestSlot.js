require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Create minimal guest + reservation required by FK constraints
  const guest = await prisma.banquetGuest.create({
    data: { firstName: 'Test', lastName: 'Guest', phone: '0000000' },
  });

  const reservation = await prisma.banquetReservation.create({
    data: {
      reservationCode: 'BQ-TEST-001',
      guestId: guest.id,
      numberOfGuests: 50,
      createdBy: 1,
      status: 'guaranteed',
    },
  });

  // The key test slot: partition 1, 2026-10-01, 09:00–12:00, ACTIVE
  const slot = await prisma.banquetDateSlot.create({
    data: {
      reservationId: reservation.id,
      partitionId: 1,
      fromDate: new Date('2026-10-01T00:00:00.000Z'),
      toDate:   new Date('2026-10-01T00:00:00.000Z'),
      fromTime: new Date('1970-01-01T09:00:00.000Z'),
      toTime:   new Date('1970-01-01T12:00:00.000Z'),
      charge: 50000,
      status: 'active',
    },
  });

  console.log(JSON.stringify({ slotId: slot.id, status: slot.status, partitionId: slot.partitionId }));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
