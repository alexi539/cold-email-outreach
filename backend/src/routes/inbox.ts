import { Router } from "express";
import { logger } from "../lib/logger.js";
import {
  listInboxMessages,
  listUnifiedInbox,
  getInboxMessage,
  getInboxThread,
  getUnreadCount,
  sendReply,
} from "../services/inbox.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { accountId, limit, pageToken } = req.query;
    if (!accountId || typeof accountId !== "string") {
      return res.status(400).json({ error: "accountId required" });
    }
    const result = await listInboxMessages(accountId, {
      limit: limit ? Math.min(Number(limit), 200) : undefined,
      pageToken: typeof pageToken === "string" ? pageToken : undefined,
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("not found")) {
      return res.status(404).json({ error: msg });
    }
    if (msg.includes("OAuth") || msg.includes("password")) {
      return res.status(400).json({ error: msg });
    }
    logger.error("Inbox list error", e);
    res.status(500).json({ error: "Failed to list inbox" });
  }
});

router.get("/all", async (req, res) => {
  try {
    const { limit, pageToken } = req.query;
    const result = await listUnifiedInbox({
      limit: limit ? Math.min(Number(limit), 200) : undefined,
      pageToken: typeof pageToken === "string" ? pageToken : undefined,
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("not found")) {
      return res.status(404).json({ error: msg });
    }
    if (msg.includes("OAuth") || msg.includes("password")) {
      return res.status(400).json({ error: msg });
    }
    logger.error("Inbox unified list error", e);
    res.status(500).json({ error: "Failed to list unified inbox" });
  }
});

router.get("/unread-count", async (req, res) => {
  try {
    const { accountId, fresh } = req.query;
    const result = await getUnreadCount(
      typeof accountId === "string" ? accountId : undefined,
      { fresh: fresh === "1" || fresh === "true" }
    );
    res.json(result);
  } catch (e) {
    logger.error("Inbox unread count error", e);
    res.status(500).json({ error: "Failed to get unread count" });
  }
});

router.post("/send-reply", async (req, res) => {
  try {
    const { accountId, messageId, to, subject, body } = req.body;
    if (!accountId || !messageId || !to || !subject) {
      return res.status(400).json({
        error: "accountId, messageId, to, and subject required",
      });
    }
    const result = await sendReply(accountId, {
      messageId,
      to: String(to),
      subject: String(subject),
      body: typeof body === "string" ? body : "",
    });
    if (!result.success) {
      return res.status(400).json({ error: result.error || "Send failed" });
    }
    res.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("not found")) {
      return res.status(404).json({ error: msg });
    }
    if (msg.includes("OAuth") || msg.includes("password")) {
      return res.status(400).json({ error: msg });
    }
    logger.error("Inbox send reply error", e);
    res.status(500).json({ error: "Failed to send reply" });
  }
});

router.get("/:accountId/messages/:messageId", async (req, res) => {
  try {
    const { accountId, messageId } = req.params;
    if (!accountId || !messageId) {
      return res.status(400).json({ error: "accountId and messageId required" });
    }
    const result = await getInboxMessage(accountId, messageId);
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("not found") || msg.includes("Invalid") || msg.includes("Message filtered")) {
      return res.status(404).json({ error: msg });
    }
    if (msg.includes("OAuth") || msg.includes("password")) {
      return res.status(400).json({ error: msg });
    }
    logger.error("Inbox message fetch error", e);
    res.status(500).json({ error: "Failed to fetch message" });
  }
});

router.get("/:accountId/thread/:messageId", async (req, res) => {
  try {
    const { accountId, messageId } = req.params;
    if (!accountId || !messageId) {
      return res.status(400).json({ error: "accountId and messageId required" });
    }
    const result = await getInboxThread(accountId, messageId);
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("not found") || msg.includes("Invalid") || msg.includes("Message filtered")) {
      return res.status(404).json({ error: msg });
    }
    if (msg.includes("OAuth") || msg.includes("password")) {
      return res.status(400).json({ error: msg });
    }
    logger.error("Inbox thread fetch error", e);
    res.status(500).json({ error: "Failed to fetch thread" });
  }
});

export { router as inboxRouter };
