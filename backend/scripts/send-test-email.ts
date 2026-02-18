/**
 * Send test email or follow-up (reply).
 * Usage:
 *   npx tsx scripts/send-test-email.ts [to-email]           - initial email
 *   npx tsx scripts/send-test-email.ts [to-email] followup   - follow-up as reply
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { sendZoho } from "../src/services/zoho.js";

const TO = process.argv[2] || "stelmakhalexi@gmail.com";
const IS_FOLLOWUP = process.argv[3] === "followup";

const ORIGINAL_MESSAGE_ID = "<7be1215b-9c7f-7195-66e3-456fac0e415a@agentrain.io>";

async function main() {
  const prisma = new PrismaClient();
  const account = await prisma.emailAccount.findFirst({
    where: { accountType: "zoho", email: "support@agentrain.io" },
  });
  if (!account) {
    throw new Error("Account support@agentrain.io not found");
  }

  if (IS_FOLLOWUP) {
    const subject = "Re: Quick follow-up";
    const body = `Hi,

Just bumping this up — wanted to make sure it didn't get lost in your inbox.

Happy to chat whenever works for you.

Best,
Alex`;

    await sendZoho(account, TO, subject, body, {
      inReplyTo: ORIGINAL_MESSAGE_ID,
      references: ORIGINAL_MESSAGE_ID,
    });
    console.log("Sent follow-up (reply) to", TO);
  } else {
    const subject = "Quick follow-up";
    const body = `Hi,

Just wanted to check in and see if you had a chance to look at my previous message.

Let me know if you have any questions.

Best,
Alex`;

    await sendZoho(account, TO, subject, body);
    console.log("Sent to", TO);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
