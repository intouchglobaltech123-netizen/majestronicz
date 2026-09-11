import { PrismaClient } from '@prisma/client';
import { reseedDatabase } from '../src/services/reseed.service.js';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database with demo dataset...');
  await reseedDatabase();
  const counts = {
    items: await prisma.item.count(),
    branchStocks: await prisma.branchStock.count(),
    invoices: await prisma.invoice.count(),
    customers: await prisma.customer.count(),
    employees: await prisma.employee.count(),
    purchaseOrders: await prisma.purchaseOrder.count(),
  };
  console.log('Seed complete:', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
