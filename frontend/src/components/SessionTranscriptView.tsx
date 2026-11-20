import React, { useEffect, useState } from 'react';
import { ArrowLeft, MessageSquare, AlertCircle, RefreshCw, User, Bot } from 'lucide-react';
import { fetchSessionTranscript, SessionTranscriptResponse, describeApiError } from '../lib/api';

interface SessionTranscriptViewProps {
  sessionId: string;
  onBack: () => void;
}

export const SessionTranscriptView: React.FC<SessionTranscriptViewProps> = ({
  sessionId,
  onBack,
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
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-4xl mx-auto w-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg bg-surface border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Back to sessions list"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-white tracking-wide">
              {data?.session.scenario ? data.session.scenario.replace('_', ' ') : 'Interview Transcript'}
            </h2>
            {data && (
              <p className="text-xs text-slate-400 mt-0.5">
                {formatDate(data.session.started_at)} • {formatDuration(data.session.duration_s)} • {data.turns.length} turns
              </p>
            )}
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
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3 flex-1">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm">Loading transcript...</p>
        </div>
      )}

      {error && !loading && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0 text-red-400" />
          <div>
            <p className="text-sm font-medium">{error}</p>
            <button
              onClick={load}
              className="mt-2 text-xs text-red-200 underline hover:text-white"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {!loading && !error && data && data.turns.length === 0 && (
        <div className="text-center py-20 bg-surface/40 border border-slate-800/80 rounded-2xl p-8 flex-1 flex flex-col items-center justify-center">
          <MessageSquare className="w-12 h-12 text-slate-600 mb-3" />
          <h3 className="text-base font-semibold text-slate-200">No transcript recorded</h3>
          <p className="text-sm text-slate-400 mt-1 max-w-sm">
            This session ended before any speech was transcribed.
          </p>
        </div>
      )}

      {!loading && !error && data && data.turns.length > 0 && (
        <div className="space-y-4 pb-12 flex-1">
          {data.turns.map((turn) => {
            const isUser = turn.speaker === 'user';
            return (
              <div
                key={turn.idx}
                className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isUser
                      ? 'bg-primary/20 text-primary border border-primary/30'
                      : 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                  }`}
                >
                  {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>

                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    isUser
                      ? 'bg-blue-600/20 border border-blue-500/30 text-blue-50 rounded-tr-none'
                      : 'bg-surface/80 border border-slate-800 text-slate-200 rounded-tl-none shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between gap-4 mb-1 text-[11px] font-mono text-slate-400">
                    <span className="font-semibold text-slate-300">
                      {isUser ? 'You' : 'Interviewer'}
                    </span>
                    {turn.started_at_ms !== null && (
                      <span>{Math.round(turn.started_at_ms / 1000)}s</span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap">{turn.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
