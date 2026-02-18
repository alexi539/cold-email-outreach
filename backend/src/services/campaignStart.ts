import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { humanLikeThrottleSeconds } from "../lib/throttle.js";

const assignLocks = new Map<string, Promise<void>>();

export async function assignLeadsAndStart(campaignId: string): Promise<void> {
  const existing = assignLocks.get(campaignId);
  if (existing) {
    await existing;
    return doAssignLeadsAndStart(campaignId);
  }
  const promise = doAssignLeadsAndStart(campaignId);
  assignLocks.set(campaignId, promise);
  try {
    await promise;
  } finally {
    assignLocks.delete(campaignId);
  }
}

async function doAssignLeadsAndStart(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      campaignAccounts: true,
      sequence: { include: { steps: true } },
    },
  });
  if (!campaign || campaign.status !== "active") return;
  if (!campaign.sequence?.steps?.length) return;

  const campaignAccountIds = campaign.campaignAccounts.map((ca) => ca.accountId);
  const activeAccounts = await prisma.emailAccount.findMany({
    where: { id: { in: campaignAccountIds }, isActive: true },
  });
  const accountIds = activeAccounts.map((a) => a.id);
  if (!accountIds.length) return;

  const unassigned = await prisma.lead.findMany({
    where: { campaignId, assignedAccountId: null, status: "pending" },
    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
  });
  if (!unassigned.length) return;

  let idx = 0;
  const now = new Date();
  let baseDate: Date;
  if (!campaign.startTime || campaign.startTime === "") {
    baseDate = new Date(now);
  } else {
    const [sh, sm] = campaign.startTime.split(":").map(Number);
    baseDate = new Date(now);
    const mskHour = (sh ?? 9) % 24;
    const utcHour = (mskHour - 3 + 24) % 24;
    baseDate.setUTCHours(utcHour, sm ?? 0, 0, 0);
    if (baseDate <= now) {
      baseDate = new Date(now);
    }
  }

  const throttleMin = campaign.sequence.throttleMinMinutes ?? 2;
  const throttleMax = campaign.sequence.throttleMaxMinutes ?? 5;

  const offsetByAccount = new Map<string, number>();
  for (const lead of unassigned) {
    const accountId = accountIds[idx % accountIds.length];
    idx++;

    const offsetMs = offsetByAccount.get(accountId) ?? 0;
    const nextSendAt = new Date(baseDate.getTime() + offsetMs);

    const randomSeconds = humanLikeThrottleSeconds(throttleMin, throttleMax);
    offsetByAccount.set(accountId, offsetMs + randomSeconds * 1000);

    await prisma.lead.update({
      where: { id: lead.id },
      data: { assignedAccountId: accountId, nextSendAt },
    });
  }

  logger.info("Campaign started, leads assigned", { campaignId, count: unassigned.length });
}
