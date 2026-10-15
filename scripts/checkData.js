const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const menus = await prisma.menu.findMany({ include: { items: { include: { item: true } } } });
  console.log('Menus:', JSON.stringify(menus, null, 2));
  
  const ratePlans = await prisma.menuRatePlan.findMany({ include: { rates: true } });
  console.log('Rate Plans:', JSON.stringify(ratePlans, null, 2));
  
  const categories = await prisma.menuCategory.findMany();
  console.log('Categories:', JSON.stringify(categories, null, 2));
  
  const items = await prisma.menuItem.findMany();
  console.log('Items:', JSON.stringify(items, null, 2));
}

check().finally(() => prisma.$disconnect());