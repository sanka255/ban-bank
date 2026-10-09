require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const updated = await prisma.banquetDateSlot.update({
    where: { id: 1 },
    data: { status: 'cancelled' },
  });
  console.log(JSON.stringify({ slotId: updated.id, newStatus: updated.status }));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
