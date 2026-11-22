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

export interface UsageMeterProps {
  usage: PracticeUsage | null;
  /** Seconds inside the call that is running right now (0 when idle). */
  liveSeconds: number;
  isLive: boolean;
  loading: boolean;
  error: string | null;
}

const TONE_PILL: Record<UsageTone, string> = {
  ok: 'bg-slate-900 border-slate-800 text-slate-300',
  low: 'bg-amber-500/10 border-amber-500/40 text-amber-300',
  empty: 'bg-rose-500/10 border-rose-500/40 text-rose-300',
};

const TONE_BAR: Record<UsageTone, string> = {
  ok: 'bg-primary',
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
        className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/40 text-[11px] font-mono text-amber-300"
        title={error}
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        <span>Usage unavailable</span>
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
      className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full border text-[11px] font-mono transition-colors ${TONE_PILL[tone]}`}
      title={tooltip(usage, used, remaining)}
    >
      <Timer className="w-3.5 h-3.5" />
      <span>{label}</span>
      {isLive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
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
    <div
      className="rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-2.5"
      title={tooltip(usage, used, remaining)}
    >
      <div className="flex items-center justify-between text-[11px] font-mono">
        <span className="flex items-center space-x-1.5 text-slate-400">
          <Timer className="w-3.5 h-3.5 text-cyan-400" />
          <span>Today's practice</span>
        </span>
        <span className="text-slate-200">
          {error && !usage
            ? 'unavailable'
            : limit === null
            ? `${formatDuration(used)} used`
            : `${formatDuration(used)} / ${formatDuration(limit)}`}
        </span>
      </div>

      {limit !== null && (
        <div className="mt-2 h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${TONE_BAR[tone]}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono text-slate-500">
        <span className={isLive ? 'text-slate-300' : undefined}>
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
