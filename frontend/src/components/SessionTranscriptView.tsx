import React, { useEffect, useState } from 'react';
import { MessageSquare, Sparkles, User } from 'lucide-react';
import { fetchSessionTranscript, SessionTranscriptResponse, describeApiError } from '../lib/api';
import {
  EmptyState,
  ErrorNote,
  Page,
  PageHeader,
  RefreshButton,
  SkeletonLines,
  cx,
} from './ui';

interface SessionTranscriptViewProps {
  sessionId: string;
  onBack: () => void;
  onOpenReport?: (id: string) => void;
}

export const SessionTranscriptView: React.FC<SessionTranscriptViewProps> = ({
  sessionId,
  onBack,
  onOpenReport,
}) => {
  const [data, setData] = useState<SessionTranscriptResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchSessionTranscript(sessionId);
      setData(resp);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [sessionId]);

  const formatDuration = (seconds: number | null) => {
    if (seconds === null || seconds === undefined) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const formatDate = (isoString: string | null) => {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Page className="flex flex-col">
      <PageHeader
        eyebrow={data ? `${formatDate(data.session.started_at)} · ${formatDuration(data.session.duration_s)} · ${data.turns.length} turns` : 'Transcript'}
        title={data?.session.scenario ? data.session.scenario.replace('_', ' ') : 'Session transcript'}
        description="Exactly what was said, in order."
        onBack={onBack}
        backLabel="Back to past sessions"
        actions={
          <>
            {onOpenReport && (
              <button onClick={() => onOpenReport(sessionId)} className="btn-primary px-3 py-2">
                <Sparkles className="h-3.5 w-3.5" />
                <span>View report</span>
              </button>
            )}
            <RefreshButton onClick={() => void load()} loading={loading} />
          </>
        }
      />

      {loading && (
        <div className="panel p-5">
          <SkeletonLines rows={6} />
        </div>
      )}

      {error && !loading && <ErrorNote message={error} onRetry={() => void load()} />}

      {!loading && !error && data && data.turns.length === 0 && (
        <EmptyState
          icon={<MessageSquare className="h-5 w-5" />}
          title="No transcript recorded"
          description="This session ended before any speech was transcribed."
        />
      )}

      {!loading && !error && data && data.turns.length > 0 && (
        <div className="space-y-4 pb-8">
          {data.turns.map((turn) => {
            const isUser = turn.speaker === 'user';
            return (
              <div
                key={turn.idx}
                className={cx('flex items-start gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row')}
              >
                <div
                  className={cx(
                    'grid h-8 w-8 flex-none place-items-center rounded-xl border',
                    isUser
                      ? 'border-primary/30 bg-primary/15 text-primary-glow'
                      : 'border-cyan-400/20 bg-cyan-400/10 text-cyan-300',
                  )}
                >
                  {isUser ? <User className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                </div>

                <div
                  className={cx(
                    'max-w-[82%] rounded-2xl border px-4 py-2.5 text-sm leading-relaxed',
                    isUser
                      ? 'rounded-tr-sm border-primary/25 bg-primary/[0.12] text-slate-100'
                      : 'rounded-tl-sm border-white/[0.07] bg-white/[0.04] text-slate-100',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-4">
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-400">
                      {isUser ? 'You' : 'Coach'}
                    </span>
                    {turn.started_at_ms !== null && (
                      <span className="font-mono text-[9px] text-slate-500">
                        {Math.round(turn.started_at_ms / 1000)}s
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap">{turn.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Page>
  );
};
