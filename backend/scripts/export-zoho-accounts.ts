/**
 * Export Zoho accounts to JSON for import to another environment.
 * Usage: DATABASE_URL="file:./prisma/dev.db" npx tsx scripts/export-zoho-accounts.ts > zoho-accounts.json
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  const accounts = await prisma.emailAccount.findMany({
    where: { accountType: "zoho" },
  });
  console.log(JSON.stringify(accounts));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
