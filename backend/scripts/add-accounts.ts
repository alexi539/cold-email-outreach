/**
 * Add Zoho accounts in batch.
 * Usage: npx tsx scripts/add-accounts.ts
 * Edit the ACCOUNTS array below with your accounts.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { encrypt } from "../src/lib/encryption.js";

const ACCOUNTS = [
  // { email: "user@domain.com", smtpPassword: "app-password", displayName: "Name", zohoProServers: true },
];

async function main() {
  const prisma = new PrismaClient();
  for (const acc of ACCOUNTS) {
    const existing = await prisma.emailAccount.findUnique({ where: { email: acc.email } });
    if (existing) {
      console.log("Already exists:", acc.email);
      continue;
    }
    await prisma.emailAccount.create({
      data: {
        email: acc.email.toLowerCase(),
        displayName: acc.displayName || null,
        accountType: "zoho",
        dailyLimit: 100,
        smtpPasswordEncrypted: encrypt(acc.smtpPassword),
        zohoProServers: acc.zohoProServers ?? true,
      },
    });
    console.log("Added:", acc.email);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
