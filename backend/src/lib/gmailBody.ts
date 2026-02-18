/**
 * Extract plain text body from Gmail API message payload.
 * Handles single-part and multipart messages (including nested).
 */

import type { gmail_v1 } from "googleapis";
import { stripHtml } from "./emailBody.js";

function parseCharset(mimeType: string): BufferEncoding {
  const match = mimeType.match(/charset\s*=\s*["']?([^"'\s;]+)/i);
  if (!match) return "utf-8";
  const raw = match[1].toLowerCase();
  if (raw === "utf-8" || raw === "utf8") return "utf-8";
  if (raw === "iso-8859-1" || raw === "latin1") return "latin1";
  return "utf-8";
}

function decodeBase64url(str: string, charset: BufferEncoding = "utf-8"): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const buf = Buffer.from(base64, "base64");
  try {
    return buf.toString(charset);
  } catch {
    return buf.toString("utf-8");
  }
}

export interface ExtractGmailBodyOpts {
  gmail: gmail_v1.Gmail;
  userId: string;
  messageId: string;
}

async function getPartText(
  part: gmail_v1.Schema$MessagePart,
  opts?: ExtractGmailBodyOpts
): Promise<string | null> {
  const mimeType = (part.mimeType || "").toLowerCase();
  const charset = parseCharset(mimeType);

  if (part.body?.data) {
    try {
      return decodeBase64url(part.body.data, charset);
    } catch {
      return null;
    }
  }

  if (part.body?.attachmentId && opts) {
    try {
      const { data } = await opts.gmail.users.messages.attachments.get({
        userId: opts.userId,
        messageId: opts.messageId,
        id: part.body.attachmentId,
      });
      if (data.data) {
        return decodeBase64url(data.data, charset);
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function collectTextFromParts(
  parts: gmail_v1.Schema$MessagePart[],
  opts?: ExtractGmailBodyOpts
): Promise<{ text: string; html: string }> {
  let text = "";
  let html = "";

  for (const part of parts) {
    const mimeType = (part.mimeType || "").toLowerCase();

    if (mimeType.startsWith("multipart/") && part.parts?.length) {
      const nested = await collectTextFromParts(part.parts, opts);
      if (nested.text) text = nested.text;
      if (nested.html) html = nested.html;
      continue;
    }

    if (mimeType === "text/plain" || mimeType === "text/html") {
      const content = await getPartText(part, opts);
      if (!content) continue;
      if (mimeType === "text/plain") text = content;
      else html = content;
    }
  }

  return { text, html };
}

export async function extractGmailBody(
  payload: gmail_v1.Schema$MessagePart | undefined,
  opts?: ExtractGmailBodyOpts
): Promise<string> {
  if (!payload) return "";

  const parts = payload.parts || [];

  if (parts.length > 0) {
    const { text, html } = await collectTextFromParts(parts, opts);
    if (text) return text;
    if (html) return stripHtml(html);
  }

  if (parts.length === 0 && payload.body?.data) {
    const content = await getPartText(payload as gmail_v1.Schema$MessagePart, opts);
    if (content) {
      const mimeType = (payload.mimeType || "").toLowerCase();
      if (mimeType.includes("text/html")) return stripHtml(content);
      return content;
    }
  }

  return "";
}
