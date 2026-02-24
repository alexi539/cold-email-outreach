/**
 * Extract plain text body from raw MIME message (Zoho IMAP).
 * Recursive for nested multipart. Shared by replyChecker and inbox.
 */

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
export function extractZohoBodyFromRaw(raw: string): string {
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
