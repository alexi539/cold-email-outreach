import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { campaignId, accountId, status, limit = "500" } = req.query;
    const where: Record<string, unknown> = {};
    if (campaignId) where.campaignId = campaignId;
    if (accountId) where.accountId = accountId;
    if (status) {
      const statuses = String(status).split(",").map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) where.status = statuses[0];
      else if (statuses.length > 1) where.status = { in: statuses };
    }

    const sent = await prisma.sentEmail.findMany({
      where,
      include: {
        lead: true,
        account: true,
        campaign: true,
      },
      orderBy: { sentAt: "desc" },
      take: Math.min(Number(limit) || 500, 1000),
    });
    res.json(sent);
  } catch (e) {
    logger.error("List history error", e);
    res.status(500).json({ error: "Failed to list history" });
  }
});

export { router as historyRouter };
