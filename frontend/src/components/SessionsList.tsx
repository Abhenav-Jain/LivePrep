import React, { useEffect, useState } from 'react';
import { Clock, History, MessageSquare, Sparkles, ArrowRight } from 'lucide-react';
import { fetchSessions, SessionSummary, describeApiError } from '../lib/api';
import {
  EmptyState,
  ErrorNote,
  Page,
  PageHeader,
  RefreshButton,
  SkeletonLines,
  cx,
} from './ui';

interface SessionsListProps {
  onSelectSession: (id: string) => void;
  onOpenReport: (id: string) => void;
  onBackToCall: () => void;
}

const scoreChip = (score: number): string =>
  score >= 75
    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
    : score >= 50
    ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
    : 'border-rose-500/30 bg-rose-500/10 text-rose-300';

export const SessionsList: React.FC<SessionsListProps> = ({
  onSelectSession,
  onOpenReport,
  onBackToCall,
}) => {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSessions(50, 0);
      setSessions(data);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const formatDuration = (seconds: number | null) => {
    if (seconds === null || seconds === undefined) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const formatDate = (isoString: string | null) => {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Your history"
        title="Past sessions"
        icon={<History className="h-6 w-6 text-primary-glow" />}
        description="Every call you have made, with its transcript and report."
        onBack={onBackToCall}
        backLabel="Back to practice"
        actions={<RefreshButton onClick={() => void load()} loading={loading} />}
      />

      {loading && (
        <div className="panel p-5">
          <SkeletonLines rows={5} />
        </div>
      )}

      {error && !loading && <ErrorNote message={error} onRetry={() => void load()} />}

      {!loading && !error && sessions.length === 0 && (
        <EmptyState
          icon={<MessageSquare className="h-5 w-5" />}
          title="No sessions yet"
          description="Start a live conversation to practise your English — your transcripts and reports will collect here."
          action={
            <button onClick={onBackToCall} className="btn-primary px-4 py-2.5">
              Start a practice call
            </button>
          }
        />
      )}

      {!loading && !error && sessions.length > 0 && (
        <div className="space-y-2.5 pb-6">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="panel card-hover flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold capitalize text-slate-100">
                    {s.scenario ? s.scenario.replace('_', ' ') : 'Practice session'}
                  </span>
                  <span
                    className={cx(
                      'rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider',
                      s.status === 'completed'
                        ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                        : 'border-white/10 bg-white/[0.04] text-slate-400',
                    )}
                  >
                    {s.status}
                  </span>
                  {s.report_status === 'pending' && (
                    <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-300">
                      report building
                    </span>
                  )}
                  {s.report_status === 'failed' && (
                    <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-rose-300">
                      report failed
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  <span>{formatDate(s.started_at)}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDuration(s.duration_s)}
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" />
                    {s.turn_count} turns
                  </span>
                </div>
              </div>

              <div className="flex flex-none items-center gap-2">
                {s.report_status === 'ready' && s.overall_score !== null && s.overall_score !== undefined && (
                  <span
                    className={cx(
                      'rounded-lg border px-2 py-0.5 font-display text-lg leading-none tabular-nums',
                      scoreChip(s.overall_score),
                    )}
                    title="Overall report score"
                  >
                    {Math.round(s.overall_score)}
                  </span>
                )}
                <button onClick={() => onSelectSession(s.id)} className="btn-ghost px-3 py-2">
                  Transcript
                </button>
                <button onClick={() => onOpenReport(s.id)} className="btn gap-1 border border-primary/30 bg-primary/[0.12] px-3 py-2 text-primary-glow hover:bg-primary/20">
                  <Sparkles className="h-3 w-3" />
                  <span>
                    {s.report_status === 'ready'
                      ? 'Report'
                      : s.report_status === 'failed'
                      ? 'Retry'
                      : 'Generate'}
                  </span>
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
};
