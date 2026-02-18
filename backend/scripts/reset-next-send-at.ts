/**
 * Reset nextSendAt to now for pending leads in a campaign.
 * Usage: npx tsx scripts/reset-next-send-at.ts <campaignId>
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { humanLikeThrottleSeconds } from "../src/lib/throttle.js";

const campaignId = process.argv[2];
if (!campaignId) {
  console.error("Usage: npx tsx scripts/reset-next-send-at.ts <campaignId>");
  process.exit(1);
}

async function main() {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { campaignAccounts: true, sequence: true },
  });
  if (!campaign) {
    console.error("Campaign not found");
    process.exit(1);
  }

  const pending = await prisma.lead.findMany({
    where: { campaignId, status: "pending" },
    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
  });
  if (!pending.length) {
    console.log("No pending leads");
    process.exit(0);
  }

  const accountIds = campaign.campaignAccounts.map((ca) => ca.accountId);
  const throttleMin = campaign.sequence?.throttleMinMinutes ?? 2;
  const throttleMax = campaign.sequence?.throttleMaxMinutes ?? 5;

  const now = new Date();
  const offsetByAccount = new Map<string, number>();

  for (const lead of pending) {
    const accountId = lead.assignedAccountId || accountIds[0];
    const offsetMs = offsetByAccount.get(accountId) ?? 0;
    const nextSendAt = new Date(now.getTime() + offsetMs);

    const randomSeconds = humanLikeThrottleSeconds(throttleMin, throttleMax);
    offsetByAccount.set(accountId, offsetMs + randomSeconds * 1000);

    await prisma.lead.update({
      where: { id: lead.id },
      data: { nextSendAt },
    });
  }

  console.log(`Reset nextSendAt for ${pending.length} pending leads`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
