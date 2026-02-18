import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { validateCampaign } from "../lib/validateCampaign.js";
import { assignLeadsAndStart } from "../services/campaignStart.js";
import { updateCampaignStatusFromCompletion, computeCampaignCompletion } from "../services/campaignCompletion.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      include: {
        sequence: { include: { steps: { orderBy: { stepOrder: "asc" } } } },
        campaignAccounts: { include: { account: true } },
        _count: { select: { leads: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    const withCompletion = await Promise.all(
      campaigns.map(async (c) => {
        const completion = await computeCampaignCompletion(c.id);
        return {
          ...c,
          completionPercent: completion?.completionPercent ?? 0,
        };
      })
    );
    res.json(withCompletion);
  } catch (e) {
    logger.error("List campaigns error", e);
    res.status(500).json({ error: "Failed to list campaigns" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      include: {
        sequence: { include: { steps: { orderBy: { stepOrder: "asc" } } } },
        campaignAccounts: { include: { account: true } },
        _count: { select: { leads: true } },
      },
    });
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const completion = await computeCampaignCompletion(campaign.id);
    res.json({
      ...campaign,
      completionPercent: completion?.completionPercent ?? 0,
    });
  } catch (e) {
    logger.error("Get campaign error", e);
    res.status(500).json({ error: "Failed to get campaign" });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      name,
      dailyLimit,
      startTime,
      workingHoursStart = "09:00",
      workingHoursEnd = "18:00",
      accountIds = [],
      sequence,
    } = req.body;

    const validationError = validateCampaign({
      startTime: startTime ?? null,
      workingHoursStart,
      workingHoursEnd,
      dailyLimit,
      sequence,
    });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const campaign = await prisma.campaign.create({
      data: {
        name: (name && String(name).trim()) || "Untitled Campaign",
        dailyLimit: Number(dailyLimit) || 500,
        startTime: startTime || null,
        workingHoursStart: String(workingHoursStart || "09:00"),
        workingHoursEnd: String(workingHoursEnd || "18:00"),
        campaignAccounts: accountIds.length
          ? { create: accountIds.map((aid: string) => ({ accountId: aid })) }
          : undefined,
        sequence: sequence
          ? {
              create: {
                throttleMinMinutes: sequence.throttleMinMinutes ?? 2,
                throttleMaxMinutes: sequence.throttleMaxMinutes ?? 5,
                steps: {
                  create: (sequence.steps || []).map((s: { subjectTemplate: string; bodyTemplate: string; delayAfterPreviousDays?: number }, i: number) => ({
                    stepOrder: i,
                    subjectTemplate: s.subjectTemplate || "",
                    bodyTemplate: s.bodyTemplate || "",
                    delayAfterPreviousDays: s.delayAfterPreviousDays ?? 0,
                  })),
                },
              },
            }
          : undefined,
      },
      include: {
        sequence: { include: { steps: { orderBy: { stepOrder: "asc" } } } },
        campaignAccounts: { include: { account: true } },
      },
    });
    res.status(201).json(campaign);
  } catch (e) {
    logger.error("Create campaign error", e);
    res.status(500).json({ error: "Failed to create campaign" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      dailyLimit,
      status,
      startTime,
      workingHoursStart,
      workingHoursEnd,
      accountIds,
      sequence,
    } = req.body;

    const validationError = validateCampaign({
      startTime,
      workingHoursStart,
      workingHoursEnd,
      dailyLimit,
      sequence,
    });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (dailyLimit !== undefined) data.dailyLimit = Number(dailyLimit);
    if (status !== undefined) data.status = status;
    if (startTime !== undefined) data.startTime = startTime;
    if (workingHoursStart !== undefined) data.workingHoursStart = workingHoursStart;
    if (workingHoursEnd !== undefined) data.workingHoursEnd = workingHoursEnd;

    if (accountIds !== undefined) {
      const newAccountIds = accountIds as string[];
      await prisma.campaignAccount.deleteMany({ where: { campaignId: id } });
      if (newAccountIds.length) {
        await prisma.campaignAccount.createMany({
          data: newAccountIds.map((aid: string) => ({ campaignId: id, accountId: aid })),
        });
        const activeAccountIds = await prisma.emailAccount
          .findMany({
            where: { id: { in: newAccountIds }, isActive: true },
            select: { id: true },
          })
          .then((a) => a.map((x) => x.id));
        if (activeAccountIds.length) {
          const orphaned = await prisma.lead.findMany({
            where: {
              campaignId: id,
              assignedAccountId: { notIn: newAccountIds },
            },
            orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
          });
          let idx = 0;
          for (const lead of orphaned) {
            const accountId = activeAccountIds[idx % activeAccountIds.length];
            idx++;
            await prisma.lead.update({
              where: { id: lead.id },
              data: { assignedAccountId: accountId },
            });
          }
        }
      } else {
        await prisma.lead.updateMany({
          where: { campaignId: id },
          data: { assignedAccountId: null, nextSendAt: null },
        });
      }
    }

    if (sequence !== undefined) {
      const seq = await prisma.sequence.findFirst({ where: { campaignId: id } });
      if (seq) {
        await prisma.sequenceStep.deleteMany({ where: { sequenceId: seq.id } });
        await prisma.sequence.update({
          where: { id: seq.id },
          data: {
            throttleMinMinutes: sequence.throttleMinMinutes ?? 2,
            throttleMaxMinutes: sequence.throttleMaxMinutes ?? 5,
          },
        });
        if (sequence.steps?.length) {
          await prisma.sequenceStep.createMany({
            data: sequence.steps.map((s: { subjectTemplate: string; bodyTemplate: string; delayAfterPreviousDays?: number }, i: number) => ({
              sequenceId: seq.id,
              stepOrder: i,
              subjectTemplate: s.subjectTemplate || "",
              bodyTemplate: s.bodyTemplate || "",
              delayAfterPreviousDays: s.delayAfterPreviousDays ?? 0,
            })),
          });
        }
      } else {
        await prisma.sequence.create({
          data: {
            campaignId: id,
            throttleMinMinutes: sequence.throttleMinMinutes ?? 2,
            throttleMaxMinutes: sequence.throttleMaxMinutes ?? 5,
            steps: {
              create: (sequence.steps || []).map((s: { subjectTemplate: string; bodyTemplate: string; delayAfterPreviousDays?: number }, i: number) => ({
                stepOrder: i,
                subjectTemplate: s.subjectTemplate || "",
                bodyTemplate: s.bodyTemplate || "",
                delayAfterPreviousDays: s.delayAfterPreviousDays ?? 0,
              })),
            },
          },
        });
      }
    }

    const campaign = await prisma.campaign.update({
      where: { id },
      data: data as never,
      include: {
        sequence: { include: { steps: { orderBy: { stepOrder: "asc" } } } },
        campaignAccounts: { include: { account: true } },
      },
    });
    if (campaign.status === "active" && (status === "active" || accountIds !== undefined)) {
      assignLeadsAndStart(id).catch((e) => logger.error("Campaign start assign error", e));
    }
    if (sequence !== undefined || accountIds !== undefined) {
      updateCampaignStatusFromCompletion(id).catch((e) =>
        logger.error("Campaign completion check after update", { campaignId: id, error: e })
      );
    }
    const completion = await computeCampaignCompletion(id);
    res.json({
      ...campaign,
      completionPercent: completion?.completionPercent ?? 0,
    });
  } catch (e) {
    logger.error("Update campaign error", e);
    res.status(500).json({ error: "Failed to update campaign" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await prisma.lead.deleteMany({ where: { campaignId: id } });
    await prisma.campaign.delete({ where: { id } });
    res.status(204).send();
  } catch (e) {
    logger.error("Delete campaign error", e);
    res.status(500).json({ error: "Failed to delete campaign" });
  }
});

export { router as campaignsRouter };
