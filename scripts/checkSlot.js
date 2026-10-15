const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  const slot = await prisma.banquetDateSlot.findFirst({
    where: { status: 'active' },
    include: { reservation: true, partition: true },
  });
  console.log('Sample slot:', JSON.stringify(slot, null, 2));
}

test().finally(() => prisma.$disconnect());