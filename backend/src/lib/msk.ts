// Moscow time (MSK) utilities - Europe/Moscow is UTC+3

export function getMSKMinutes(date?: Date): number {
  const d = date || new Date();
  const utcHours = d.getUTCHours();
  const utcMins = d.getUTCMinutes();
  const mskHours = (utcHours + 3) % 24;
  return mskHours * 60 + utcMins;
}

export function isWithinWorkingHours(
  start: string,
  end: string,
  date?: Date
): boolean {
  const nowMins = getMSKMinutes(date);
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMins = (sh ?? 0) * 60 + (sm ?? 0);
  const endMins = (eh ?? 0) * 60 + (em ?? 0);
  if (startMins <= endMins) {
    return nowMins >= startMins && nowMins < endMins;
  }
  return nowMins >= startMins || nowMins < endMins;
}

export function parseMSKTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { hours: h ?? 0, minutes: m ?? 0 };
}

export function formatMSK(date: Date): string {
  const msk = new Date(date.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
  return msk.toISOString().slice(0, 19).replace("T", " ");
}
