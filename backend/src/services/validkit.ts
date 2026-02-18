/**
 * ValidKit Email Verification Service
 *
 * Multi-key parallel validation with rate limiting (60 req/min per key).
 * Usage tracking per key, monthly quota reset.
 *
 * IMPORTANT: When adding new API keys (beyond the initial set), you MUST ask the user
 * for the reset day (1-28) — the day of month when their ValidKit billing cycle resets.
 * Document this in README and prompt when adding keys via any admin/script.
 */

import { ValidKit, ResponseFormat } from "@validkit/sdk";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const RATE_LIMIT_PER_MIN = 60;
const DELAY_MS = (60 * 1000) / RATE_LIMIT_PER_MIN; // ~1000ms between requests per key
const MONTHLY_QUOTA = 1000;

export type ValidationStatus = "valid" | "invalid" | "risky";

export interface ValidationResult {
  email: string;
  status: ValidationStatus;
  raw?: { valid?: boolean; disposable?: boolean; mx?: { valid?: boolean }; smtp?: { valid?: boolean } };
}

export interface KeyUsage {
  keyIndex: number;
  keyLabel: string;
  usedThisMonth: number;
  remaining: number;
  resetDay: number;
  lastResetAt: string;
}

function getKeys(): string[] {
  const raw = process.env.VALIDKIT_API_KEYS;
  if (!raw?.trim()) return [];
  return raw.split(",").map((k) => k.trim()).filter(Boolean);
}

function getResetDays(): number[] {
  const raw = process.env.VALIDKIT_RESET_DAYS;
  if (!raw?.trim()) return [];
  const days = raw.split(",").map((d) => parseInt(d.trim(), 10)).filter((n) => !isNaN(n) && n >= 1 && n <= 28);
  return days;
}

async function ensureKeyUsageRecords() {
  const keys = getKeys();
  const resetDays = getResetDays();
  const defaultResetDay = 17;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const keyLabel = key.length >= 8 ? key.slice(-8) : key;
    const resetDay = resetDays[i] ?? resetDays[resetDays.length - 1] ?? defaultResetDay;

    const existing = await prisma.validKitKeyUsage.findUnique({ where: { keyIndex: i } });
    const now = new Date();
    const lastResetAt = existing?.lastResetAt ?? now;
    const shouldReset = shouldResetQuota(lastResetAt, resetDay);

    if (!existing) {
      try {
        await prisma.validKitKeyUsage.create({
          data: { keyIndex: i, keyLabel, usedThisMonth: 0, lastResetAt: now, resetDay },
        });
        logger.info("ValidKit: created usage record for key", { keyIndex: i, keyLabel, resetDay });
      } catch (err) {
        if ((err as { code?: string })?.code !== "P2002") throw err;
      }
    } else if (shouldReset) {
      await prisma.validKitKeyUsage.update({
        where: { keyIndex: i },
        data: { usedThisMonth: 0, lastResetAt: nextResetDate(now, resetDay) },
      });
      logger.info("ValidKit: reset quota for key", { keyIndex: i, keyLabel });
    }
  }
}

function shouldResetQuota(lastResetAt: Date, resetDay: number): boolean {
  const now = new Date();
  const last = new Date(lastResetAt);
  if (now.getFullYear() > last.getFullYear()) return true;
  if (now.getMonth() > last.getMonth()) return true;
  if (now.getMonth() === last.getMonth() && now.getDate() >= resetDay && last.getDate() < resetDay) return true;
  return false;
}

function nextResetDate(from: Date, resetDay: number): Date {
  const next = new Date(from);
  next.setDate(resetDay);
  if (next <= from) {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

class KeyRunner {
  private lastRequest = 0;
  private queue: Array<{ email: string; resolve: (r: ValidationResult) => void }> = [];
  private running = false;

  constructor(
    private keyIndex: number,
    private apiKey: string,
  ) {}

  async verify(email: string): Promise<ValidationResult> {
    return new Promise((resolve) => {
      this.queue.push({ email, resolve });
      this.process();
    });
  }

  private async process() {
    if (this.running || this.queue.length === 0) return;
    this.running = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const wait = Math.max(0, this.lastRequest + DELAY_MS - now);
      if (wait > 0) await sleep(wait);

      const item = this.queue.shift();
      if (!item) break;

      try {
        const client = new ValidKit({ api_key: this.apiKey });
        const result = await client.verifyEmail(item.email, { format: ResponseFormat.FULL });
        this.lastRequest = Date.now();

        const status = toStatus(result);
        item.resolve({ email: item.email, status, raw: result as never });
      } catch (err) {
        logger.error("ValidKit verify error", { keyIndex: this.keyIndex, email: item.email, err });
        item.resolve({ email: item.email, status: "invalid", raw: undefined });
      }
    }

    this.running = false;
  }
}

function toStatus(r: unknown): ValidationStatus {
  const o = r && typeof r === "object" ? r as Record<string, unknown> : {};
  const result = (o.result as Record<string, unknown>) ?? o;
  const valid = result.valid === true || o.valid === true;
  const disposable = result.disposable === true || (result.disposable as Record<string, unknown>)?.value === true || o.disposable === true;
  const mx = result.mx as Record<string, unknown> | undefined;
  const smtp = result.smtp as Record<string, unknown> | undefined;
  if (!valid) return "invalid";
  if (disposable) return "risky";
  if (mx?.valid === false || smtp?.valid === false) return "invalid";
  return "valid";
}

export async function getKeyUsage(): Promise<KeyUsage[]> {
  await ensureKeyUsageRecords();
  const keys = getKeys();
  const records = await prisma.validKitKeyUsage.findMany({ where: { keyIndex: { in: keys.map((_, i) => i) } } });
  const byIndex = new Map(records.map((r) => [r.keyIndex, r]));

  return keys.map((_, i) => {
    const rec = byIndex.get(i);
    return {
      keyIndex: i,
      keyLabel: rec?.keyLabel ?? `key_${i}`,
      usedThisMonth: rec?.usedThisMonth ?? 0,
      remaining: Math.max(0, MONTHLY_QUOTA - (rec?.usedThisMonth ?? 0)),
      resetDay: rec?.resetDay ?? 17,
      lastResetAt: rec?.lastResetAt?.toISOString() ?? new Date().toISOString(),
    };
  });
}

export async function validateEmails(emails: string[]): Promise<ValidationResult[]> {
  const keys = getKeys();
  if (keys.length === 0) {
    throw new Error("No ValidKit API keys configured. Set VALIDKIT_API_KEYS in .env");
  }

  await ensureKeyUsageRecords();

  const runners = keys.map((key, i) => new KeyRunner(i, key));
  const results: ValidationResult[] = [];
  const usedByKey: Record<number, number> = {};

  const tasks = emails.map((email, idx) => {
    const runner = runners[idx % runners.length];
    const keyIdx = idx % runners.length;
    return runner.verify(email).then((r) => {
      if (!usedByKey[keyIdx]) usedByKey[keyIdx] = 0;
      usedByKey[keyIdx]++;
      return r;
    });
  });

  const resolved = await Promise.all(tasks);

  for (const r of resolved) {
    results.push(r);
  }

  for (const [keyIdx, count] of Object.entries(usedByKey)) {
    await prisma.validKitKeyUsage.update({
      where: { keyIndex: parseInt(keyIdx, 10) },
      data: { usedThisMonth: { increment: count } },
    });
  }

  return results;
}

export function hasValidKitKeys(): boolean {
  return getKeys().length > 0;
}
