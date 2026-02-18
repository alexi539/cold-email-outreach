import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

export interface CampaignCompletionResult {
  completionPercent: number;
  leadsTotal: number;
  leadsDone: number;
  totalSteps: number;
  isFinished: boolean;
}

/**
 * Compute campaign completion: % of leads that have received all emails (or replied).
 * A lead is "done" when: status is "replied" OR currentStep >= totalSteps.
 */
export async function computeCampaignCompletion(campaignId: string): Promise<CampaignCompletionResult | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      sequence: { include: { steps: { orderBy: { stepOrder: "asc" } } } },
      leads: true,
    },
  });
  if (!campaign) return null;

  const totalSteps = campaign.sequence?.steps?.length ?? 0;
  const leads = campaign.leads;
  const leadsTotal = leads.length;

  if (leadsTotal === 0 || totalSteps === 0) {
    return {
      completionPercent: leadsTotal === 0 ? 0 : 100,
      leadsTotal,
      leadsDone: leadsTotal === 0 ? 0 : leadsTotal,
      totalSteps,
      isFinished: leadsTotal === 0 || totalSteps === 0,
    };
  }

  const leadsDone = leads.filter(
    (l) =>
      l.status === "replied" ||
      l.status === "bounce" ||
      l.status === "auto_reply" ||
      l.currentStep >= totalSteps
  ).length;
  const completionPercent = Math.round((leadsDone / leadsTotal) * 100);
  const isFinished = leadsDone === leadsTotal;

  return {
    completionPercent,
    leadsTotal,
    leadsDone,
    totalSteps,
    isFinished,
  };
}

/**
 * Update campaign status based on completion.
 * - If all leads done and campaign is active/paused → set to "finished"
 * - If campaign was "finished" and now has incomplete leads → set to "active"
 */
export async function updateCampaignStatusFromCompletion(campaignId: string): Promise<void> {
  const result = await computeCampaignCompletion(campaignId);
  if (!result) return;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true },
  });
  if (!campaign) return;

  // Only auto-finish when campaign is active. Paused campaigns stay paused — user controls them.
  if (result.isFinished && campaign.status === "active") {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "finished" },
    });
    logger.info("Campaign marked as finished", { campaignId });
  } else if (
    !result.isFinished &&
    campaign.status === "finished"
  ) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "active" },
    });
    logger.info("Campaign resumed from finished (new leads/steps)", { campaignId });
  }
}
