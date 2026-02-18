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
