import React from 'react';
import { AlertTriangle, Timer } from 'lucide-react';
import type { PracticeUsage } from '../lib/api';
import {
  formatClock,
  formatDuration,
  limitSecondsFor,
  remainingSecondsFor,
  UsageTone,
  usageTone,
  usedSecondsFor,
} from '../lib/usage';
import { cx } from './ui';

export interface UsageMeterProps {
  usage: PracticeUsage | null;
  /** Seconds inside the call that is running right now (0 when idle). */
  liveSeconds: number;
  isLive: boolean;
  loading: boolean;
  error: string | null;
}

const TONE_PILL: Record<UsageTone, string> = {
  ok: 'border-white/10 bg-white/[0.04] text-slate-300',
  low: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  empty: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
};

const TONE_BAR: Record<UsageTone, string> = {
  ok: 'bg-gradient-to-r from-primary to-accent-cyan',
  low: 'bg-amber-400',
  empty: 'bg-rose-500',
};

function tooltip(usage: PracticeUsage | null, usedSeconds: number, remainingSeconds: number | null): string {
  if (!usage) return 'Practice time today could not be loaded yet.';
  if (usage.limit_minutes === null) {
    return `Practice today: ${formatDuration(usedSeconds)}. No daily limit is set.`;
  }
  return (
    `Today: ${formatDuration(usedSeconds)} of ${usage.limit_minutes} min used, ` +
    `${formatDuration(remainingSeconds ?? 0)} left. The allowance resets at midnight UTC.`
  );
}

/** Compact allowance pill for the header: always visible, counts down during a call. */
export const UsagePill: React.FC<UsageMeterProps> = ({ usage, liveSeconds, isLive, loading, error }) => {
  const limit = limitSecondsFor(usage);
  const used = usedSecondsFor(usage, liveSeconds);
  const remaining = remainingSecondsFor(usage, used);
  const tone = usageTone(remaining, limit);

  if (error && !usage) {
    return (
      <div
        className="flex items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 font-mono text-[11px] text-amber-300"
        title={error}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Usage unavailable</span>
      </div>
    );
  }

  const label = limit === null
    ? `${formatDuration(used)} today`
    : loading && !usage
    ? 'Usage…'
    : `${formatClock(remaining ?? 0)} left`;

  return (
    <div
      className={cx(
        'flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 font-mono text-[11px] tabular-nums transition-colors',
        TONE_PILL[tone],
      )}
      title={tooltip(usage, used, remaining)}
    >
      <Timer className="h-3.5 w-3.5" />
      <span>{label}</span>
      {isLive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
    </div>
  );
};

/** Detailed allowance card for the practice view: today's usage and the current call timer. */
export const UsageCard: React.FC<UsageMeterProps> = ({ usage, liveSeconds, isLive, error }) => {
  const limit = limitSecondsFor(usage);
  const used = usedSecondsFor(usage, liveSeconds);
  const remaining = remainingSecondsFor(usage, used);
  const tone = usageTone(remaining, limit);
  const percent = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-black/25 px-3.5 py-3" title={tooltip(usage, used, remaining)}>
      <div className="flex items-center justify-between text-[11px]">
        <span className="eyebrow flex items-center gap-1.5">
          <Timer className="h-3 w-3 text-cyan-400" />
          Today&apos;s practice
        </span>
        <span className="font-mono tabular-nums text-slate-200">
          {error && !usage
            ? 'unavailable'
            : limit === null
            ? `${formatDuration(used)} used`
            : `${formatDuration(used)} / ${formatDuration(limit)}`}
        </span>
      </div>

      {limit !== null && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className={cx('h-full rounded-full transition-all duration-700', TONE_BAR[tone])}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-slate-500">
        <span className={isLive ? 'text-emerald-300' : undefined}>
          {isLive ? `This call ${formatClock(liveSeconds)}` : 'Resets at midnight UTC'}
        </span>
        <span className={tone === 'empty' ? 'text-rose-300' : undefined}>
          {limit === null
            ? 'no daily limit'
            : tone === 'empty'
            ? 'Daily limit reached'
            : `${formatClock(remaining ?? 0)} left today`}
        </span>
      </div>
    </div>
  );
};
