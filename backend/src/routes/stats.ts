import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/dashboard", async (_req, res) => {
  try {
    const [campaigns, accounts, totalSent, totalReplied] = await Promise.all([
      prisma.campaign.count(),
      prisma.emailAccount.count(),
      prisma.sentEmail.count(),
      prisma.sentEmail.count({ where: { status: "replied" } }),
    ]);
    res.json({
      campaigns,
      accounts,
      totalSent,
      totalReplied,
    });
  } catch (e) {
    logger.error("Dashboard stats error", e);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

export { router as statsRouter };
