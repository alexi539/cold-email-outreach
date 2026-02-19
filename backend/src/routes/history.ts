import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { refreshReplyForSentEmail } from "../services/replyChecker.js";

const router = Router();

router.post("/:id/refresh-reply", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await refreshReplyForSentEmail(id);
    if (result.error && !result.updated) {
      return res.status(400).json({ updated: false, error: result.error });
    }
    res.json(result);
  } catch (e) {
    logger.error("Refresh reply error", e);
    res.status(500).json({ error: "Failed to refresh reply" });
  }
});

router.get("/replies", async (req, res) => {
  try {
    const { campaignId, accountId, status, limit = "500" } = req.query;
    const where: { fromUs: boolean; sentEmail?: { campaignId?: string; accountId?: string; status?: string | { in: string[] } } } = {
      fromUs: false,
    };
    if (campaignId || accountId || status) {
      where.sentEmail = {};
      if (campaignId) where.sentEmail.campaignId = String(campaignId);
      if (accountId) where.sentEmail.accountId = String(accountId);
      const statuses = status
        ? String(status).split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      if (statuses.length === 1) where.sentEmail.status = statuses[0];
      else if (statuses.length > 1) where.sentEmail.status = { in: statuses };
    }

    const replies = await prisma.replyMessage.findMany({
      where,
      include: {
        sentEmail: {
          include: {
            lead: true,
            account: true,
            campaign: true,
          },
        },
      },
      orderBy: { replyAt: "desc" },
      take: Math.min(Number(limit) || 500, 1000),
    });

    const sentEmailIds = [...new Set(replies.map((r) => r.sentEmailId))];
    const ourRepliesAfter = await prisma.replyMessage.findMany({
      where: {
        sentEmailId: { in: sentEmailIds },
        fromUs: true,
      },
      select: { sentEmailId: true, replyAt: true },
    });
    const answeredSet = new Set<string>();
    for (const r of replies) {
      const hasOurReplyAfter = ourRepliesAfter.some(
        (o) => o.sentEmailId === r.sentEmailId && o.replyAt > r.replyAt
      );
      if (hasOurReplyAfter) answeredSet.add(r.id);
    }

    const result = replies.map((r) => ({
      ...r,
      answered: answeredSet.has(r.id),
    }));
    res.json(result);
  } catch (e) {
    logger.error("List replies error", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/", async (req, res) => {
  try {
    const { campaignId, accountId, status, limit = "500" } = req.query;
    const where: Record<string, unknown> = {};
    if (campaignId) where.campaignId = campaignId;
    if (accountId) where.accountId = accountId;
    const statuses = status
      ? String(status).split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    if (statuses.length === 1) where.status = statuses[0];
    else if (statuses.length > 1) where.status = { in: statuses };

    const isRepliesOnly =
      statuses.length > 0 &&
      statuses.every((s) => ["replied", "bounce", "auto_reply"].includes(s));
    const orderBy = isRepliesOnly
      ? [{ replyAt: "desc" as const }, { sentAt: "desc" as const }]
      : { sentAt: "desc" as const };

    const sent = await prisma.sentEmail.findMany({
      where,
      include: {
        lead: true,
        account: true,
        campaign: true,
      },
      orderBy,
      take: Math.min(Number(limit) || 500, 1000),
    });
    res.json(sent);
  } catch (e) {
    logger.error("List history error", e);
    res.status(500).json({ error: "Failed to list history" });
  }
});

export { router as historyRouter };
