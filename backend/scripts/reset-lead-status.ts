/**
 * Reset lead status from "replied" back to "sent" (or "pending" if no emails sent).
 * Usage: npx tsx scripts/reset-lead-status.ts [email] [campaignId?]
 * Example: npx tsx scripts/reset-lead-status.ts patril03051974@gmail.com
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const email = process.argv[2]?.toLowerCase();
const campaignId = process.argv[3];

if (!email) {
  console.error("Usage: npx tsx scripts/reset-lead-status.ts <email> [campaignId]");
  process.exit(1);
}

async function main() {
  const prisma = new PrismaClient();
  const where = campaignId
    ? { email, campaignId, status: "replied" }
    : { email, status: "replied" };
  const leads = await prisma.lead.findMany({ where });
  if (!leads.length) {
    console.log("No leads found with status 'replied' for", email);
    await prisma.$disconnect();
    return;
  }
  for (const lead of leads) {
    const sentCount = await prisma.sentEmail.count({ where: { leadId: lead.id } });
    const newStatus = sentCount > 0 ? "sent" : "pending";
    await prisma.lead.update({ where: { id: lead.id }, data: { status: newStatus } });
    await prisma.sentEmail.updateMany({ where: { leadId: lead.id, status: "replied" }, data: { status: "sent" } });
    console.log("Reset", lead.email, "in campaign", lead.campaignId, "to", newStatus);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
