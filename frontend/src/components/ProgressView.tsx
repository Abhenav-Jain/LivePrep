import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarDays,
  RefreshCw,
  Trophy,
  TrendingUp,
} from 'lucide-react';
import { fetchProgress, ProgressEntry, describeApiError } from '../lib/api';
import { ScoreBar, ScoreRing, TrendChart, scoreTone } from './ReportCharts';

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
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await fetchProgress(10));
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
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg bg-surface border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Back to live interview"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-white tracking-wide flex items-center space-x-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              <span>Your Progress</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Overall score of your last {entries.length || 10} sessions</p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-surface border border-slate-800 hover:border-slate-700 text-xs text-slate-300 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm">Loading your progress...</p>
        </div>
      )}

      {error && !loading && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0 text-red-400" />
          <div>
            <p className="text-sm font-medium">{error}</p>
            <button onClick={load} className="mt-2 text-xs text-red-200 underline hover:text-white">
              Try again
            </button>
          </div>
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="text-center py-20 bg-surface/40 border border-slate-800/80 rounded-2xl p-8">
          <BarChart3 className="w-12 h-12 mx-auto text-slate-600 mb-3" />
          <h3 className="text-base font-semibold text-slate-200">No scored sessions yet</h3>
          <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">
            Finish a mock interview with at least a few full answers and your scores will appear here.
          </p>
          <button
            onClick={onBack}
            className="mt-5 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-medium shadow-lg shadow-blue-500/20 transition-all"
          >
            Start Practice Call
          </button>
        </div>
      )}

      {!loading && !error && entries.length > 0 && latest && (
        <div className="space-y-4 pb-10">
          {/* Summary */}
          <div className="rounded-2xl bg-gradient-to-br from-surface/90 to-slate-900/80 border border-slate-800/80 p-5 flex flex-col sm:flex-row items-center gap-6">
            <ScoreRing value={latest.overall} caption="Latest" />
            <div className="grid grid-cols-2 gap-4 flex-1 w-full text-center sm:text-left">
              <div>
                <div className="flex items-center justify-center sm:justify-start gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                  <Trophy className="w-3 h-3 text-amber-400" /> Best
                </div>
                <div className={`text-2xl font-bold tabular-nums ${scoreTone(best)}`}>{best ?? '—'}</div>
              </div>
              <div>
                <div className="flex items-center justify-center sm:justify-start gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                  <BarChart3 className="w-3 h-3 text-cyan-400" /> Sessions
                </div>
                <div className="text-2xl font-bold tabular-nums text-slate-100">{entries.length}</div>
              </div>
              <div>
                <div className="flex items-center justify-center sm:justify-start gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                  <TrendingUp className="w-3 h-3 text-emerald-400" /> Change
                </div>
                <div
                  className={`text-2xl font-bold tabular-nums ${
                    improvement === null ? 'text-slate-400' : improvement >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {improvement === null ? '—' : `${improvement >= 0 ? '+' : ''}${improvement}`}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-center sm:justify-start gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                  <CalendarDays className="w-3 h-3 text-purple-400" /> Latest session
                </div>
                <div className="text-sm font-semibold text-slate-200 mt-1">{formatDate(entries[0].started_at)}</div>
              </div>
            </div>
          </div>

          {/* Trend */}
          <div className="rounded-2xl bg-surface/50 border border-slate-800/80 p-4 sm:p-5">
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">
              Overall score trend
            </h3>
            {points.length >= 1 ? (
              <TrendChart points={points} />
            ) : (
              <p className="text-sm text-slate-400 py-6 text-center">
                Your reports do not have scores yet.
              </p>
            )}
          </div>

          {/* Averages per skill */}
          <div className="rounded-2xl bg-surface/50 border border-slate-800/80 p-4">
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3">
              Average by skill
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {averages.map(({ key, label, avg }) => (
                <ScoreBar key={key} label={label} value={avg} />
              ))}
            </div>
          </div>

          {/* Session history */}
          <div className="rounded-2xl bg-surface/50 border border-slate-800/80 p-4">
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3">Recent reports</h3>
            <div className="space-y-2">
              {entries.map((entry) => (
                <button
                  key={entry.session_id}
                  onClick={() => onOpenReport(entry.session_id)}
                  className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800/70 hover:border-primary/40 hover:bg-slate-800/60 transition-colors text-left"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-200 capitalize">
                      {entry.scenario ? entry.scenario.replace('_', ' ') : 'General interview'}
                    </div>
                    <div className="text-[11px] text-slate-500">{formatDate(entry.started_at)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-lg font-bold tabular-nums ${scoreTone(entry.scores.overall)}`}>
                      {entry.scores.overall ?? '—'}
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-600" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
