import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Clock,
  Flame,
  Target,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import {
  fetchProgress,
  fetchStats,
  ProgressEntry,
  StatsResponse,
  describeApiError,
} from '../lib/api';
import { ScoreBar, ScoreRing, TrendChart, scoreTone } from './ReportCharts';
import {
  EmptyState,
  ErrorNote,
  Page,
  PageHeader,
  RefreshButton,
  SectionCard,
  SkeletonLines,
  StatTile,
  cx,
} from './ui';

interface ProgressViewProps {
  onBack: () => void;
  onOpenReport: (id: string) => void;
}

const SKILLS: { key: keyof ProgressEntry['scores']; label: string }[] = [
  { key: 'fluency', label: 'Fluency' },
  { key: 'vocabulary', label: 'Vocabulary' },
  { key: 'grammar', label: 'Grammar' },
  { key: 'communication', label: 'Communication' },
  { key: 'pace', label: 'Pace' },
];

export const ProgressView: React.FC<ProgressViewProps> = ({ onBack, onOpenReport }) => {
  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [progress, practice] = await Promise.all([fetchProgress(10), fetchStats()]);
      setEntries(progress);
      setStats(practice);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // API returns newest first; charts read left-to-right oldest-to-newest.
  const chronological = [...entries].reverse();
  const points = chronological
    .filter((e) => e.scores.overall !== null)
    .map((e) => ({
      label: e.started_at ? new Date(e.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
      value: Math.round(e.scores.overall as number),
    }));
  const latest = entries[0]?.scores ?? null;
  const best = entries.reduce<number | null>((acc, e) => {
    const v = e.scores.overall;
    if (v === null) return acc;
    return acc === null ? v : Math.max(acc, v);
  }, null);
  const first = points.length > 0 ? points[0].value : null;
  const improvement = first !== null && latest?.overall != null ? Math.round(latest.overall - first) : null;

  const averages = SKILLS.map(({ key, label }) => {
    const values = entries.map((e) => e.scores[key]).filter((v): v is number => v !== null);
    const avg = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
    return { key, label, avg };
  });

  const formatDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';

  return (
    <Page>
      <PageHeader
        eyebrow="Your journey"
        title="Progress"
        icon={<TrendingUp className="h-6 w-6 text-primary-glow" />}
        description={
          entries.length > 0
            ? `Based on your last ${entries.length} scored sessions.`
            : 'Your scores, habits and streak — one honest picture of your speaking.'
        }
        onBack={onBack}
        backLabel="Back to practice"
        actions={<RefreshButton onClick={() => void load()} loading={loading} />}
      />

      {loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="panel space-y-3 p-4">
                <div className="skeleton h-2.5 w-20" />
                <div className="skeleton h-7 w-14" />
                <div className="skeleton h-2 w-full" />
              </div>
            ))}
          </div>
          <div className="panel p-5">
            <SkeletonLines rows={4} />
          </div>
        </div>
      )}

      {error && !loading && <ErrorNote message={error} onRetry={() => void load()} />}

      {/* Habit stats: streak, weekly goal, total time, words to review */}
      {!loading && !error && stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Day streak"
            value={stats.streak_days}
            icon={<Flame className="h-4 w-4 text-amber-400" />}
            hint={stats.streak_days > 0 ? 'Keep it alive today' : 'One session starts it'}
          />
          <StatTile
            label="This week"
            value={stats.weekly_goal ? `${stats.sessions_this_week}/${stats.weekly_goal}` : stats.sessions_this_week}
            icon={<Target className="h-4 w-4 text-cyan-400" />}
            progress={stats.weekly_goal_progress}
            hint={
              stats.weekly_goal
                ? stats.weekly_goal_met
                  ? 'Weekly goal reached'
                  : `${Math.max(0, stats.weekly_goal - stats.sessions_this_week)} more to reach your goal`
                : 'Sessions this week'
            }
          />
          <StatTile
            label="Minutes"
            value={stats.minutes_total}
            icon={<Clock className="h-4 w-4 text-purple-300" />}
            hint={`${stats.minutes_this_week} this week`}
          />
          <StatTile
            label="Words to review"
            value={stats.wordbank.due}
            icon={<BarChart3 className="h-4 w-4 text-emerald-400" />}
            hint={`${stats.wordbank.mastered} mastered of ${stats.wordbank.total}`}
          />
        </div>
      )}

      {!loading && !error && stats?.weakest_skill && entries.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
          <Target className="mt-0.5 h-4 w-4 flex-none text-amber-300" />
          <p className="text-xs leading-relaxed text-slate-300">
            Your weakest area so far is{' '}
            <strong className="font-semibold text-white">{stats.weakest_skill.label}</strong>{' '}
            <span className="font-mono text-[11px] text-amber-200/80">({stats.weakest_skill.score}/100)</span>. Make it
            today&apos;s focus before you start a call.
          </p>
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <EmptyState
          icon={<BarChart3 className="h-5 w-5" />}
          title="No scored sessions yet"
          description="Finish a conversation with a few full answers and your scores, streak and trend appear here."
          action={
            <button onClick={onBack} className="btn-primary px-4 py-2.5">
              Start a practice call
            </button>
          }
        />
      )}

      {!loading && !error && entries.length > 0 && latest && (
        <div className="space-y-4 pb-6">
          {/* Summary */}
          <section className="panel flex flex-col items-center gap-6 p-5 sm:flex-row sm:p-6">
            <ScoreRing value={latest.overall} caption="Latest" />
            <div className="grid w-full flex-1 grid-cols-2 gap-4 text-center sm:text-left">
              <div>
                <div className="eyebrow flex items-center justify-center gap-1.5 sm:justify-start">
                  <Trophy className="h-3 w-3 text-amber-400" /> Best
                </div>
                <div className={cx('mt-1 font-display text-2xl tabular-nums', scoreTone(best))}>{best ?? '—'}</div>
              </div>
              <div>
                <div className="eyebrow flex items-center justify-center gap-1.5 sm:justify-start">
                  <BarChart3 className="h-3 w-3 text-cyan-400" /> Sessions
                </div>
                <div className="mt-1 font-display text-2xl tabular-nums text-white">{entries.length}</div>
              </div>
              <div>
                <div className="eyebrow flex items-center justify-center gap-1.5 sm:justify-start">
                  <TrendingUp className="h-3 w-3 text-emerald-400" /> Change
                </div>
                <div
                  className={cx(
                    'mt-1 font-display text-2xl tabular-nums',
                    improvement === null ? 'text-slate-400' : improvement >= 0 ? 'text-emerald-400' : 'text-rose-400',
                  )}
                >
                  {improvement === null ? '—' : `${improvement >= 0 ? '+' : ''}${improvement}`}
                </div>
              </div>
              <div>
                <div className="eyebrow flex items-center justify-center gap-1.5 sm:justify-start">
                  <CalendarDays className="h-3 w-3 text-purple-300" /> Latest
                </div>
                <div className="mt-1.5 text-sm font-semibold text-slate-200">{formatDate(entries[0].started_at)}</div>
              </div>
            </div>
          </section>

          <SectionCard title="Overall score trend" icon={<TrendingUp className="h-3.5 w-3.5 text-primary-glow" />}>
            {points.length >= 1 ? (
              <TrendChart points={points} />
            ) : (
              <p className="py-6 text-center text-sm text-slate-400">Your reports do not have scores yet.</p>
            )}
          </SectionCard>

          <SectionCard title="Average by skill" icon={<BarChart3 className="h-3.5 w-3.5 text-cyan-400" />}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {averages.map(({ key, label, avg }) => (
                <ScoreBar key={key} label={label} value={avg} />
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Recent reports" icon={<CalendarDays className="h-3.5 w-3.5 text-purple-300" />}>
            <div className="space-y-2">
              {entries.map((entry) => (
                <button
                  key={entry.session_id}
                  onClick={() => onOpenReport(entry.session_id)}
                  className="group flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-left transition-all duration-200 hover:border-primary/30 hover:bg-white/[0.05]"
                >
                  <div>
                    <div className="text-sm font-medium capitalize text-slate-200">
                      {entry.scenario ? entry.scenario.replace('_', ' ') : 'Practice session'}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                      {formatDate(entry.started_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cx('font-display text-xl tabular-nums', scoreTone(entry.scores.overall))}>
                      {entry.scores.overall ?? '—'}
                    </span>
                    <ArrowRight className="h-4 w-4 text-slate-600 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-300" />
                  </div>
                </button>
              ))}
            </div>
          </SectionCard>
        </div>
      )}
    </Page>
  );
};
