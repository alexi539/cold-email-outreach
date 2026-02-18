/**
 * Unassign leads from a blocked account and reassign them to other campaign accounts.
 * Usage: npx tsx scripts/reassign-leads-from-account.ts [account-email]
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const ACCOUNT_EMAIL = process.argv[2] || "hanna.pavlenko@agentrain.vip";

async function main() {
  const prisma = new PrismaClient();

  const account = await prisma.emailAccount.findFirst({
    where: { email: ACCOUNT_EMAIL },
  });
  if (!account) {
    throw new Error(`Account ${ACCOUNT_EMAIL} not found`);
  }

  const leads = await prisma.lead.findMany({
    where: { assignedAccountId: account.id },
    include: { campaign: { include: { campaignAccounts: { include: { account: true } } } } },
  });

  if (leads.length === 0) {
    console.log(`No leads assigned to ${ACCOUNT_EMAIL}`);
    await prisma.$disconnect();
    return;
  }

  // Group by campaign
  const byCampaign = new Map<string, typeof leads>();
  for (const lead of leads) {
    const cid = lead.campaignId;
    if (!byCampaign.has(cid)) byCampaign.set(cid, []);
    byCampaign.get(cid)!.push(lead);
  }

  let totalReassigned = 0;

  for (const [campaignId, campaignLeads] of byCampaign) {
    const campaign = campaignLeads[0]!.campaign;
    const otherAccounts = campaign.campaignAccounts
      .filter((ca) => ca.accountId !== account.id)
      .map((ca) => ca.accountId);

    if (otherAccounts.length === 0) {
      console.log(`Campaign ${campaign.name}: no other accounts, skipping ${campaignLeads.length} leads`);
      continue;
    }

    let idx = 0;
    for (const lead of campaignLeads) {
      const newAccountId = otherAccounts[idx % otherAccounts.length];
      idx++;
      await prisma.lead.update({
        where: { id: lead.id },
        data: { assignedAccountId: newAccountId },
      });
      totalReassigned++;
    }
    console.log(`Campaign ${campaign.name}: reassigned ${campaignLeads.length} leads to ${otherAccounts.length} accounts`);
  }

  console.log(`Done. Reassigned ${totalReassigned} leads from ${ACCOUNT_EMAIL}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
