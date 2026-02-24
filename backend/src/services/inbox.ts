import { google } from "googleapis";
import Imap from "imap";
import { prisma } from "../lib/prisma.js";
import { getDecryptedOAuth, getDecryptedPassword } from "../lib/accounts.js";
import { extractGmailBody } from "../lib/gmailBody.js";
import { extractZohoBodyFromRaw } from "../lib/zohoBody.js";
import { isSpamTrackingPattern } from "../lib/spamFilter.js";
import { logger, formatError } from "../lib/logger.js";
import { sendGmail } from "./gmail.js";
import { sendZoho } from "./zoho.js";
import type { gmail_v1 } from "googleapis";

export interface InboxMessageListItem {
  id: string;
  accountId: string;
  accountEmail: string;
  accountType: "google" | "zoho";
  threadId?: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
}

export interface InboxMessageFull extends InboxMessageListItem {
  body: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  sentEmail?: {
    id: string;
    campaignId: string;
    campaign?: { name: string };
    lead?: { email: string };
  };
}

export interface InboxThreadMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  messageId?: string;
  isFromUs?: boolean;
}

export interface InboxThreadResponse {
  messages: InboxThreadMessage[];
  accountId: string;
  accountEmail: string;
}

const DEFAULT_LIMIT = 50;
const GMAIL_REQUEST_DELAY_MS = 50;

function getHeader(payload: gmail_v1.Schema$MessagePart | undefined, name: string): string {
  const h = payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value?.trim() || "";
}

function extractEmailFromHeader(s: string): string {
  const m = /<([^>]+)>/.exec(s);
  if (m) return m[1].trim().toLowerCase();
  return s.trim().toLowerCase();
}

function parseHeadersFromRaw(raw: string): Record<string, string> {
  const headerEnd = raw.indexOf("\r\n\r\n");
  const headerSection = headerEnd >= 0 ? raw.slice(0, headerEnd) : raw;
  const folded = headerSection.replace(/\r?\n[\s]+/g, " ");
  const result: Record<string, string> = {};
  const regex = /^([^:]+):\s*(.+?)(?:\r?\n|$)/gm;
  let m;
  while ((m = regex.exec(folded)) !== null) {
    const key = m[1].trim().toLowerCase();
    const val = m[2].trim();
    result[key] = val;
  }
  return result;
}

async function findSentEmailForMessage(
  accountId: string,
  accountType: string,
  threadId: string | undefined,
  messageId: string | undefined,
  references: string | undefined,
  inReplyTo: string | undefined
): Promise<InboxMessageFull["sentEmail"] | undefined> {
  if (accountType === "google" && threadId) {
    const sent = await prisma.sentEmail.findFirst({
      where: { accountId, gmailThreadId: threadId },
      include: { campaign: true, lead: true },
    });
    if (sent) {
      return {
        id: sent.id,
        campaignId: sent.campaignId,
        campaign: sent.campaign ? { name: sent.campaign.name } : undefined,
        lead: sent.lead ? { email: sent.lead.email } : undefined,
      };
    }
  }

  const ids = [messageId, inReplyTo, ...(references?.split(/\s+/) || [])].filter(Boolean);
  const normalized = ids.map((id) => id!.replace(/^<|>$/g, "").replace(/\s+/g, "").trim());

  for (const id of normalized) {
    const sent = await prisma.sentEmail.findFirst({
      where: {
        accountId,
        messageId: { contains: id },
      },
      include: { campaign: true, lead: true },
    });
    if (sent) {
      return {
        id: sent.id,
        campaignId: sent.campaignId,
        campaign: sent.campaign ? { name: sent.campaign.name } : undefined,
        lead: sent.lead ? { email: sent.lead.email } : undefined,
      };
    }
  }
  return undefined;
}

export async function listUnifiedInbox(
  opts?: { limit?: number; pageToken?: string }
): Promise<{ messages: InboxMessageListItem[]; nextPageToken?: string }> {
  const accounts = await prisma.emailAccount.findMany({
    where: { isActive: true },
  });
  if (accounts.length === 0) {
    return { messages: [] };
  }

  const limit = Math.min(opts?.limit ?? DEFAULT_LIMIT, 100);
  let cursor: Record<string, string> = {};
  try {
    if (opts?.pageToken) {
      cursor = JSON.parse(Buffer.from(opts.pageToken, "base64url").toString("utf-8"));
    }
  } catch {
    cursor = {};
  }

  const results = await Promise.all(
    accounts.map((acc) =>
      listInboxMessages(acc.id, {
        limit,
        pageToken: cursor[acc.id],
      })
    )
  );

  const merged: InboxMessageListItem[] = [];
  const nextTokens: Record<string, string> = {};
  for (let i = 0; i < accounts.length; i++) {
    merged.push(...results[i].messages);
    if (results[i].nextPageToken) {
      nextTokens[accounts[i].id] = results[i].nextPageToken!;
    }
  }

  merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const messages = merged.slice(0, limit);

  const nextPageToken =
    Object.keys(nextTokens).length > 0
      ? Buffer.from(JSON.stringify(nextTokens), "utf-8").toString("base64url")
      : undefined;

  logger.info("Inbox unified list", { count: messages.length });
  return { messages, nextPageToken };
}

export async function listInboxMessages(
  accountId: string,
  opts?: { limit?: number; pageToken?: string }
): Promise<{ messages: InboxMessageListItem[]; nextPageToken?: string }> {
  const account = await prisma.emailAccount.findUnique({
    where: { id: accountId, isActive: true },
  });
  if (!account) throw new Error("Account not found");

  const limit = Math.min(opts?.limit ?? DEFAULT_LIMIT, 100);

  if (account.accountType === "google") {
    return listGmailInbox(account, limit, opts?.pageToken);
  }
  if (account.accountType === "zoho") {
    return listZohoInbox(account, limit, opts?.pageToken);
  }
  throw new Error("Unsupported account type");
}

async function listGmailInbox(
  account: { id: string; email: string; oauthTokens: string | null },
  limit: number,
  pageToken?: string
): Promise<{ messages: InboxMessageListItem[]; nextPageToken?: string }> {
  const tokens = getDecryptedOAuth(account);
  if (!tokens?.refresh_token) throw new Error("No OAuth tokens for account " + account.email);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    undefined
  );
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const listRes = await gmail.users.messages.list({
    userId: "me",
    labelIds: ["INBOX"],
    maxResults: limit,
    pageToken: pageToken || undefined,
  });

  const items = listRes.data.messages || [];
  const messages: InboxMessageListItem[] = [];

  for (const item of items) {
    const id = String(item.id ?? "");
    const threadId = String(item.threadId ?? "");
    try {
      const { data } = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date", "Message-ID"],
      });
      const payload = data.payload;
      const from = getHeader(payload, "From");
      const to = getHeader(payload, "To");
      const subject = getHeader(payload, "Subject");
      const date = data.internalDate
        ? new Date(parseInt(String(data.internalDate), 10)).toISOString()
        : new Date().toISOString();
      const snippet = (data.snippet || "").slice(0, 200);
      const unread = (data.labelIds || []).includes("UNREAD");

      if (isSpamTrackingPattern(subject) || isSpamTrackingPattern(snippet)) continue;

      messages.push({
        id,
        accountId: account.id,
        accountEmail: account.email,
        accountType: "google",
        threadId: threadId || undefined,
        from,
        to,
        subject,
        date,
        snippet,
        unread,
      });
    } catch (e) {
      logger.warn("Inbox list: Gmail message fetch failed", { id, error: formatError(e) });
    }
    await new Promise((r) => setTimeout(r, GMAIL_REQUEST_DELAY_MS));
  }

  logger.info("Inbox list", { accountId: account.id, count: messages.length });
  return {
    messages,
    nextPageToken: listRes.data.nextPageToken ?? undefined,
  };
}

async function listZohoInbox(
  account: {
    id: string;
    email: string;
    smtpPasswordEncrypted: string | null;
    zohoProServers: boolean | null;
  },
  limit: number,
  pageToken?: string
): Promise<{ messages: InboxMessageListItem[]; nextPageToken?: string }> {
  const password = getDecryptedPassword(account);
  if (!password) throw new Error("No SMTP password for account " + account.email);

  const imapHost = account.zohoProServers ? "imappro.zoho.com" : "imap.zoho.com";

  const result = await new Promise<{
    messages: InboxMessageListItem[];
    nextPageToken?: string;
  }>((resolve, reject) => {
    const imap = new Imap({
      user: account.email,
      password,
      host: imapHost,
      port: 993,
      tls: true,
    });

    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err) => {
        if (err) {
          imap.end();
          return reject(err);
        }
        imap.search(["ALL"], (searchErr, uids) => {
          if (searchErr || !uids?.length) {
            imap.end();
            return resolve({ messages: [] });
          }

          let beforeUid = pageToken ? parseInt(pageToken, 10) : Infinity;
          let uidsToFetch = uids;
          if (beforeUid < Infinity) {
            uidsToFetch = uids.filter((u) => u < beforeUid);
          }
          const slice = uidsToFetch.slice(-limit);
          if (slice.length === 0) {
            imap.end();
            return resolve({ messages: [] });
          }

          const fetch = imap.fetch(slice, { bodies: "" });
          const rawByUid = new Map<number, string>();
          const flagsByUid = new Map<number, string[]>();

          fetch.on("message", (msg) => {
            const state: { uid?: number; flags?: string[] } = {};
            let fullRaw = "";
            msg.on("attributes", (attrs: { uid?: number; flags?: string[] }) => {
              state.uid = attrs.uid;
              state.flags = attrs.flags || [];
            });
            msg.on("body", (stream: NodeJS.ReadableStream) => {
              stream.on("data", (chunk: Buffer) => {
                fullRaw += chunk.toString("utf-8");
              });
            });
            msg.on("end", () => {
              if (state.uid != null) {
                rawByUid.set(state.uid, fullRaw);
                flagsByUid.set(state.uid, state.flags || []);
              }
            });
          });

          fetch.once("end", () => {
            imap.end();
            const messages: InboxMessageListItem[] = [];
            const sortedUids = [...slice].sort((a, b) => b - a);
            for (const uid of sortedUids) {
              const raw = rawByUid.get(uid);
              const flags = flagsByUid.get(uid) || [];
              if (!raw) continue;
              const headers = parseHeadersFromRaw(raw);
              const from = headers["from"] || "";
              const to = headers["to"] || "";
              const subject = headers["subject"] || "";
              const dateStr = headers["date"] || "";
              let date: Date;
              try {
                date = new Date(dateStr);
              } catch {
                date = new Date();
              }
              const headerEnd = raw.indexOf("\r\n\r\n");
              const bodyStart = headerEnd >= 0 ? headerEnd + 4 : 0;
              const snippet = raw.slice(bodyStart, bodyStart + 200).replace(/\s+/g, " ").trim();

              if (isSpamTrackingPattern(subject) || isSpamTrackingPattern(snippet)) continue;

              messages.push({
                id: `zoho:${account.id}:${uid}`,
                accountId: account.id,
                accountEmail: account.email,
                accountType: "zoho",
                from,
                to,
                subject,
                date: date.toISOString(),
                snippet,
                unread: !flags.includes("\\Seen"),
              });
            }
            const minUid = Math.min(...slice);
            const nextPageToken = minUid > 1 ? String(minUid - 1) : undefined;
            resolve({ messages, nextPageToken });
          });
        });
      });
    });
    imap.once("error", reject);
    imap.connect();
  });

  logger.info("Inbox list", { accountId: account.id, count: result.messages.length });
  return result;
}

export async function getInboxMessage(
  accountId: string,
  messageId: string
): Promise<InboxMessageFull> {
  const account = await prisma.emailAccount.findUnique({
    where: { id: accountId, isActive: true },
  });
  if (!account) throw new Error("Account not found");

  if (account.accountType === "google") {
    return getGmailMessage(account, messageId);
  }
  if (account.accountType === "zoho") {
    const match = messageId.match(/^zoho:(.+):(\d+)$/);
    const uid = match ? parseInt(match[2], 10) : parseInt(messageId, 10);
    if (isNaN(uid)) throw new Error("Invalid Zoho message ID");
    return getZohoMessage(account, uid);
  }
  throw new Error("Unsupported account type");
}

export async function getInboxThread(
  accountId: string,
  messageId: string
): Promise<InboxThreadResponse> {
  const account = await prisma.emailAccount.findUnique({
    where: { id: accountId, isActive: true },
  });
  if (!account) throw new Error("Account not found");

  if (account.accountType === "google") {
    return getGmailThread(account, messageId);
  }
  if (account.accountType === "zoho") {
    const match = messageId.match(/^zoho:(.+):(\d+)$/);
    const uid = match ? parseInt(match[2], 10) : parseInt(messageId, 10);
    if (isNaN(uid)) throw new Error("Invalid Zoho message ID");
    return getZohoThread(account, uid);
  }
  throw new Error("Unsupported account type");
}

async function getGmailThread(
  account: { id: string; email: string; oauthTokens: string | null },
  gmailMessageId: string
): Promise<InboxThreadResponse> {
  const tokens = getDecryptedOAuth(account);
  if (!tokens?.refresh_token) throw new Error("No OAuth tokens for account " + account.email);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    undefined
  );
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const { data: msgData } = await gmail.users.messages.get({
    userId: "me",
    id: gmailMessageId,
    format: "metadata",
    metadataHeaders: ["Message-ID"],
  });
  const threadId = String(msgData.threadId ?? "");
  if (!threadId) throw new Error("Message not found");

  const { data: thread } = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });

  const rawMessages = (thread.messages || []) as gmail_v1.Schema$Message[];
  rawMessages.sort(
    (a, b) =>
      (typeof a.internalDate === "string" ? parseInt(a.internalDate, 10) : 0) -
      (typeof b.internalDate === "string" ? parseInt(b.internalDate, 10) : 0)
  );

  const messages: InboxThreadMessage[] = [];
  for (const msg of rawMessages) {
    const payload = msg.payload;
    const from = getHeader(payload, "From");
    const to = getHeader(payload, "To");
    const subject = getHeader(payload, "Subject");
    const date =
      msg.internalDate && typeof msg.internalDate === "string"
        ? new Date(parseInt(msg.internalDate, 10)).toISOString()
        : new Date().toISOString();
    const id = String(msg.id ?? "");

    const body = await extractGmailBody(payload, {
      gmail,
      userId: "me",
      messageId: id,
    });

    if (isSpamTrackingPattern(subject) || isSpamTrackingPattern(body)) continue;

    const fromEmail = extractEmailFromHeader(from);
    const isFromUs = account.email.toLowerCase() === fromEmail;

    messages.push({
      id,
      from,
      to,
      subject,
      date,
      body,
      messageId: getHeader(payload, "Message-ID") || undefined,
      isFromUs,
    });
  }

  logger.info("Inbox thread fetch", { accountId: account.id, threadId, count: messages.length });
  return {
    messages,
    accountId: account.id,
    accountEmail: account.email,
  };
}

const ZOHO_THREAD_FETCH_LIMIT = 300;

async function getZohoThread(
  account: {
    id: string;
    email: string;
    smtpPasswordEncrypted: string | null;
    zohoProServers: boolean | null;
  },
  targetUid: number
): Promise<InboxThreadResponse> {
  const password = getDecryptedPassword(account);
  if (!password) throw new Error("No SMTP password for account " + account.email);

  const imapHost = account.zohoProServers ? "imappro.zoho.com" : "imap.zoho.com";

  type MsgMeta = {
    uid: number;
    raw: string;
    from: string;
    to: string;
    subject: string;
    date: string;
    messageId: string;
    inReplyTo: string;
    references: string;
  };

  const allMessages = await new Promise<MsgMeta[]>((resolve, reject) => {
    const imap = new Imap({
      user: account.email,
      password,
      host: imapHost,
      port: 993,
      tls: true,
    });

    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err) => {
        if (err) {
          imap.end();
          return reject(err);
        }
        imap.search(["ALL"], (searchErr, uids) => {
          if (searchErr || !uids?.length) {
            imap.end();
            return resolve([]);
          }
          const sorted = [...uids].sort((a, b) => b - a);
          const slice = sorted.slice(0, ZOHO_THREAD_FETCH_LIMIT);
          const fetch = imap.fetch(slice, { bodies: "" });
          const rawByUid = new Map<number, string>();

          fetch.on("message", (msg) => {
            const state: { uid?: number } = {};
            let fullRaw = "";
            msg.on("attributes", (attrs: { uid?: number }) => {
              state.uid = attrs.uid;
            });
            msg.on("body", (stream: NodeJS.ReadableStream) => {
              stream.on("data", (chunk: Buffer) => {
                fullRaw += chunk.toString("utf-8");
              });
            });
            msg.on("end", () => {
              if (state.uid != null) rawByUid.set(state.uid, fullRaw);
            });
          });

          fetch.once("end", () => {
            imap.end();
            const result: MsgMeta[] = [];
            for (const uid of slice) {
              const raw = rawByUid.get(uid);
              if (!raw) continue;
              const headers = parseHeadersFromRaw(raw);
              const dateStr = headers["date"] || "";
              let date: string;
              try {
                date = new Date(dateStr).toISOString();
              } catch {
                date = new Date().toISOString();
              }
              result.push({
                uid,
                raw,
                from: headers["from"] || "",
                to: headers["to"] || "",
                subject: headers["subject"] || "",
                date,
                messageId: (headers["message-id"] || "").replace(/^<|>$/g, "").trim(),
                inReplyTo: (headers["in-reply-to"] || "").replace(/^<|>$/g, "").trim(),
                references: headers["references"] || "",
              });
            }
            result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            resolve(result);
          });
        });
      });
    });
    imap.once("error", reject);
    imap.connect();
  });

  const normalizeId = (s: string) => s.replace(/^<|>$/g, "").replace(/\s+/g, "").toLowerCase();
  const refIds = (refs: string) =>
    refs
      .split(/\s+/)
      .map((r) => normalizeId(r))
      .filter(Boolean);

  const targetMsg = allMessages.find((m) => m.uid === targetUid);
  if (!targetMsg) throw new Error("Message not found");

  const targetMsgId = normalizeId(targetMsg.messageId);
  const targetRefs = refIds(targetMsg.references);
  const targetInReplyTo = normalizeId(targetMsg.inReplyTo);
  const allIds = new Set<string>([targetMsgId, ...targetRefs, targetInReplyTo].filter(Boolean));

  for (const m of allMessages) {
    const mid = normalizeId(m.messageId);
    const refs = refIds(m.references);
    const inReplyTo = normalizeId(m.inReplyTo);
    if (mid && allIds.has(mid)) continue;
    if (refs.some((r) => allIds.has(r)) || (inReplyTo && allIds.has(inReplyTo))) {
      allIds.add(mid);
      allIds.add(inReplyTo);
      refs.forEach((r) => allIds.add(r));
    }
  }

  for (const m of allMessages) {
    const mid = normalizeId(m.messageId);
    const refs = refIds(m.references);
    const inReplyTo = normalizeId(m.inReplyTo);
    if (!mid && !inReplyTo && refs.length === 0) continue;
    const connected =
      allIds.has(mid) ||
      refs.some((r) => allIds.has(r)) ||
      (inReplyTo && allIds.has(inReplyTo));
    if (connected) {
      allIds.add(mid);
      allIds.add(inReplyTo);
      refs.forEach((r) => allIds.add(r));
    }
  }

  const threadMsgs = allMessages
    .filter((m) => {
      const mid = normalizeId(m.messageId);
      return allIds.has(mid) || m.uid === targetUid;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const messages: InboxThreadMessage[] = [];
  for (const m of threadMsgs) {
    const body = extractZohoBodyFromRaw(m.raw);
    if (isSpamTrackingPattern(m.subject) || isSpamTrackingPattern(body)) continue;

    const fromEmail = extractEmailFromHeader(m.from);
    const isFromUs = account.email.toLowerCase() === fromEmail;

    messages.push({
      id: `zoho:${account.id}:${m.uid}`,
      from: m.from,
      to: m.to,
      subject: m.subject,
      date: m.date,
      body,
      messageId: m.messageId || undefined,
      isFromUs,
    });
  }

  logger.info("Inbox thread fetch", { accountId: account.id, uid: targetUid, count: messages.length });
  return {
    messages,
    accountId: account.id,
    accountEmail: account.email,
  };
}

async function getGmailMessage(
  account: { id: string; email: string; oauthTokens: string | null },
  gmailMessageId: string
): Promise<InboxMessageFull> {
  const tokens = getDecryptedOAuth(account);
  if (!tokens?.refresh_token) throw new Error("No OAuth tokens for account " + account.email);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    undefined
  );
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const { data } = await gmail.users.messages.get({
    userId: "me",
    id: gmailMessageId,
    format: "full",
  });

  const payload = data.payload;
  const from = getHeader(payload, "From");
  const to = getHeader(payload, "To");
  const subject = getHeader(payload, "Subject");
  const date = data.internalDate
    ? new Date(parseInt(String(data.internalDate), 10)).toISOString()
    : new Date().toISOString();
  const snippet = (data.snippet || "").slice(0, 200);
  const unread = (data.labelIds || []).includes("UNREAD");
  const rfcMessageId = getHeader(payload, "Message-ID");
  const references = getHeader(payload, "References");
  const inReplyTo = getHeader(payload, "In-Reply-To");
  const threadId = String(data.threadId ?? "");

  const body = await extractGmailBody(payload, {
    gmail,
    userId: "me",
    messageId: gmailMessageId,
  });

  if (isSpamTrackingPattern(subject) || isSpamTrackingPattern(body)) {
    throw new Error("Message filtered");
  }

  const sentEmail = await findSentEmailForMessage(
    account.id,
    "google",
    threadId || undefined,
    rfcMessageId || undefined,
    references || undefined,
    inReplyTo || undefined
  );

  logger.info("Inbox message fetch", { accountId: account.id, messageId: gmailMessageId });

  return {
    id: gmailMessageId,
    accountId: account.id,
    accountEmail: account.email,
    accountType: "google",
    threadId: threadId || undefined,
    from,
    to,
    subject,
    date,
    snippet,
    unread,
    body,
    messageId: rfcMessageId || undefined,
    inReplyTo: inReplyTo || undefined,
    references: references || undefined,
    sentEmail,
  };
}

async function getZohoMessage(
  account: {
    id: string;
    email: string;
    smtpPasswordEncrypted: string | null;
    zohoProServers: boolean | null;
  },
  uid: number
): Promise<InboxMessageFull> {
  const password = getDecryptedPassword(account);
  if (!password) throw new Error("No SMTP password for account " + account.email);

  const imapHost = account.zohoProServers ? "imappro.zoho.com" : "imap.zoho.com";

  const result = await new Promise<InboxMessageFull>((resolve, reject) => {
    const imap = new Imap({
      user: account.email,
      password,
      host: imapHost,
      port: 993,
      tls: true,
    });

    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err) => {
        if (err) {
          imap.end();
          return reject(err);
        }
        const fetch = imap.fetch([uid], { bodies: "" });
        let fullRaw = "";
        let flags: string[] = [];
        fetch.on("message", (msg) => {
          msg.on("attributes", (attrs: unknown) => {
            const a = attrs as { uid?: number; flags?: string[] };
            flags = a.flags || [];
          });
          msg.on("body", (stream: unknown) => {
            (stream as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
              fullRaw += chunk.toString("utf-8");
            });
          });
        });
        fetch.once("end", () => {
            imap.end();
            if (!fullRaw) {
              reject(new Error("Message not found"));
              return;
            }
            const headers = parseHeadersFromRaw(fullRaw);
            const from = headers["from"] || "";
            const to = headers["to"] || "";
            const subject = headers["subject"] || "";
            const dateStr = headers["date"] || "";
            let date: Date;
            try {
              date = new Date(dateStr);
            } catch {
              date = new Date();
            }
            const body = extractZohoBodyFromRaw(fullRaw);
            const headerEnd = fullRaw.indexOf("\r\n\r\n");
            const bodyStart = headerEnd >= 0 ? headerEnd + 4 : 0;
            const snippet = fullRaw.slice(bodyStart, bodyStart + 200).replace(/\s+/g, " ").trim();
            if (isSpamTrackingPattern(subject) || isSpamTrackingPattern(body)) {
              reject(new Error("Message filtered"));
              return;
            }
            const rfcMessageId = headers["message-id"];
            const references = headers["references"];
            const inReplyTo = headers["in-reply-to"];

            findSentEmailForMessage(
              account.id,
              "zoho",
              undefined,
              rfcMessageId,
              references,
              inReplyTo
            ).then((sentEmail) => {
              resolve({
                id: `zoho:${account.id}:${uid}`,
                accountId: account.id,
                accountEmail: account.email,
                accountType: "zoho",
                from,
                to,
                subject,
                date: date.toISOString(),
                snippet,
                unread: !flags.includes("\\Seen"),
                body,
                messageId: rfcMessageId,
                inReplyTo,
                references,
                sentEmail,
              });
            });
          });
        fetch.on("error", (err: Error) => {
          imap.end();
          reject(err);
        });
      });
    });
    imap.once("error", reject);
    imap.connect();
  });

  logger.info("Inbox message fetch", { accountId: account.id, uid });

  return result;
}

export async function getUnreadCount(
  accountId?: string
): Promise<{ total: number; byAccount?: Record<string, number> }> {
  const where = accountId ? { id: accountId } : {};
  const accounts = await prisma.emailAccount.findMany({
    where: { ...where, isActive: true },
  });

  const byAccount: Record<string, number> = {};
  let total = 0;

  for (const account of accounts) {
    try {
      let count = 0;
      if (account.accountType === "google") {
        count = await getGmailUnreadCount(account);
      } else if (account.accountType === "zoho") {
        count = await getZohoUnreadCount(account);
      }
      byAccount[account.id] = count;
      total += count;
    } catch (e) {
      logger.warn("Inbox unread count failed", { accountId: account.id, error: formatError(e) });
      byAccount[account.id] = 0;
    }
  }

  logger.info("Inbox unread count", { total, byAccount });
  return { total, byAccount };
}

async function getGmailUnreadCount(account: {
  id: string;
  email: string;
  oauthTokens: string | null;
}): Promise<number> {
  const tokens = getDecryptedOAuth(account);
  if (!tokens?.refresh_token) return 0;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    undefined
  );
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const { data } = await gmail.users.labels.get({
    userId: "me",
    id: "INBOX",
  });
  return data.messagesUnread ?? 0;
}

async function getZohoUnreadCount(account: {
  id: string;
  email: string;
  smtpPasswordEncrypted: string | null;
  zohoProServers: boolean | null;
}): Promise<number> {
  const password = getDecryptedPassword(account);
  if (!password) return 0;

  const imapHost = account.zohoProServers ? "imappro.zoho.com" : "imap.zoho.com";

  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: account.email,
      password,
      host: imapHost,
      port: 993,
      tls: true,
    });

    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err) => {
        if (err) {
          imap.end();
          return reject(err);
        }
        imap.search(["UNSEEN"], (searchErr, uids) => {
          imap.end();
          if (searchErr) return reject(searchErr);
          resolve(uids?.length ?? 0);
        });
      });
    });
    imap.once("error", reject);
    imap.connect();
  });
}

export async function sendReply(
  accountId: string,
  opts: {
    messageId: string;
    to: string;
    subject: string;
    body: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const account = await prisma.emailAccount.findUnique({
    where: { id: accountId, isActive: true },
  });
  if (!account) return { success: false, error: "Account not found" };

  const msg = await getInboxMessage(accountId, opts.messageId);
  const rfcMessageId = msg.messageId;
  const inReplyTo = rfcMessageId;
  const references = msg.references
    ? `${msg.references} ${rfcMessageId || ""}`.trim()
    : rfcMessageId;

  let subject = opts.subject;
  if (!subject.toLowerCase().startsWith("re:")) {
    subject = `Re: ${subject}`;
  }

  try {
    if (account.accountType === "google") {
      await sendGmail(account, opts.to, subject, opts.body, {
        threadId: msg.threadId,
        inReplyTo: inReplyTo || undefined,
        references: references || undefined,
      });
    } else if (account.accountType === "zoho") {
      await sendZoho(account, opts.to, subject, opts.body, {
        inReplyTo: inReplyTo || undefined,
        references: references || undefined,
      });
    } else {
      return { success: false, error: "Unsupported account type" };
    }
    logger.info("Inbox reply sent", { accountId, to: opts.to });
    return { success: true };
  } catch (e) {
    logger.error("Inbox reply send failed", { accountId, error: formatError(e) });
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
