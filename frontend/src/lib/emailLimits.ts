/**
 * Gmail and email limits (per official docs and RFC 5322).
 * @see https://support.google.com/mail/answer/22839
 * @see https://support.google.com/mail/answer/6584
 */

/** Gmail total message size limit (body + attachments + headers): 25 MB */
export const GMAIL_MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

/** RFC 5322: max subject line length (chars) */
export const EMAIL_MAX_SUBJECT_CHARS = 998;

/** Get UTF-8 byte length of a string */
export function getUtf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Format bytes for display */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
