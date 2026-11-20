import React, { useEffect, useState } from 'react';
import { ArrowLeft, Clock, MessageSquare, AlertCircle, RefreshCw, Sparkles } from 'lucide-react';
import { fetchSessions, SessionSummary, describeApiError } from '../lib/api';

interface SessionsListProps {
  onSelectSession: (id: string) => void;
  onOpenReport: (id: string) => void;
  onBackToCall: () => void;
}
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
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBackToCall}
            className="p-2 rounded-lg bg-surface border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Back to live interview"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold text-white tracking-wide">Past Sessions</h2>
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
          <p className="text-sm">Loading your interview sessions...</p>
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

      {!loading && !error && sessions.length === 0 && (
        <div className="text-center py-20 bg-surface/40 border border-slate-800/80 rounded-2xl p-8">
          <MessageSquare className="w-12 h-12 mx-auto text-slate-600 mb-3" />
          <h3 className="text-base font-semibold text-slate-200">No sessions yet</h3>
          <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">
            Start a live mock interview to practice your speaking skills and see your transcripts here.
          </p>
          <button
            onClick={onBackToCall}
            className="mt-5 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-medium shadow-lg shadow-blue-500/20 transition-all"
          >
            Start Practice Call
          </button>
        </div>
      )}

      {!loading && !error && sessions.length > 0 && (
        <div className="space-y-3">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="p-4 rounded-xl bg-surface/60 border border-slate-800/80 hover:border-slate-700/80 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-slate-200 capitalize">
                    {s.scenario ? s.scenario.replace('_', ' ') : 'General Interview'}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-mono uppercase font-bold border ${
                      s.status === 'completed'
                        ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800/60'
                        : s.status === 'active'
                        ? 'bg-blue-950/50 text-blue-300 border-blue-800/60'
                        : 'bg-amber-950/50 text-amber-300 border-amber-800/60'
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span>{formatDate(s.started_at)}</span>
                  <span>•</span>
                  <span className="flex items-center space-x-1">
                    <Clock className="w-3 h-3 text-slate-500" />
                    <span>{formatDuration(s.duration_s)}</span>
                  </span>
                  <span>•</span>
                  <span className="flex items-center space-x-1">
                    <MessageSquare className="w-3 h-3 text-slate-500" />
                    <span>{s.turn_count} turns</span>
                  </span>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {s.report_status === 'ready' && s.overall_score !== null && s.overall_score !== undefined && (
                  <span
                    className={`text-sm font-bold tabular-nums px-2 py-0.5 rounded-lg border ${
                      s.overall_score >= 75
                        ? 'text-emerald-300 bg-emerald-950/40 border-emerald-800/50'
                        : s.overall_score >= 50
                        ? 'text-amber-300 bg-amber-950/40 border-amber-800/50'
                        : 'text-rose-300 bg-rose-950/40 border-rose-800/50'
                    }`}
                    title="Overall report score"
                  >
                    {Math.round(s.overall_score)}
                  </span>
                )}
                <button
                  onClick={() => onSelectSession(s.id)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors border border-slate-700/60"
                >
                  Transcript
                </button>
                <button
                  onClick={() => onOpenReport(s.id)}
                  className="flex items-center space-x-1 px-3.5 py-1.5 rounded-lg bg-primary/15 hover:bg-primary/25 text-xs font-medium text-primary-glow transition-colors border border-primary/30"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{s.report_status === 'failed' ? 'Retry report' : 'Report'}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
