/** Validates HH:mm time string. Hours 0-23, minutes 0-59. */
export function validateTime(value: string, fieldName: string): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  const h = parseInt(parts[0], 10);
  const m = parts[1] !== undefined ? parseInt(parts[1], 10) : 0;
  if (isNaN(h) || isNaN(m)) return `${fieldName}: invalid format, use HH:mm (e.g. 09:00)`;
  if (h < 0 || h > 23) return `${fieldName}: hours must be 0–23 (got ${h})`;
  if (m < 0 || m > 59) return `${fieldName}: minutes must be 0–59 (got ${m})`;
  return null;
}

export function validateCampaign(data: {
  startTime?: string | null;
  workingHoursStart?: string;
  workingHoursEnd?: string;
  dailyLimit?: number;
  sequence?: {
    throttleMinMinutes?: number;
    throttleMaxMinutes?: number;
    steps?: { subjectTemplate?: string; bodyTemplate?: string; delayAfterPreviousDays?: number }[];
  };
}): string | null {
  if (data.startTime != null && data.startTime !== "") {
    const err = validateTime(data.startTime, "Start time");
    if (err) return err;
  }
  if (data.workingHoursStart != null) {
    const err = validateTime(data.workingHoursStart, "Working hours start");
    if (err) return err;
  }
  if (data.workingHoursEnd != null) {
    const err = validateTime(data.workingHoursEnd, "Working hours end");
    if (err) return err;
  }
  if (data.dailyLimit != null) {
    const n = Number(data.dailyLimit);
    if (isNaN(n) || n < 1) return "Daily limit must be at least 1";
  }
  if (data.sequence) {
    const { throttleMinMinutes, throttleMaxMinutes, steps } = data.sequence;
    if (throttleMinMinutes != null) {
      const n = Number(throttleMinMinutes);
      if (isNaN(n) || n < 1) return "Throttle min must be at least 1 minute";
    }
    if (throttleMaxMinutes != null) {
      const n = Number(throttleMaxMinutes);
      if (isNaN(n) || n < 1) return "Throttle max must be at least 1 minute";
    }
    if (throttleMinMinutes != null && throttleMaxMinutes != null) {
      if (Number(throttleMinMinutes) > Number(throttleMaxMinutes)) {
        return "Throttle min cannot be greater than throttle max";
      }
    }
    if (steps?.length) {
      for (let i = 0; i < steps.length; i++) {
        const d = steps[i].delayAfterPreviousDays;
        if (d != null && (isNaN(Number(d)) || Number(d) < 0)) {
          return `Follow-up ${i}: delay must be 0 or more days`;
        }
      }
    }
  }
  return null;
}
