import { google } from "googleapis";
import Imap from "imap";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { getDecryptedOAuth, getDecryptedPassword } from "../lib/accounts.js";
import { updateCampaignStatusFromCompletion } from "./campaignCompletion.js";
import { extractGmailBody } from "../lib/gmailBody.js";
import { detectReplyType } from "../lib/replyType.js";
import type { gmail_v1 } from "googleapis";

async function applyReplyUpdate(
  sentEmailId: string,
  leadId: string,
  campaignId: string,
  replyBody: string,
  replyAt: Date,
  replyType: "human" | "bounce" | "auto_reply"
) {
  const status = replyType === "human" ? "replied" : replyType;
  await prisma.$transaction([
    prisma.sentEmail.update({
      where: { id: sentEmailId },
      data: { status, replyBody, replyAt, replyType },
    }),
    prisma.lead.update({
      where: { id: leadId },
      data: { status },
    }),
  ]);
  logger.info("Reply detected", {
    leadId,
    replyType,
    campaignId,
  });
  updateCampaignStatusFromCompletion(campaignId).catch((e) =>
    logger.error("Campaign completion check after reply", { campaignId, error: e })
  );
}

async function checkGmailReplies() {
  const accounts = await prisma.emailAccount.findMany({
    where: { accountType: "google", isActive: true },
  });

  for (const account of accounts) {
    const tokens = getDecryptedOAuth(account);
    if (!tokens?.refresh_token) continue;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      undefined
    );
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const sent = await prisma.sentEmail.findMany({
      where: { accountId: account.id, status: "sent", gmailThreadId: { not: null } },
      include: { lead: true },
    });

    for (const s of sent) {
      if (!s.gmailThreadId) continue;
      try {
        const { data: thread } = await gmail.users.threads.get({
          userId: "me",
          id: s.gmailThreadId,
          format: "full",
        });
        const messages = (thread.messages || []) as gmail_v1.Schema$Message[];
        const ourSentAt = s.sentAt ? new Date(s.sentAt) : new Date(0);
        const ourSentAtMs = ourSentAt.getTime();

        const replyMsg = messages.find((m) => {
          const msgTime = typeof m.internalDate === "string" ? parseInt(m.internalDate, 10) : 0;
          if (msgTime <= ourSentAtMs) return false;
          const from = m.payload?.headers?.find((h) => h.name?.toLowerCase() === "from")?.value || "";
          return !from.toLowerCase().includes(account.email);
        });

        if (replyMsg) {
          const replyAt = new Date(
            typeof replyMsg.internalDate === "string"
              ? parseInt(replyMsg.internalDate, 10)
              : Date.now()
          );
          const replyBody = extractGmailBody(replyMsg.payload);
          const replySubject =
            replyMsg.payload?.headers?.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
          const replyType = detectReplyType(replyBody, replySubject, ourSentAt, replyAt);

          await applyReplyUpdate(s.id, s.leadId, s.campaignId, replyBody, replyAt, replyType);
        }
      } catch {
        // thread may be deleted
      }
    }
  }
}

function normalizeMsgId(id: string): string {
  return id.replace(/^<|>$/g, "").trim();
}

async function checkZohoReplies() {
  const accounts = await prisma.emailAccount.findMany({
    where: { accountType: "zoho", isActive: true },
  });

  for (const account of accounts) {
    const password = getDecryptedPassword(account);
    if (!password) continue;

    const sent = await prisma.sentEmail.findMany({
      where: { accountId: account.id, status: "sent", messageId: { not: null } },
      include: { lead: true },
    });

    if (sent.length === 0) continue;

    const ourIds = new Set(sent.map((s) => normalizeMsgId(s.messageId!)).filter(Boolean));

    try {
      await new Promise<void>((resolve, reject) => {
        const imapHost = account.zohoProServers ? "imappro.zoho.com" : "imap.zoho.com";
        const imap = new Imap({
          user: account.email,
          password,
          host: imapHost,
          port: 993,
          tls: true,
        });

        type MatchInfo = { id: string; leadId: string; campaignId: string; uid: number };
        const matchesFound = new Map<string, MatchInfo>();

        imap.once("ready", () => {
          imap.openBox("INBOX", false, (err) => {
            if (err) {
              imap.end();
              return reject(err);
            }
            imap.search(["ALL"], (searchErr, uids) => {
              if (searchErr || !uids?.length) {
                imap.end();
                return resolve();
              }
              const fetch = imap.fetch(uids.slice(-200), {
                bodies: "HEADER.FIELDS (IN-REPLY-TO REFERENCES)",
                struct: true,
              });
              fetch.on("message", (msg) => {
                const state: { uid?: number; matchData?: { id: string; leadId: string; campaignId: string } } = {};
                msg.on("attributes", (attrs: { uid?: number }) => {
                  state.uid = attrs.uid;
                  if (state.matchData && state.uid != null && !matchesFound.has(state.matchData.id)) {
                    matchesFound.set(state.matchData.id, { ...state.matchData, uid: state.uid });
                  }
                });
                msg.on("body", (stream: NodeJS.ReadableStream) => {
                  let buf = "";
                  stream.on("data", (chunk: Buffer) => {
                    buf += chunk.toString();
                  });
                  stream.on("end", () => {
                    const folded = buf.replace(/\r?\n[\s]+/g, " ");
                    const inReplyTo = folded.match(/In-Reply-To:\s*(.+?)(?:\r?\n|$)/i)?.[1]?.trim();
                    const refs = folded.match(/References:\s*(.+?)(?:\r?\n|$)/i)?.[1]?.trim()?.split(/\s+/) || [];
                    const ids = [inReplyTo, ...refs].filter((x): x is string => Boolean(x)).map(normalizeMsgId);
                    for (const id of ids) {
                      if (ourIds.has(id)) {
                        const match = sent.find((s) => normalizeMsgId(s.messageId!) === id);
                        if (match && !matchesFound.has(match.id)) {
                          const matchData = { id: match.id, leadId: match.leadId, campaignId: match.campaignId };
                          if (state.uid != null) {
                            matchesFound.set(match.id, { ...matchData, uid: state.uid });
                          } else {
                            state.matchData = matchData;
                          }
                        }
                        break;
                      }
                    }
                  });
                });
              });
              fetch.once("end", () => {
                const matchedUids = [...matchesFound.values()].map((m) => m.uid).filter((u): u is number => u != null);
                if (matchedUids.length === 0) {
                  imap.end();
                  return resolve();
                }
                // Second fetch: get body for matched messages
                const fetchStream = imap.fetch(matchedUids, { bodies: "" });
                const bodyByUid = new Map<number, { body: string; replyAt: Date }>();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                fetchStream.on("message", (msg: any) => {
                    let msgUid: number | undefined;
                    let replyAt = new Date();
                    let fullRaw = "";
                    msg.on("attributes", (attrs: { uid?: number; date?: Date }) => {
                      msgUid = attrs.uid;
                      if (attrs.date) replyAt = attrs.date;
                    });
                    msg.on("body", (stream: NodeJS.ReadableStream) => {
                      stream.on("data", (chunk: Buffer) => {
                        fullRaw += chunk.toString("utf-8");
                      });
                    });
                    msg.on("end", () => {
                      const body = extractZohoBodyFromRaw(fullRaw);
                      if (msgUid != null) bodyByUid.set(msgUid, { body, replyAt });
                    });
                  });
                fetchStream.once("end", async () => {
                    imap.end();
                    for (const match of matchesFound.values()) {
                      try {
                        const entry = bodyByUid.get(match.uid);
                        const replyBody = entry?.body ?? "";
                        const replyAt = entry?.replyAt ?? new Date();
                        const sentRec = sent.find((x) => x.id === match.id);
                        if (!sentRec) continue;
                        const ourSentAt = sentRec.sentAt ? new Date(sentRec.sentAt) : new Date(0);
                        const replySubject = ""; // Zoho: subject not easily available in this flow
                        const replyType = detectReplyType(replyBody, replySubject, ourSentAt, replyAt);

                        await applyReplyUpdate(
                          match.id,
                          match.leadId,
                          match.campaignId,
                          replyBody,
                          replyAt,
                          replyType
                        );
                      } catch (e) {
                        logger.error("Zoho reply update failed", { match, error: e });
                      }
                    }
                    resolve();
                });
              });
            });
          });
        });
        imap.once("error", reject);
        imap.connect();
      });
    } catch (e) {
      logger.warn("Zoho IMAP check failed", { accountId: account.id, error: e });
    }
  }
}

/** Decode MIME part body by Content-Transfer-Encoding */
function decodePartBody(raw: string, headersSection: string): string {
  const enc = headersSection.match(/content-transfer-encoding:\s*(\S+)/i)?.[1]?.toLowerCase();
  const trimmed = raw.replace(/\r?\n$/, "").trim();
  if (enc === "base64") {
    try {
      return Buffer.from(trimmed.replace(/\s/g, ""), "base64").toString("utf-8");
    } catch {
      return trimmed;
    }
  }
  if (enc === "quoted-printable") {
    return trimmed
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/_/g, " ");
  }
  return trimmed;
}

/** Extract plain text body from raw MIME message (simple parser) */
function extractZohoBodyFromRaw(raw: string): string {
  const parts = raw.split(/\r?\n\r?\n/);
  if (parts.length < 2) return "";
  const headers = parts[0].toLowerCase();
  const bodyRaw = parts.slice(1).join("\n\n");
  const isMultipart = headers.includes("multipart/");
  if (!isMultipart) {
    const body = decodePartBody(bodyRaw, parts[0]);
    if (headers.includes("text/html")) {
      return body.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
    }
    return body.trim();
  }
  const boundaryMatch = headers.match(/boundary="?([^";\s]+)"?/);
  if (!boundaryMatch) return "";
  const boundary = boundaryMatch[1].trim();
  const boundaryStr = `--${boundary}`;
  const sections = raw.split(boundaryStr);
  let text = "";
  for (const section of sections.slice(1, -1)) {
    const subParts = section.split(/\r?\n\r?\n/, 2);
    if (subParts.length < 2) continue;
    const subHeaders = subParts[0].toLowerCase();
    const subBodyRaw = subParts[1].split(/\r?\n--/)[0].trim();
    const subBody = decodePartBody(subBodyRaw, subParts[0]);
    if (subHeaders.includes("text/plain")) {
      text = subBody;
      break;
    }
    if (subHeaders.includes("text/html") && !text) {
      text = subBody.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
    }
  }
  return text;
}

export async function checkReplies() {
  await checkGmailReplies();
  await checkZohoReplies();
}
