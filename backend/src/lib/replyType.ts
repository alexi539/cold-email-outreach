/**
 * Detect if a reply is a bounce, auto-reply, or human response.
 * Bounces and auto-replies typically arrive within minutes of sending.
 */

const BOUNCE_PATTERNS = [
  /delivery\s*failed/i,
  /undeliverable/i,
  /mail\s*delivery/i,
  /user\s*unknown/i,
  /address\s*not\s*found/i,
  /mailbox\s*full/i,
  /rejected/i,
  /returned\s*mail/i,
  /message\s*not\s*delivered/i,
  /recipient\s*(address|unknown)/i,
  /postmaster/i,
  /mailer-daemon/i,
  /delivery\s*status/i,
  /permanent\s*error/i,
  /fatal\s*error/i,
];

const AUTO_REPLY_PATTERNS = [
  /out\s*of\s*office/i,
  /automatic\s*reply/i,
  /vacation/i,
  /\baway\b.*(?:from|until)/i,
  /i'?m\s*not\s*(?:in\s*the\s*)?office/i,
  /auto-?reply/i,
  /autoresponder/i,
  /automatic\s*response/i,
  /thank\s*you\s*for\s*your\s*email.*(?:i\s*will\s*respond|i\s*am\s*away)/i,
  /do\s*not\s*reply/i,
  /no\s*reply/i,
  /noreply/i,
];

/** Minutes after our send — reply within this window is likely bounce/auto-reply */
const FAST_REPLY_MINUTES = 5;

export type ReplyType = "human" | "bounce" | "auto_reply";

export function detectReplyType(
  replyText: string,
  replySubject: string,
  ourSentAt: Date,
  replyAt: Date
): ReplyType {
  const combined = `${replySubject}\n${replyText}`.toLowerCase();
  const elapsedMinutes = (replyAt.getTime() - ourSentAt.getTime()) / (60 * 1000);

  // Bounce: content patterns take priority
  for (const p of BOUNCE_PATTERNS) {
    if (p.test(combined)) return "bounce";
  }

  // Auto-reply: content patterns
  for (const p of AUTO_REPLY_PATTERNS) {
    if (p.test(combined)) return "auto_reply";
  }

  // Fast reply (< 5 min) without clear human content → likely auto-reply
  if (elapsedMinutes < FAST_REPLY_MINUTES) {
    return "auto_reply";
  }

  return "human";
}
