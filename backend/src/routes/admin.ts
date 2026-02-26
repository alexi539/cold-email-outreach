import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.post("/import-accounts", async (req, res) => {
  try {
    const secret = req.headers["x-import-secret"];
    const expected = process.env.IMPORT_SECRET;
    if (!expected || secret !== expected) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body;
    const accounts = Array.isArray(body) ? body : [body];
    if (accounts.length === 0) {
      return res.status(400).json({ error: "Empty accounts array" });
    }

    let created = 0;
    let updated = 0;

    for (const a of accounts) {
      if (!a.email || a.accountType !== "zoho") continue;

      const data = {
        email: String(a.email).trim().toLowerCase(),
        displayName: a.displayName ?? null,
        accountType: "zoho" as const,
        dailyLimit: Number(a.dailyLimit) || 100,
        limitResetAt: a.limitResetAt ? new Date(a.limitResetAt) : null,
        sentToday: Number(a.sentToday) || 0,
        oauthTokens: a.oauthTokens ?? null,
        smtpPasswordEncrypted: a.smtpPasswordEncrypted ?? null,
        zohoProServers: Boolean(a.zohoProServers),
        isActive: a.isActive !== false,
      };

      const existing = await prisma.emailAccount.findUnique({
        where: { email: data.email },
      });

      if (existing) {
        await prisma.emailAccount.update({
          where: { email: data.email },
          data,
        });
        updated++;
      } else {
        await prisma.emailAccount.create({ data });
        created++;
      }
    }

    logger.info("Import accounts", { created, updated, total: accounts.length });
    res.json({ success: true, created, updated });
  } catch (e) {
    logger.error("Import accounts error", e);
    res.status(500).json({ error: "Failed to import accounts" });
  }
});

export { router as adminRouter };
