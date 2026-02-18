import { prisma } from "../lib/prisma.js";
import { logger, formatError } from "../lib/logger.js";
import { isWithinWorkingHours } from "../lib/msk.js";
import { updateCampaignStatusFromCompletion } from "./campaignCompletion.js";
import { sendGmail, getGmailMessageIdHeader } from "./gmail.js";
import { sendZoho } from "./zoho.js";
import { personalize } from "./personalize.js";
import { stripHtml } from "../lib/emailBody.js";
import { humanLikeThrottleSeconds } from "../lib/throttle.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function maybeResetAccountLimit(account: { id: string; limitResetAt: Date | null; sentToday: number; dailyLimit: number }) {
  if (!account.limitResetAt) return;
  if (new Date() >= account.limitResetAt) {
    await prisma.emailAccount.update({
      where: { id: account.id },
      data: { sentToday: 0, limitResetAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
  }
}

export async function runSendCycle() {
  const campaigns = await prisma.campaign.findMany({
    where: { status: "active" },
    include: {
      sequence: { include: { steps: { orderBy: { stepOrder: "asc" } } } },
      campaignAccounts: { include: { account: true } },
    },
  });

  const now = new Date();

  for (const campaign of campaigns) {
    let sentThisRun = 0;
    if (!campaign.sequence?.steps?.length) {
      logger.info("Campaign skipped: no sequence steps", { campaignId: campaign.id });
      continue;
    }

    const workingHoursStart = campaign.workingHoursStart || "09:00";
    const workingHoursEnd = campaign.workingHoursEnd || "18:00";
    if (!isWithinWorkingHours(workingHoursStart, workingHoursEnd, now)) {
      logger.info("Campaign skipped: outside working hours", {
        campaignId: campaign.id,
        workingHours: `${workingHoursStart}-${workingHoursEnd} MSK`,
      });
      continue;
    }

    let campaignSentToday = await prisma.sentEmail.count({
      where: {
        campaignId: campaign.id,
        sentAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    });
    if (campaignSentToday >= campaign.dailyLimit) {
      logger.info("Campaign daily limit reached", { campaignId: campaign.id });
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "paused" } });
      continue;
    }

    const accountIds = campaign.campaignAccounts.map((ca) => ca.accountId);
    if (!accountIds.length) {
      logger.info("Campaign skipped: no email accounts", { campaignId: campaign.id });
      continue;
    }
    const accounts = await prisma.emailAccount.findMany({
      where: { id: { in: accountIds }, isActive: true },
    });
    if (!accounts.length) {
      logger.info("Campaign skipped: no active accounts", { campaignId: campaign.id });
      continue;
    }

    let anyAccountAvailable = false;
    for (const acc of accounts) {
      await maybeResetAccountLimit(acc);
      const updated = await prisma.emailAccount.findUnique({ where: { id: acc.id } });
      if (updated && updated.sentToday < updated.dailyLimit) {
        anyAccountAvailable = true;
        break;
      }
    }
    if (!anyAccountAvailable) {
      logger.info("All accounts at limit, pausing campaign", { campaignId: campaign.id });
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "paused" } });
      continue;
    }

    // Process up to one lead per account per run — throughput scales with account count
    for (const account of accounts) {
      if (campaignSentToday >= campaign.dailyLimit) break;

      await maybeResetAccountLimit(account);
      const accUpdated = await prisma.emailAccount.findUnique({ where: { id: account.id } });
      if (!accUpdated || accUpdated.sentToday >= accUpdated.dailyLimit) continue;

      const nowWithBuffer = new Date(now.getTime() + 60000);
      const lead = await prisma.lead.findFirst({
        where: {
          campaignId: campaign.id,
          assignedAccountId: account.id,
          status: { in: ["pending", "sent"] },
          nextSendAt: { lte: nowWithBuffer, not: null },
        },
        orderBy: { nextSendAt: "asc" },
      });

      if (!lead) continue;

      const stepIndex = lead.currentStep;
      const alreadySent = await prisma.sentEmail.findFirst({
        where: { leadId: lead.id, stepOrder: stepIndex },
      });
      if (alreadySent) continue;

      const step = campaign.sequence.steps[stepIndex];
      if (!step) continue;

      const data = (JSON.parse(lead.data || "{}") as Record<string, string>) || {};
      const subject = personalize(step.subjectTemplate, data);
      const body = personalize(step.bodyTemplate, data);

      let zohoReplyOpts: { inReplyTo?: string; references?: string } | undefined;
      let gmailReplyOpts: { threadId?: string; inReplyTo?: string; references?: string } | undefined;
      if (account.accountType === "zoho" && stepIndex > 0) {
        const prevSent = await prisma.sentEmail.findFirst({
          where: { leadId: lead.id, stepOrder: stepIndex - 1 },
        });
        if (prevSent?.messageId) {
          const ref = prevSent.messageId.startsWith("<") ? prevSent.messageId : `<${prevSent.messageId}>`;
          zohoReplyOpts = { inReplyTo: ref, references: ref };
        }
      }
      if (account.accountType === "google" && stepIndex > 0) {
        const prevSent = await prisma.sentEmail.findFirst({
          where: { leadId: lead.id, stepOrder: stepIndex - 1 },
        });
        if (prevSent?.gmailThreadId && prevSent?.gmailMessageId) {
          const msgIdHeader = await getGmailMessageIdHeader(account, prevSent.gmailMessageId);
          const ref = msgIdHeader
            ? msgIdHeader.startsWith("<") ? msgIdHeader : `<${msgIdHeader}>`
            : undefined;
          gmailReplyOpts = {
            threadId: prevSent.gmailThreadId,
            inReplyTo: ref,
            references: ref,
          };
        }
      }

      logger.info("Attempting send", {
        leadId: lead.id,
        to: lead.email,
        accountId: account.id,
        campaignId: campaign.id,
        step: stepIndex,
      });

      try {
        let result: { messageId?: string; threadId?: string } = {};
        if (account.accountType === "google") {
          result = await sendGmail(account, lead.email, subject, body, gmailReplyOpts);
        } else if (account.accountType === "zoho") {
          result = await sendZoho(account, lead.email, subject, body, zohoReplyOpts);
        } else {
          continue;
        }

        const limitResetAt = accUpdated.limitResetAt
          ? accUpdated.limitResetAt
          : new Date(Date.now() + 24 * 60 * 60 * 1000);

        await prisma.$transaction([
          prisma.sentEmail.create({
            data: {
              leadId: lead.id,
              accountId: account.id,
              campaignId: campaign.id,
              stepOrder: stepIndex,
              subject,
              bodyPreview: stripHtml(body).slice(0, 200),
              gmailMessageId: result.messageId,
              gmailThreadId: result.threadId,
              messageId: result.messageId,
            },
          }),
          prisma.lead.update({
            where: { id: lead.id },
            data: {
              currentStep: stepIndex + 1,
              status: "sent",
              nextSendAt: (() => {
                if (stepIndex + 1 >= campaign.sequence.steps.length) return null;
                const nextStep = campaign.sequence.steps[stepIndex + 1];
                const delayDays = nextStep?.delayAfterPreviousDays ?? 0;
                return new Date(now.getTime() + delayDays * 24 * 60 * 60 * 1000);
              })(),
            },
          }),
          prisma.emailAccount.update({
            where: { id: account.id },
            data: {
              sentToday: accUpdated.sentToday + 1,
              limitResetAt,
            },
          }),
        ]);

        const throttleMin = campaign.sequence.throttleMinMinutes ?? 2;
        const throttleMax = campaign.sequence.throttleMaxMinutes ?? 5;
        const randomSeconds = humanLikeThrottleSeconds(throttleMin, throttleMax);
        const throttleMs = randomSeconds * 1000;

        const nextLeadSameAccount = await prisma.lead.findFirst({
          where: {
            campaignId: campaign.id,
            assignedAccountId: account.id,
            status: { in: ["pending", "sent"] },
            nextSendAt: { not: null },
            id: { not: lead.id },
          },
          orderBy: { nextSendAt: "asc" },
        });
        if (nextLeadSameAccount) {
          const currentNext = nextLeadSameAccount.nextSendAt ? nextLeadSameAccount.nextSendAt.getTime() : 0;
          const proposed = now.getTime() + throttleMs;
          if (proposed > currentNext) {
            await prisma.lead.update({
              where: { id: nextLeadSameAccount.id },
              data: { nextSendAt: new Date(proposed) },
            });
          }
        }

        campaignSentToday++;
        sentThisRun++;
        logger.info("Sent email", { leadId: lead.id, to: lead.email, step: stepIndex });

        // Real delay between sends — throttle is always respected
        await sleep(throttleMs);
        logger.info("Throttle delay complete", { throttleSeconds: Math.round(throttleMs / 1000) });

        updateCampaignStatusFromCompletion(campaign.id).catch((e) =>
          logger.error("Campaign completion check error", {
            campaignId: campaign.id,
            ...formatError(e),
          })
        );
      } catch (e) {
        logger.error("Send failed", {
          leadId: lead.id,
          to: lead.email,
          accountId: account.id,
          campaignId: campaign.id,
          step: stepIndex,
          ...formatError(e),
        });
      }
    }
    if (sentThisRun === 0) {
      logger.info("Campaign run: no leads ready", { campaignId: campaign.id, name: campaign.name });
    }
  }
}
