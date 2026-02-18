/**
 * Extract plain text body from Gmail API message payload.
 * Handles single-part and multipart messages.
 */

import type { gmail_v1 } from "googleapis";
import { stripHtml } from "./emailBody.js";

function decodeBase64url(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function getPartText(part: gmail_v1.Schema$MessagePart): string | null {
  if (!part.body?.data) return null;
  try {
    return decodeBase64url(part.body.data);
  } catch {
    return null;
  }
}

export function extractGmailBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  const parts = payload.parts || [];
  let text = "";
  let html = "";

  for (const part of parts) {
    const mimeType = (part.mimeType || "").toLowerCase();
    const content = getPartText(part);
    if (!content) continue;
    if (mimeType === "text/plain") text = content;
    else if (mimeType === "text/html") html = content;
  }

  // Single-part message (no parts array)
  if (parts.length === 0 && payload.body?.data) {
    const content = getPartText(payload as gmail_v1.Schema$MessagePart);
    if (content) {
      const mimeType = (payload.mimeType || "").toLowerCase();
      if (mimeType === "text/html") html = content;
      else text = content;
    }
  }

  if (text) return text;
  if (html) return stripHtml(html);
  return "";
}
