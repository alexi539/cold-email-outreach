import { google } from "googleapis";
import Imap from "imap";
import { prisma } from "../lib/prisma.js";
import { logger, formatError } from "../lib/logger.js";
import { getDecryptedOAuth, getDecryptedPassword } from "../lib/accounts.js";
import { updateCampaignStatusFromCompletion } from "./campaignCompletion.js";
import { extractGmailBody } from "../lib/gmailBody.js";
import { detectReplyType } from "../lib/replyType.js";
import type { gmail_v1 } from "googleapis";

const GMAIL_BATCH_LIMIT = Number(process.env.REPLY_CHECK_GMAIL_LIMIT) || 150;
const GMAIL_REQUEST_DELAY_MS = 100;

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

async function applyReplyBodyOnlyUpdate(sentEmailId: string, replyBody: string) {
  await prisma.sentEmail.update({
    where: { id: sentEmailId },
    data: { replyBody },
  });
  logger.info("Reply body backfilled", { sentEmailId });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
      where: {
        accountId: account.id,
        gmailThreadId: { not: null },
      },
      include: { lead: true, replyMessages: true },
      take: GMAIL_BATCH_LIMIT,
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
        messages.sort(
          (a, b) =>
            (typeof a.internalDate === "string" ? parseInt(a.internalDate, 10) : 0) -
            (typeof b.internalDate === "string" ? parseInt(b.internalDate, 10) : 0)
        );
        const ourSentAt = s.sentAt ? new Date(s.sentAt) : new Date(0);
        const ourSentAtMs = ourSentAt.getTime();
        const existingIds = new Set(s.replyMessages.map((r: { externalId: string }) => r.externalId));

        const messagesAfterOurs = messages.filter((m) => {
          const msgTime = typeof m.internalDate === "string" ? parseInt(m.internalDate, 10) : 0;
          return msgTime > ourSentAtMs;
        });

        let latestLeadReply: { body: string; at: Date; type: "human" | "bounce" | "auto_reply" } | null = null;

        for (const msg of messagesAfterOurs) {
          const gmailMsgId = String(msg.id ?? "");
          const externalId = `gmail:${gmailMsgId}`;
          if (existingIds.has(externalId)) continue;

          const from = msg.payload?.headers?.find((h) => h.name?.toLowerCase() === "from")?.value || "";
          const fromUs = from.toLowerCase().includes(account.email);

          const replyAt = new Date(
            typeof msg.internalDate === "string" ? parseInt(msg.internalDate, 10) : Date.now()
          );

          if (fromUs) {
            await prisma.replyMessage.upsert({
              where: { externalId },
              create: {
                sentEmailId: s.id,
                externalId,
                replyAt,
                fromUs: true,
              },
              update: {},
            });
          } else {
            const extractOpts = { gmail, userId: "me", messageId: gmailMsgId };
            const replyBody = await extractGmailBody(msg.payload, extractOpts);
            const replySubject =
              msg.payload?.headers?.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
            const replyType = detectReplyType(replyBody, replySubject, ourSentAt, replyAt);

            await prisma.replyMessage.upsert({
              where: { externalId },
              create: {
                sentEmailId: s.id,
                externalId,
                replyAt,
                replyBody,
                replyType,
                fromUs: false,
              },
              update: { replyBody: replyBody || undefined, replyType },
            });

            latestLeadReply = { body: replyBody, at: replyAt, type: replyType };
          }

          await sleep(GMAIL_REQUEST_DELAY_MS);
        }

        const allLeadReplies = await prisma.replyMessage.findMany({
          where: { sentEmailId: s.id, fromUs: false },
          orderBy: { replyAt: "desc" },
          take: 1,
        });
        const latestRm = allLeadReplies[0];

        if (latestRm) {
          const replyType = (latestRm.replyType || "human") as "human" | "bounce" | "auto_reply";
          const status = replyType === "human" ? "replied" : replyType;
          const needsUpdate =
            s.status !== status ||
            s.replyBody !== latestRm.replyBody ||
            !s.replyAt ||
            new Date(s.replyAt).getTime() !== latestRm.replyAt.getTime();

          if (needsUpdate) {
            await prisma.$transaction([
              prisma.sentEmail.update({
                where: { id: s.id },
                data: {
                  status,
                  replyBody: latestRm.replyBody,
                  replyAt: latestRm.replyAt,
                  replyType,
                },
              }),
              prisma.lead.update({
                where: { id: s.leadId },
                data: { status },
              }),
            ]);
            if (latestLeadReply) {
              logger.info("Reply detected", {
                leadId: s.leadId,
                replyType: latestLeadReply.type,
                campaignId: s.campaignId,
              });
              updateCampaignStatusFromCompletion(s.campaignId).catch((e) =>
                logger.error("Campaign completion check after reply", { campaignId: s.campaignId, error: e })
              );
            }
          }
        }

        await sleep(GMAIL_REQUEST_DELAY_MS);
      } catch (e) {
        logger.warn("Reply check failed for thread", {
          sentEmailId: s.id,
          gmailThreadId: s.gmailThreadId,
          error: formatError(e),
        });
      }
    }
  }
}

function normalizeMsgId(id: string): string {
  return id.replace(/^<|>$/g, "").replace(/\s+/g, "").trim();
}

const ZOHO_FETCH_LIMIT = 500;
const ZOHO_FOLDERS = ["INBOX", "Sent", "Sent Items", "Junk", "Spam"] as const;

async function checkZohoReplies() {
  const accounts = await prisma.emailAccount.findMany({
    where: { accountType: "zoho", isActive: true },
  });

  for (const account of accounts) {
    const password = getDecryptedPassword(account);
    if (!password) continue;

    const sent = await prisma.sentEmail.findMany({
      where: {
        accountId: account.id,
        messageId: { not: null },
      },
      include: { lead: true },
    });

    if (sent.length === 0) continue;

    const ourIds = new Set(sent.map((s: { messageId: string | null }) => normalizeMsgId(s.messageId!)).filter(Boolean));
    logger.info("Zoho reply check start", {
      accountId: account.id,
      accountEmail: account.email,
      sentCount: sent.length,
      ourIdsSample: [...ourIds].slice(0, 3),
    });

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

        type MatchInfo = {
          sentEmailId: string;
          leadId: string;
          campaignId: string;
          uid: number;
          folder: string;
          fromUs: boolean;
        };
        const matchesFound: MatchInfo[] = [];

        function processFolder(folder: string, cb: (err?: Error) => void) {
          imap.openBox(folder, false, (err) => {
            if (err) {
              if (folder !== "INBOX") {
                return cb();
              }
              imap.end();
              return reject(err);
            }
            imap.search(["ALL"], (searchErr, uids) => {
              if (searchErr || !uids?.length) return cb();
              const fetch = imap.fetch(uids.slice(-ZOHO_FETCH_LIMIT), { bodies: "" });
              const rawByUid = new Map<number, { raw: string; replyAt: Date }>();
              const seenExternalIds = new Set<string>();
              fetch.on("message", (msg) => {
                const state: { uid?: number } = {};
                let fullRaw = "";
                msg.on("attributes", (attrs: { uid?: number; date?: Date }) => {
                  state.uid = attrs.uid;
                  if (state.uid != null) {
                    rawByUid.set(state.uid, { raw: "", replyAt: attrs.date ?? new Date() });
                  }
                });
                msg.on("body", (stream: NodeJS.ReadableStream) => {
                  stream.on("data", (chunk: Buffer) => {
                    fullRaw += chunk.toString("utf-8");
                  });
                });
                msg.on("end", () => {
                  if (state.uid == null) return;
                  const prev = rawByUid.get(state.uid);
                  rawByUid.set(state.uid, { raw: fullRaw, replyAt: prev?.replyAt ?? new Date() });
                  const headerEnd = fullRaw.indexOf("\r\n\r\n");
                  const headerSection = headerEnd >= 0 ? fullRaw.slice(0, headerEnd) : fullRaw;
                  const folded = headerSection.replace(/\r?\n[\s]+/g, " ");
                  const from = folded.match(/From:\s*(.+?)(?:\r?\n|$)/i)?.[1]?.trim() || "";
                  const fromUs = from.toLowerCase().includes(account.email);
                  const inReplyTo = folded.match(/In-Reply-To:\s*(.+?)(?:\r?\n|$)/i)?.[1]?.trim();
                  const refs = folded.match(/References:\s*(.+?)(?:\r?\n|$)/i)?.[1]?.trim()?.split(/\s+/) || [];
                  let ids = [inReplyTo, ...refs].filter((x): x is string => Boolean(x)).map(normalizeMsgId);
                  if (ids.length === 0) {
                    for (const id of ourIds as Iterable<string>) {
                      if (fullRaw.includes(id) || fullRaw.includes(`<${id}>`)) {
                        ids = [id];
                        break;
                      }
                    }
                  }
                  for (const id of ids) {
                    if (ourIds.has(id)) {
                      const matched = sent.filter((s: { id: string; messageId: string | null }) => normalizeMsgId(s.messageId!) === id);
                      for (const m of matched) {
                        const extId = `zoho:${m.id}:${folder}:${state.uid}`;
                        if (seenExternalIds.has(extId)) continue;
                        seenExternalIds.add(extId);
                        matchesFound.push({
                          sentEmailId: m.id,
                          leadId: m.leadId,
                          campaignId: m.campaignId,
                          uid: state.uid,
                          folder,
                          fromUs,
                        });
                      }
                      break;
                    }
                  }
                });
              });
              fetch.once("end", () => {
                const folderMatches = matchesFound.filter((m) => m.folder === folder);
                if (folderMatches.length > 0) {
                  logger.info("Zoho folder matches", {
                    folder,
                    matchCount: folderMatches.length,
                    sentEmailIds: [...new Set(folderMatches.map((m) => m.sentEmailId))],
                  });
                }
                if (folderMatches.length === 0) return cb();
                const bodyByUid = new Map<number, { body: string; replyAt: Date }>();
                for (const m of folderMatches) {
                  const entry = rawByUid.get(m.uid);
                  if (entry) {
                    const body = extractZohoBodyFromRaw(entry.raw);
                    bodyByUid.set(m.uid, { body, replyAt: entry.replyAt });
                  }
                }
                void (async () => {
                  for (const match of folderMatches) {
                    try {
                      const entry = bodyByUid.get(match.uid);
                      const replyBody = match.fromUs ? "" : (entry?.body ?? "");
                      const replyAt = entry?.replyAt ?? new Date();
                      const externalId = `zoho:${match.sentEmailId}:${folder}:${match.uid}`;
                      await prisma.replyMessage.upsert({
                        where: { externalId },
                        create: {
                          sentEmailId: match.sentEmailId,
                          externalId,
                          replyAt,
                          replyBody: match.fromUs ? null : replyBody,
                          replyType: match.fromUs ? null : (replyBody ? detectReplyType(replyBody, "", new Date(0), replyAt) : null),
                          fromUs: match.fromUs,
                        },
                        update: match.fromUs ? {} : { replyBody: replyBody || undefined },
                      });
                      if (!match.fromUs && replyBody) {
                        const sentRec = sent.find((x: { id: string }) => x.id === match.sentEmailId);
                        if (sentRec) {
                          const replyType = detectReplyType(replyBody, "", sentRec.sentAt ? new Date(sentRec.sentAt) : new Date(0), replyAt);
                          const allLeadReplies = await prisma.replyMessage.findMany({
                            where: { sentEmailId: match.sentEmailId, fromUs: false },
                            orderBy: { replyAt: "desc" },
                            take: 1,
                          });
                          const latestRm = allLeadReplies[0];
                          if (latestRm) {
                            const status = (latestRm.replyType || "human") === "human" ? "replied" : latestRm.replyType!;
                            await prisma.$transaction([
                              prisma.sentEmail.update({
                                where: { id: match.sentEmailId },
                                data: {
                                  status,
                                  replyBody: latestRm.replyBody,
                                  replyAt: latestRm.replyAt,
                                  replyType: latestRm.replyType,
                                },
                              }),
                              prisma.lead.update({
                                where: { id: match.leadId },
                                data: { status },
                              }),
                            ]);
                            logger.info("Reply detected", {
                              leadId: match.leadId,
                              replyType: latestRm.replyType,
                              campaignId: match.campaignId,
                            });
                            updateCampaignStatusFromCompletion(match.campaignId).catch((e) =>
                              logger.error("Campaign completion check after reply", { campaignId: match.campaignId, error: e })
                            );
                          }
                        }
                      }
                    } catch (e) {
                      logger.error("Zoho reply update failed", { match, error: e });
                    }
                  }
                  cb();
                })();
              });
            });
          });
        }

        imap.once("ready", () => {
          let idx = 0;
          function next() {
            if (idx >= ZOHO_FOLDERS.length) {
              imap.end();
              return resolve();
            }
            processFolder(ZOHO_FOLDERS[idx], (err) => {
              if (err) return reject(err);
              idx++;
              next();
            });
          }
          next();
        });
        imap.once("error", reject);
        imap.connect();
      });
    } catch (e) {
      logger.warn("Zoho IMAP check failed", { accountId: account.id, error: e });
    }
  }
}

function parsePartCharset(headersSection: string): BufferEncoding {
  const match = headersSection.match(/charset\s*=\s*["']?([^"'\s;]+)/i);
  if (!match) return "utf-8";
  const raw = match[1].toLowerCase();
  if (raw === "utf-8" || raw === "utf8") return "utf-8";
  if (raw === "iso-8859-1" || raw === "latin1") return "latin1";
  return "utf-8";
}

/** Decode MIME part body by Content-Transfer-Encoding and charset */
function decodePartBody(raw: string, headersSection: string): string {
  const enc = headersSection.match(/content-transfer-encoding:\s*(\S+)/i)?.[1]?.toLowerCase();
  const charset = parsePartCharset(headersSection);
  const trimmed = raw.replace(/\r?\n$/, "").trim();
  if (enc === "base64") {
    try {
      return Buffer.from(trimmed.replace(/\s/g, ""), "base64").toString(charset);
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract plain text body from raw MIME message (recursive for nested multipart) */
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
  const boundaryMatch = headers.match(/boundary="?\s*[-]?([^";\s]+)"?/i);
  if (!boundaryMatch) return "";
  const boundary = boundaryMatch[1].trim().replace(/^--+/, "");
  const boundaryStr = `--${boundary}`;
  const sections = raw.split(boundaryStr);
  let text = "";
  for (const section of sections.slice(1, -1)) {
    const subParts = section.split(/\r?\n\r?\n/, 2);
    if (subParts.length < 2) continue;
    const subHeaders = subParts[0].toLowerCase();
    const boundaryDelim = new RegExp(`\\r?\\n${escapeRegex(boundaryStr)}(--)?`, "i");
    const subBodyRaw = subParts[1].split(boundaryDelim)[0].trim();
    if (subHeaders.includes("multipart/")) {
      const nestedRaw = subParts[0] + "\n\n" + subParts[1];
      const nested = extractZohoBodyFromRaw(nestedRaw);
      if (nested) {
        text = nested;
        break;
      }
    }
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

/** Refresh reply body for a single sent email (Gmail or Zoho). Used by manual refresh API. */
export async function refreshReplyForSentEmail(sentEmailId: string): Promise<{ updated: boolean; error?: string }> {
  const sent = await prisma.sentEmail.findFirst({
    where: { id: sentEmailId },
    include: { lead: true, account: true },
  });
  if (!sent) return { updated: false, error: "Sent email not found" };
  if (!sent.account) return { updated: false, error: "Account not found" };

  const account = sent.account;

  if (account.accountType === "google" && sent.gmailThreadId) {
    try {
      const tokens = getDecryptedOAuth(account);
      if (!tokens?.refresh_token) return { updated: false, error: "No OAuth tokens" };
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        undefined
      );
      oauth2Client.setCredentials(tokens);
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });
      const { data: thread } = await gmail.users.threads.get({
        userId: "me",
        id: sent.gmailThreadId,
        format: "full",
      });
      const messages = (thread.messages || []) as gmail_v1.Schema$Message[];
      messages.sort(
        (a, b) =>
          (typeof a.internalDate === "string" ? parseInt(a.internalDate, 10) : 0) -
          (typeof b.internalDate === "string" ? parseInt(b.internalDate, 10) : 0)
      );
      const ourSentAt = sent.sentAt ? new Date(sent.sentAt) : new Date(0);
      const ourSentAtMs = ourSentAt.getTime();
      const replyMsg = messages.find((m) => {
        const msgTime = typeof m.internalDate === "string" ? parseInt(m.internalDate, 10) : 0;
        if (msgTime <= ourSentAtMs) return false;
        const from = m.payload?.headers?.find((h) => h.name?.toLowerCase() === "from")?.value || "";
        return !from.toLowerCase().includes(account.email);
      });
      if (!replyMsg) return { updated: false, error: "No reply in thread" };
      const replyAt = new Date(
        typeof replyMsg.internalDate === "string" ? parseInt(replyMsg.internalDate, 10) : Date.now()
      );
      const extractOpts = { gmail, userId: "me", messageId: String(replyMsg.id ?? "") };
      const replyBody = await extractGmailBody(replyMsg.payload, extractOpts);
      const replySubject =
        replyMsg.payload?.headers?.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
      const isRecheck = ["replied", "bounce", "auto_reply"].includes(sent.status) && !sent.replyBody?.trim();
      if (isRecheck && replyBody) {
        await applyReplyBodyOnlyUpdate(sentEmailId, replyBody);
        return { updated: true };
      }
      if (!isRecheck) {
        const replyType = detectReplyType(replyBody, replySubject, ourSentAt, replyAt);
        await applyReplyUpdate(sent.id, sent.leadId, sent.campaignId, replyBody, replyAt, replyType);
        return { updated: true };
      }
      return { updated: false };
    } catch (e) {
      logger.warn("Refresh reply failed", { sentEmailId, error: formatError(e) });
      return { updated: false, error: (e instanceof Error ? e.message : String(e)) };
    }
  }

  if (account.accountType === "zoho" && sent.messageId) {
    return refreshZohoReplyForSentEmail(sent);
  }

  return { updated: false, error: "No gmailThreadId or messageId" };
}

/** Manual refresh of reply body for a single Zoho sent email via IMAP */
async function refreshZohoReplyForSentEmail(sent: {
  id: string;
  leadId: string;
  campaignId: string;
  messageId: string | null;
  replyBody: string | null;
  status: string;
  sentAt: Date | null;
  account: { id: string; email: string; zohoProServers: boolean | null; smtpPasswordEncrypted: string | null };
}): Promise<{ updated: boolean; error?: string }> {
  if (!sent.messageId) return { updated: false, error: "No messageId" };
  const password = getDecryptedPassword(sent.account);
  if (!password) return { updated: false, error: "No password for Zoho account" };

  const ourId = normalizeMsgId(sent.messageId);
  const imapHost = sent.account.zohoProServers ? "imappro.zoho.com" : "imap.zoho.com";

  try {
    const result = await new Promise<{ body: string; replyAt: Date } | null>((resolve, reject) => {
      const imap = new Imap({
        user: sent.account.email,
        password,
        host: imapHost,
        port: 993,
        tls: true,
      });

      let found: { uid: number; folder: string; raw: string; replyAt: Date } | null = null;

      function processFolder(folder: string, cb: (err?: Error) => void) {
        imap.openBox(folder, false, (err) => {
          if (err) {
            if (folder !== "INBOX") return cb();
            imap.end();
            return reject(err);
          }
          imap.search(["ALL"], (searchErr, uids) => {
            if (searchErr || !uids?.length) return cb();
            const fetch = imap.fetch(uids.slice(-ZOHO_FETCH_LIMIT), { bodies: "" });
            fetch.on("message", (msg) => {
              const state: { uid?: number; date?: Date } = {};
              let fullRaw = "";
              msg.on("attributes", (attrs: { uid?: number; date?: Date }) => {
                state.uid = attrs.uid;
                state.date = attrs.date;
              });
              msg.on("body", (stream: NodeJS.ReadableStream) => {
                stream.on("data", (chunk: Buffer) => {
                  fullRaw += chunk.toString("utf-8");
                });
              });
              msg.on("end", () => {
                const headerEnd = fullRaw.indexOf("\r\n\r\n");
                const headerSection = headerEnd >= 0 ? fullRaw.slice(0, headerEnd) : fullRaw;
                const folded = headerSection.replace(/\r?\n[\s]+/g, " ");
                const inReplyTo = folded.match(/In-Reply-To:\s*(.+?)(?:\r?\n|$)/i)?.[1]?.trim();
                const refs = folded.match(/References:\s*(.+?)(?:\r?\n|$)/i)?.[1]?.trim()?.split(/\s+/) || [];
                let ids = [inReplyTo, ...refs].filter((x): x is string => Boolean(x)).map(normalizeMsgId);
                if (ids.length === 0 && (fullRaw.includes(ourId) || fullRaw.includes(`<${ourId}>`))) {
                  ids = [ourId];
                }
                if (ids.some((id) => id === ourId) && state.uid != null && !found) {
                  found = { uid: state.uid, folder, raw: fullRaw, replyAt: state.date ?? new Date() };
                }
              });
            });
            fetch.once("end", () => {
              if (found) return cb();
              cb();
            });
          });
        });
      }

      imap.once("ready", () => {
        let idx = 0;
        function next() {
          if (found || idx >= ZOHO_FOLDERS.length) {
            if (!found) {
              imap.end();
              return resolve(null);
            }
            imap.end();
            const body = extractZohoBodyFromRaw(found.raw);
            resolve(body ? { body, replyAt: found.replyAt } : null);
          } else {
            processFolder(ZOHO_FOLDERS[idx], (err) => {
              if (err) return reject(err);
              idx++;
              next();
            });
          }
        }
        next();
      });
      imap.once("error", reject);
      imap.connect();
    });

    if (!result) {
      return { updated: false, error: "Reply not found in INBOX/Sent/Junk/Spam" };
    }
    if (!result.body) {
      return { updated: false, error: "Reply found but body extraction failed" };
    }

    const ourSentAt = sent.sentAt ? new Date(sent.sentAt) : new Date(0);
    const isRecheck = ["replied", "bounce", "auto_reply"].includes(sent.status) && !sent.replyBody?.trim();
    if (isRecheck) {
      await applyReplyBodyOnlyUpdate(sent.id, result.body);
      return { updated: true };
    }
    const replyType = detectReplyType(result.body, "", ourSentAt, result.replyAt);
    await applyReplyUpdate(sent.id, sent.leadId, sent.campaignId, result.body, result.replyAt, replyType);
    return { updated: true };
  } catch (e) {
    logger.warn("Zoho refresh reply failed", { sentEmailId: sent.id, error: formatError(e) });
    return { updated: false, error: e instanceof Error ? e.message : String(e) };
  }
}

let checkRepliesRunning = false;

export async function checkReplies() {
  if (checkRepliesRunning) return;
  checkRepliesRunning = true;
  try {
    await checkGmailReplies();
    await checkZohoReplies();
  } finally {
    checkRepliesRunning = false;
  }
}
