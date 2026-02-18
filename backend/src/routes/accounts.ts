import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { encrypt, decrypt } from "../lib/encryption.js";
import { logger } from "../lib/logger.js";
export { getDecryptedPassword, getDecryptedOAuth } from "../lib/accounts.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const accounts = await prisma.emailAccount.findMany({
      orderBy: { createdAt: "desc" },
    });
    const safe = accounts.map((a) => ({
      ...a,
      oauthTokens: undefined,
      smtpPasswordEncrypted: a.smtpPasswordEncrypted ? "***" : undefined,
    }));
    res.json(safe);
  } catch (e) {
    logger.error("List accounts error", e);
    res.status(500).json({ error: "Failed to list accounts" });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      email,
      displayName,
      accountType,
      dailyLimit = 100,
      smtpPassword,
      zohoProServers,
    } = req.body;

    if (!email || !accountType) {
      return res.status(400).json({ error: "email and accountType required" });
    }
    if (!["google", "zoho"].includes(accountType)) {
      return res.status(400).json({ error: "accountType must be google or zoho" });
    }

    if (accountType === "zoho" && !smtpPassword) {
      return res.status(400).json({ error: "smtpPassword required for Zoho" });
    }

    const data: Record<string, unknown> = {
      email: String(email).trim().toLowerCase(),
      displayName: displayName || null,
      accountType,
      dailyLimit: Number(dailyLimit) || 100,
      zohoProServers: accountType === "zoho" ? Boolean(zohoProServers) : false,
    };

    if (accountType === "zoho" && smtpPassword) {
      data.smtpPasswordEncrypted = encrypt(smtpPassword);
    }

    const account = await prisma.emailAccount.create({ data: data as never });
    const safe = { ...account, oauthTokens: undefined, smtpPasswordEncrypted: account.smtpPasswordEncrypted ? "***" : undefined };
    res.status(201).json(safe);
  } catch (e) {
    logger.error("Create account error", e);
    res.status(500).json({ error: "Failed to create account" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      displayName,
      dailyLimit,
      isActive,
      oauthTokens,
      smtpPassword,
      zohoProServers,
    } = req.body;

    const data: Record<string, unknown> = {};
    if (displayName !== undefined) data.displayName = displayName;
    if (dailyLimit !== undefined) data.dailyLimit = Number(dailyLimit);
    if (isActive !== undefined) data.isActive = Boolean(isActive);
    if (zohoProServers !== undefined) data.zohoProServers = Boolean(zohoProServers);
    if (oauthTokens !== undefined) data.oauthTokens = encrypt(JSON.stringify(oauthTokens));
    if (smtpPassword !== undefined && smtpPassword !== "***") {
      data.smtpPasswordEncrypted = encrypt(smtpPassword);
    }

    const account = await prisma.emailAccount.update({
      where: { id },
      data: data as never,
    });
    const safe = { ...account, oauthTokens: undefined, smtpPasswordEncrypted: account.smtpPasswordEncrypted ? "***" : undefined };
    res.json(safe);
  } catch (e) {
    logger.error("Update account error", e);
    res.status(500).json({ error: "Failed to update account" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await prisma.emailAccount.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (e) {
    logger.error("Delete account error", e);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

export { router as accountsRouter };
