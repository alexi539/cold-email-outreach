/**
 * Send test email from a specific account.
 * Usage: npx tsx scripts/send-test-from-account.ts [account-email] [to-email]
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { sendZoho } from "../src/services/zoho.js";

const ACCOUNT_EMAIL = process.argv[2] || "hanna.pavlenko@agentrain.vip";
const TO = process.argv[3] || "stelmakh539@gmail.com";

async function main() {
  const prisma = new PrismaClient();
  const account = await prisma.emailAccount.findFirst({
    where: { email: ACCOUNT_EMAIL },
  });
  if (!account) {
    throw new Error(`Account ${ACCOUNT_EMAIL} not found`);
  }
  if (account.accountType !== "zoho") {
    throw new Error(`Account ${ACCOUNT_EMAIL} is not Zoho (type: ${account.accountType})`);
  }

  const subject = "Test from Cold Email";
  const body = `Test email from ${ACCOUNT_EMAIL}`;

  await sendZoho(account, TO, subject, body);
  console.log("Sent to", TO, "from", ACCOUNT_EMAIL);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
