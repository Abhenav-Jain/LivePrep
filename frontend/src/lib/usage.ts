import type { PracticeUsage } from './api';

/**
 * Pure helpers for the daily practice allowance.
 *
 * The server counts finished calls only, so the client adds the seconds of the call that is
 * running right now. Keeping the arithmetic here (no React) makes it testable.
 */

/** The daily limit in seconds, or null when no limit is set. */
export function limitSecondsFor(usage: PracticeUsage | null): number | null {
  if (!usage || usage.limit_minutes === null) return null;
  return Math.max(0, usage.limit_minutes * 60);
}

/** Seconds already recorded today, ignoring any running call. */
export function baseUsedSeconds(usage: PracticeUsage | null): number {
  if (!usage) return 0;
  if (typeof usage.used_seconds === 'number') return Math.max(0, usage.used_seconds);
  return Math.max(0, usage.used_minutes * 60);
}

/** Seconds recorded today plus the running call. */
export function usedSecondsFor(usage: PracticeUsage | null, liveSeconds: number): number {
  return baseUsedSeconds(usage) + Math.max(0, Math.floor(liveSeconds));
}

/** Seconds left today, or null when no limit is set. Never negative. */
export function remainingSecondsFor(usage: PracticeUsage | null, usedSeconds: number): number | null {
  const limit = limitSecondsFor(usage);
  if (limit === null) return null;
  return Math.max(0, limit - Math.max(0, Math.floor(usedSeconds)));
}

export type UsageTone = 'ok' | 'low' | 'empty';

/** Green while there is plenty of time, amber near the end, red once it is gone. */
export function usageTone(remainingSeconds: number | null, limitSeconds: number | null): UsageTone {
  if (remainingSeconds === null || limitSeconds === null || limitSeconds === 0) return 'ok';
  if (remainingSeconds <= 0) return 'empty';
  if (remainingSeconds <= limitSeconds * 0.2) return 'low';
  return 'ok';
}

/** Human text with units: "45s", "2m 05s", "1h 5m". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return sec ? `${m}m ${String(sec).padStart(2, '0')}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Clock text for a live timer: "0:45", "27:30". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
