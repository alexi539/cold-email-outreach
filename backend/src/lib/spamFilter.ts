/**
 * Detect spam tracking codes at end of subject or body.
 * Pattern: random alphanumeric like "Z5X6C8Y" or "Z5X6C8Y 7M96V9D" (6-12 chars, optionally two blocks).
 */

const SPAM_TRACKING_REGEX = /[A-Z0-9]{6,12}(\s+[A-Z0-9]{6,12})?\s*$/;

export function isSpamTrackingPattern(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return SPAM_TRACKING_REGEX.test(trimmed);
}
