import { google } from "googleapis";
import { getDecryptedOAuth } from "../lib/accounts.js";
import { isHtml, stripHtml } from "../lib/emailBody.js";
import type { EmailAccount } from "@prisma/client";
import { logger, formatError } from "../lib/logger.js";

/** Gmail total message size limit: 25 MB */
const GMAIL_MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

export interface GmailSendOpts {
  /** For follow-ups: thread to add the message to */
  threadId?: string;
  /** For follow-ups: In-Reply-To and References headers (RFC 2822) */
  inReplyTo?: string;
  references?: string;
}

export async function sendGmail(
  account: EmailAccount,
  to: string,
  subject: string,
  body: string,
  opts?: GmailSendOpts
): Promise<{ messageId?: string; threadId?: string }> {
  const tokens = getDecryptedOAuth(account);
  if (!tokens?.refresh_token) {
    throw new Error("No OAuth tokens for account " + account.email);
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    undefined
  );
  oauth2Client.setCredentials(tokens);

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const boundary = "----=_Part_" + Math.random().toString(36).slice(2);
  const headers: string[] = [
    `To: ${to}`,
    `Subject: ${subject}`,
  ];
  if (opts?.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts?.references) headers.push(`References: ${opts.references}`);
  headers.push("MIME-Version: 1.0");

  let bodyPart: string;
  if (isHtml(body)) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const plainText = stripHtml(body);
    bodyPart = [
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      plainText,
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "",
      body,
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    headers.push("Content-Type: text/plain; charset=utf-8");
    bodyPart = body;
  }

  const fullMessage = [...headers, "", bodyPart].join("\r\n");
  const messageBytes = Buffer.byteLength(fullMessage, "utf8");
  if (messageBytes > GMAIL_MAX_MESSAGE_BYTES) {
    throw new Error(
      `Message exceeds Gmail limit: ${(messageBytes / (1024 * 1024)).toFixed(1)} MB > 25 MB`
    );
  }

  const raw = Buffer.from(fullMessage).toString("base64url");

  const requestBody: { raw: string; threadId?: string } = { raw };
  if (opts?.threadId) requestBody.threadId = opts.threadId;

  const { data } = await gmail.users.messages.send({
    userId: "me",
    requestBody,
  });

  logger.info("Gmail sent", { to, messageId: data.id, threadId: data.threadId });
  return { messageId: data.id ?? undefined, threadId: data.threadId ?? undefined };
}

/** Fetch the RFC Message-ID header of a sent Gmail message (for threading follow-ups) */
export async function getGmailMessageIdHeader(
  account: EmailAccount,
  gmailMessageId: string
): Promise<string | null> {
  const tokens = getDecryptedOAuth(account);
  if (!tokens?.refresh_token) return null;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    undefined
  );
  oauth2Client.setCredentials(tokens);

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    const { data } = await gmail.users.messages.get({
      userId: "me",
      id: gmailMessageId,
      format: "metadata",
      metadataHeaders: ["Message-ID"],
    });
    const header = data.payload?.headers?.find(
      (h) => h.name?.toLowerCase() === "message-id"
    )?.value?.trim();
    return header && header.length > 0 ? header : null;
  } catch (e) {
    logger.warn("getGmailMessageIdHeader failed", {
      gmailMessageId,
      accountEmail: account.email,
      ...formatError(e),
    });
    return null;
  }
}
