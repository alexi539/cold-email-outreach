/**
 * Human-like throttle: percentage-based delay distribution.
 * 40% fast (min..min+range/3), 45% normal (max-range/3..max), 15% slow (beyond max, cap 20 min).
 * Within each bucket, random seconds for natural variation.
 */
const SLOW_CAP_MINUTES = 20;

export function humanLikeThrottleSeconds(
  throttleMinMinutes: number,
  throttleMaxMinutes: number
): number {
  const range = throttleMaxMinutes - throttleMinMinutes;
  const r = Math.random();

  let bucketMinMin: number;
  let bucketMaxMin: number;

  if (r < 0.4) {
    bucketMinMin = throttleMinMinutes;
    bucketMaxMin = throttleMinMinutes + range / 3;
  } else if (r < 0.85) {
    bucketMinMin = throttleMaxMinutes - range / 3;
    bucketMaxMin = throttleMaxMinutes;
  } else {
    bucketMinMin = throttleMaxMinutes + range / 3;
    bucketMaxMin = Math.min(throttleMaxMinutes + (2 * range) / 3, SLOW_CAP_MINUTES);
    if (bucketMinMin > bucketMaxMin) bucketMinMin = bucketMaxMin;
  }

  const bucketMinSec = Math.round(bucketMinMin * 60);
  const bucketMaxSec = Math.round(bucketMaxMin * 60);
  const span = bucketMaxSec - bucketMinSec;
  const randomSec = span <= 0 ? bucketMinSec : bucketMinSec + Math.floor(Math.random() * (span + 1));
  return randomSec;
}
