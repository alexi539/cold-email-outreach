import { Router, type Request, type Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { parse } from "csv-parse/sync";
import { updateCampaignStatusFromCompletion } from "../services/campaignCompletion.js";
import { assignLeadsAndStart } from "../services/campaignStart.js";
import { validateEmails, hasValidKitKeys, getKeyUsage } from "../services/validkit.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, fieldSize: 5 * 1024 * 1024 },
});

/** Split email cell by comma, semicolon, or newline — each becomes a separate lead */
function parseEmails(raw: string): string[] {
  return raw
    .split(/[,;\n\r]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e && e.includes("@"));
}

function parseCsvAndExtractEmails(fileBuffer: Buffer): { records: Record<string, string>[]; emails: string[]; emailCol: string } {
  const raw = fileBuffer.toString("utf-8").replace(/^\uFEFF/, "");
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }) as Record<string, string>[];
  if (!records.length) return { records: [], emails: [], emailCol: "" };
  const headers = Object.keys(records[0] || {});
  const emailCol =
    headers.find(
      (k) =>
        k.toLowerCase() === "email" ||
        k.toLowerCase() === "e-mail" ||
        k.toLowerCase() === "emails"
    ) || headers[0];
  if (!emailCol) return { records, emails: [], emailCol };
  const emails: string[] = [];
  const seen = new Set<string>();
  for (const row of records) {
    const rawEmails = (row[emailCol] || row.email || "").trim();
    for (const email of parseEmails(rawEmails)) {
      if (!seen.has(email)) {
        seen.add(email);
        emails.push(email);
      }
    }
  }
  return { records, emails, emailCol };
}

router.get("/", async (req, res) => {
  try {
    const { campaignId } = req.query;
    if (!campaignId) return res.status(400).json({ error: "campaignId required" });

    const leads = await prisma.lead.findMany({
      where: { campaignId: String(campaignId) },
      include: { account: true },
      orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
    });
    res.json(leads);
  } catch (e) {
    logger.error("List leads error", e);
    res.status(500).json({ error: "Failed to list leads" });
  }
});

router.get("/validkit-available", async (_req, res) => {
  res.json({ available: hasValidKitKeys() });
});

router.get("/validkit-usage", async (_req, res) => {
  try {
    const usage = await getKeyUsage();
    res.json({ keys: usage });
  } catch (e) {
    logger.error("ValidKit usage error", e);
    res.status(500).json({ error: "Failed to get ValidKit usage" });
  }
});

router.post("/preview", upload.single("file"), async (req, res) => {
  try {
    const file = (req as { file?: { buffer?: Buffer } }).file;
    if (!file?.buffer) return res.status(400).json({ error: "CSV file required" });
    const { records, emails, emailCol } = parseCsvAndExtractEmails(file.buffer);
    if (!emailCol) return res.status(400).json({ error: "CSV must have an email column" });
    res.json({ totalRows: records.length, emails, emailCol });
  } catch (e) {
    logger.error("Leads preview error", e);
    res.status(500).json({ error: "Failed to preview CSV" });
  }
});

const VALIDATED_BACKUPS_DIR = path.join(process.cwd(), "validated-backups");

router.post("/validate", async (req, res) => {
  try {
    const { emails } = req.body as { emails?: string[] };
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: "emails array required" });
    }
    const results = await validateEmails(emails);
    const summary = { valid: 0, invalid: 0, risky: 0 };
    for (const r of results) {
      summary[r.status]++;
    }
    try {
      fs.mkdirSync(VALIDATED_BACKUPS_DIR, { recursive: true });
      const filename = `validated-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const filepath = path.join(VALIDATED_BACKUPS_DIR, filename);
      fs.writeFileSync(
        filepath,
        JSON.stringify({ savedAt: new Date().toISOString(), count: results.length, results, summary }, null, 2),
        "utf-8"
      );
      logger.info("Validation backup saved", { file: filename, count: results.length });
    } catch (backupErr) {
      logger.warn("Validation backup failed", backupErr);
    }
    res.json({ results, summary });
  } catch (e) {
    logger.error("Leads validate error", e);
    res.status(500).json({ error: (e as Error).message || "Failed to validate emails" });
  }
});

export type UploadFilter = "all" | "exclude_risky" | "exclude_invalid_and_risky";

export async function handleLeadsUpload(req: Request, res: Response) {
  try {
    const campaignId = req.body?.campaignId;
    const filter = (req.body?.filter as UploadFilter) || "all";
    let validationResults = req.body?.validationResults;
    if (typeof validationResults === "string") {
      try {
        validationResults = JSON.parse(validationResults) as { email: string; status: string }[];
      } catch {
        validationResults = undefined;
      }
    } else if (!Array.isArray(validationResults)) {
      validationResults = undefined;
    }
    const file = (req as { file?: { buffer?: Buffer } }).file;
    if (!campaignId || !file?.buffer) {
      return res.status(400).json({ error: "campaignId and CSV file required" });
    }

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const { records, emails, emailCol } = parseCsvAndExtractEmails(file.buffer);
    if (!records.length) {
      return res.json({ total: 0, created: 0, skipped: 0 });
    }
    if (!emailCol) {
      return res.status(400).json({ error: "CSV must have an email column" });
    }

    const statusByEmail = new Map<string, string>();
    if (Array.isArray(validationResults)) {
      for (const r of validationResults) {
        statusByEmail.set(r.email.toLowerCase(), r.status);
      }
    }

    const allowedStatuses = new Set<string>();
    if (filter === "all") {
      allowedStatuses.add("valid").add("invalid").add("risky");
    } else if (filter === "exclude_risky") {
      allowedStatuses.add("valid").add("invalid");
    } else {
      allowedStatuses.add("valid");
    }

    const seen = new Set<string>();
    const existing = await prisma.lead.findMany({
      where: { campaignId },
      select: { email: true },
    });
    for (const l of existing) seen.add(l.email.toLowerCase());

    const otherCampaigns = await prisma.lead.findMany({
      where: { campaignId: { not: campaignId } },
      select: { email: true },
    });
    for (const l of otherCampaigns) seen.add(l.email.toLowerCase());

    const toCreate: { campaignId: string; email: string; data: string; orderIndex: number }[] = [];
    let totalEmailsParsed = 0;
    let orderIndex = 0;
    for (const row of records) {
      const rawEmails = (row[emailCol] || row.email || "").trim();
      const rowEmails = parseEmails(rawEmails);
      if (!rowEmails.length) continue;

      totalEmailsParsed += rowEmails.length;
      for (const email of rowEmails) {
        if (seen.has(email)) continue;
        const status = statusByEmail.get(email);
        if (status !== undefined && !allowedStatuses.has(status)) continue;
        seen.add(email);
        const rowForLead = { ...row, [emailCol]: email };
        toCreate.push({
          campaignId,
          email,
          data: JSON.stringify(rowForLead),
          orderIndex: orderIndex++,
        });
      }
    }

    if (toCreate.length) {
      const BATCH_SIZE = 300;
      for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
        await prisma.lead.createMany({ data: toCreate.slice(i, i + BATCH_SIZE) });
      }
      updateCampaignStatusFromCompletion(campaignId).catch((e) =>
        logger.error("Campaign completion check after leads upload", { campaignId, error: e })
      );
      if (campaign.status === "active") {
        assignLeadsAndStart(campaignId).catch((e) =>
          logger.error("Assign leads after upload", { campaignId, error: e })
        );
      }
    }

    res.json({
      total: records.length,
      created: toCreate.length,
      skipped: totalEmailsParsed - toCreate.length,
    });
  } catch (e) {
    logger.error("Upload leads error", e);
    res.status(500).json({ error: "Failed to upload leads" });
  }
}

router.post("/move", async (req, res) => {
  try {
    const { fromCampaignId, toCampaignId, onlyUnsent } = req.body as {
      fromCampaignId?: string;
      toCampaignId?: string;
      onlyUnsent?: boolean;
    };
    if (!fromCampaignId || !toCampaignId) {
      return res.status(400).json({ error: "fromCampaignId and toCampaignId required" });
    }
    if (fromCampaignId === toCampaignId) {
      return res.status(400).json({ error: "Source and target campaign must be different" });
    }

    const toCampaign = await prisma.campaign.findUnique({
      where: { id: toCampaignId },
      include: { campaignAccounts: true, sequence: { include: { steps: true } } },
    });
    if (!toCampaign) return res.status(404).json({ error: "Target campaign not found" });

    const whereClause = { campaignId: fromCampaignId } as { campaignId: string; currentStep?: number };
    if (onlyUnsent) {
      whereClause.currentStep = 0;
    }

    const toMove = await prisma.lead.findMany({
      where: whereClause,
      orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
    });
    if (!toMove.length) {
      return res.json({ moved: 0, skipped: 0, message: onlyUnsent ? "No leads with 0 emails sent" : "No leads to move" });
    }

    const existingInTarget = await prisma.lead.findMany({
      where: { campaignId: toCampaignId },
      select: { email: true },
    });
    const existingEmails = new Set(existingInTarget.map((l) => l.email.toLowerCase()));

    const maxOrder = await prisma.lead
      .aggregate({
        where: { campaignId: toCampaignId },
        _max: { orderIndex: true },
      })
      .then((r) => r._max.orderIndex ?? -1);

    let orderIndex = maxOrder + 1;
    let moved = 0;
    const toCreate: { campaignId: string; email: string; data: string; orderIndex: number }[] = [];
    const toDeleteIds: string[] = [];

    for (const lead of toMove) {
      const emailLower = lead.email.toLowerCase();
      if (existingEmails.has(emailLower)) continue;
      existingEmails.add(emailLower);
      toCreate.push({
        campaignId: toCampaignId,
        email: lead.email,
        data: lead.data,
        orderIndex: orderIndex++,
      });
      toDeleteIds.push(lead.id);
    }

    if (toCreate.length === 0) {
      return res.json({ moved: 0, skipped: toMove.length, message: "All leads already exist in target campaign" });
    }

    await prisma.lead.createMany({
      data: toCreate.map((c) => ({
        ...c,
        currentStep: 0,
        nextSendAt: null,
        assignedAccountId: null,
        status: "pending",
      })),
    });
    await prisma.lead.deleteMany({ where: { id: { in: toDeleteIds } } });

    moved = toCreate.length;
    updateCampaignStatusFromCompletion(fromCampaignId).catch((e) =>
      logger.error("Campaign completion after move", { campaignId: fromCampaignId, error: e })
    );
    updateCampaignStatusFromCompletion(toCampaignId).catch((e) =>
      logger.error("Campaign completion after move", { campaignId: toCampaignId, error: e })
    );
    if (toCampaign.status === "active") {
      assignLeadsAndStart(toCampaignId).catch((e) =>
        logger.error("Assign leads after move", { campaignId: toCampaignId, error: e })
      );
    }

    logger.info("Leads moved", { fromCampaignId, toCampaignId, moved, onlyUnsent });
    res.json({ moved, skipped: toMove.length - moved });
  } catch (e) {
    logger.error("Move leads error", e);
    res.status(500).json({ error: (e as Error).message || "Failed to move leads" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await prisma.lead.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (e) {
    logger.error("Delete lead error", e);
    res.status(500).json({ error: "Failed to delete lead" });
  }
});

export { router as leadsRouter };
