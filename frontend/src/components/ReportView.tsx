import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  Flame,
  Gauge,
  Lightbulb,
  MessageSquareQuote,
  Mic,
  RefreshCw,
  Repeat2,
  Sparkles,
  Target,
  Wrench,
} from 'lucide-react';
import {
  fetchSessionReport,
  retrySessionReport,
  ReportAnalysis,
  ReportResponse,
  describeApiError,
} from '../lib/api';
import { ScoreBar, ScoreRing } from './ReportCharts';

interface ReportViewProps {
  sessionId: string;
  onBack: () => void;
  onOpenTranscript: (id: string) => void;
}

const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 40;

const scoreLabels: { key: keyof NonNullable<ReportAnalysis['scores']>; label: string; hint?: string }[] = [
  { key: 'fluency', label: 'Fluency', hint: 'Flow, hesitation, self-correction' },
  { key: 'vocabulary', label: 'Vocabulary', hint: 'Range and precision of words' },
  { key: 'grammar', label: 'Grammar', hint: 'Tense, agreement, articles' },
  { key: 'communication', label: 'Communication', hint: 'Clarity, relevance, structure' },
  { key: 'pace', label: 'Pace', hint: 'Comfortable speaking speed' },
];

export const ReportView: React.FC<ReportViewProps> = ({ sessionId, onBack, onOpenTranscript }) => {
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<boolean>(false);
  const [polls, setPolls] = useState<number>(0);
  const [openStep, setOpenStep] = useState<Record<number, boolean>>({});
  const timerRef = useRef<number | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const resp = await fetchSessionReport(sessionId);
        setData(resp);
      } catch (err) {
        setError(describeApiError(err));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    setData(null);
    setPolls(0);
    void load();
  }, [load]);

  // Poll while the server is still building the report.
  useEffect(() => {
    if (!data || data.status !== 'pending' || polls >= MAX_POLLS) return undefined;
    timerRef.current = window.setTimeout(() => {
      setPolls((n) => n + 1);
      void load(true);
    }, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [data, polls, load]);

  const handleRetry = async () => {
    setRetrying(true);
    setError(null);
    try {
      const resp = await retrySessionReport(sessionId);
      // A rebuild can answer "pending": start the polling budget fresh, otherwise a page that
      // already used up MAX_POLLS would sit on the spinner without ever checking again.
      setPolls(0);
      setData(resp);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setRetrying(false);
    }
  };

  const report = data?.report ?? null;
  const previous = data?.previous?.scores ?? null;

  const formatDate = (iso: string | null) => {
    if (!iso) return '';
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-5xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg bg-surface border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Back to past sessions"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-white tracking-wide flex items-center space-x-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <span>Session Report</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {formatDate(data?.updated_at ?? null)}
              {report?.rubric_version && ` • rubric ${report.rubric_version}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onOpenTranscript(sessionId)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-surface border border-slate-800 hover:border-slate-700 text-xs text-slate-300 hover:text-white transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Transcript</span>
          </button>
          <button
            onClick={() => void load()}
            disabled={loading || retrying}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-surface border border-slate-800 hover:border-slate-700 text-xs text-slate-300 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 flex items-start space-x-3 mb-4">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0 text-red-400" />
          <div>
            <p className="text-sm font-medium">{error}</p>
            <button onClick={() => void load()} className="mt-2 text-xs text-red-200 underline hover:text-white">
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Pending / generating */}
      {data?.status === 'pending' && (
        <div className="text-center py-16 bg-surface/40 border border-slate-800/80 rounded-2xl p-8">
          <div className="relative w-16 h-16 mx-auto mb-4">
            <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
            <Sparkles className="absolute inset-0 m-auto w-6 h-6 text-primary" />
          </div>
          <h3 className="text-base font-semibold text-slate-200">Your coach is reviewing the call</h3>
          <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
            Scoring fluency, vocabulary, grammar, communication and pace. This usually takes under a minute.
          </p>
          {polls >= MAX_POLLS && (
            <button
              onClick={() => void load()}
              className="mt-4 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200"
            >
              Taking longer than usual — check again
            </button>
          )}
        </div>
      )}

      {/* Failed */}
      {data?.status === 'failed' && (
        <div className="text-center py-14 bg-surface/40 border border-rose-900/50 rounded-2xl p-8">
          <AlertCircle className="w-10 h-10 mx-auto text-rose-400 mb-3" />
          <h3 className="text-base font-semibold text-slate-100">We could not build this report</h3>
          <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
            {data.error || 'The analysis failed. Your transcript is safe — try again.'}
          </p>
          <button
            onClick={() => void handleRetry()}
            disabled={retrying}
            className="mt-5 inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-medium shadow-lg shadow-blue-500/20 transition-all disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
            <span>{retrying ? 'Rebuilding report…' : 'Retry report'}</span>
          </button>
        </div>
      )}

      {/* Missing: the call ended but no report row exists (auto-generation never ran) */}
      {data?.status === 'missing' && (
        <div className="text-center py-14 bg-surface/40 border border-slate-800/80 rounded-2xl p-8">
          <Sparkles className="w-10 h-10 mx-auto text-primary mb-3" />
          <h3 className="text-base font-semibold text-slate-100">No report for this session yet</h3>
          <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
            The transcript is saved. Generate the analysis now to see your scores and action plan.
          </p>
          <button
            onClick={() => void handleRetry()}
            disabled={retrying}
            className="mt-5 inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-medium shadow-lg shadow-blue-500/20 transition-all disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
            <span>{retrying ? 'Building report…' : 'Generate report'}</span>
          </button>
        </div>
      )}

      {/* Too short */}
      {data?.status === 'ready' && report?.too_short && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-surface/60 border border-slate-800/80 p-6">
            <div className="flex items-start space-x-3">
              <Clock className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-semibold text-slate-100">Session too short to score</h3>
                <p className="text-sm text-slate-400 mt-1">{report.summary}</p>
                {data.metrics && (
                  <div className="flex flex-wrap gap-4 mt-3 text-xs text-slate-400 font-mono">
                    <span>{data.metrics.user_word_count} words</span>
                    <span>{data.metrics.user_turn_count} answer(s)</span>
                    {data.metrics.words_per_minute !== null && <span>{data.metrics.words_per_minute} wpm</span>}
                  </div>
                )}
              </div>
            </div>
          </div>
          <ActionPlan steps={report.action_plan} />
        </div>
      )}

      {/* Ready, scored */}
      {data?.status === 'ready' && report && !report.too_short && report.scores && (
        <div className="space-y-4 pb-10">
          {/* Hero */}
          <div className="rounded-2xl bg-gradient-to-br from-surface/90 to-slate-900/80 border border-slate-800/80 p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <ScoreRing value={report.scores.overall} caption="Overall" />
              <div className="flex-1 text-center sm:text-left">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-primary-glow text-[11px] font-mono font-bold">
                    CEFR {report.estimated_cefr ?? '—'}
                  </span>
                  {previous?.overall !== undefined && previous?.overall !== null && (
                    <span
                      className={`px-2 py-0.5 rounded-full border text-[11px] font-mono ${
                        report.scores.overall >= previous.overall
                          ? 'bg-emerald-950/50 border-emerald-800/60 text-emerald-300'
                          : 'bg-rose-950/50 border-rose-800/60 text-rose-300'
                      }`}
                    >
                      {report.scores.overall >= previous.overall ? '▲' : '▼'}{' '}
                      {Math.abs(Math.round(report.scores.overall - previous.overall))} vs last session
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-300 leading-relaxed">{report.summary}</p>
                <div className="flex items-center justify-center sm:justify-start gap-2 mt-3">
                  <Target className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs text-cyan-200">{report.next_session_focus}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Score cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {scoreLabels.map(({ key, label, hint }) => (
              <ScoreBar
                key={key}
                label={label}
                value={report.scores![key] as number}
                previous={(previous?.[key] as number | undefined) ?? null}
                hint={hint}
              />
            ))}
            <div className="rounded-xl bg-slate-900/40 border border-dashed border-slate-800 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium text-slate-400">Pronunciation</span>
                <span className="text-[10px] font-mono text-slate-500">soon</span>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                {report.notes?.pronunciation || 'Audio-based pronunciation analysis coming soon.'}
              </p>
            </div>
          </div>

          {/* Objective metrics */}
          {data.metrics && (
            <div className="rounded-2xl bg-surface/50 border border-slate-800/80 p-4">
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-cyan-400" /> Objective metrics
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
                <Metric label="Words" value={data.metrics.user_word_count} />
                <Metric
                  label="Pace"
                  value={data.metrics.words_per_minute === null ? '—' : `${Math.round(data.metrics.words_per_minute)}`}
                  suffix={data.metrics.words_per_minute === null ? undefined : 'wpm'}
                />
                <Metric
                  label="Fillers*"
                  value={data.metrics.filler_count}
                  title={report.notes?.filler}
                />
                <Metric label="Unique words" value={data.metrics.unique_word_count} />
                <Metric
                  label="Avg pause"
                  value={data.metrics.avg_pause_s === null ? '—' : `${data.metrics.avg_pause_s}s`}
                />
                <Metric
                  label="Avg answer"
                  value={
                    data.metrics.avg_turn_length_words === null
                      ? '—'
                      : `${Math.round(data.metrics.avg_turn_length_words)}`
                  }
                  suffix={data.metrics.avg_turn_length_words === null ? undefined : 'words'}
                />
              </div>
              <p className="mt-3 text-[10px] text-slate-500">* Approximate: transcription can miss filler words.</p>
              {data.metrics.filler_breakdown && Object.keys(data.metrics.filler_breakdown).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(data.metrics.filler_breakdown).map(([word, count]) => (
                    <span
                      key={word}
                      className="px-2 py-0.5 rounded bg-slate-800/70 border border-slate-700/60 text-[10px] font-mono text-slate-300"
                    >
                      {word} ×{count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Strengths + interview feedback */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-2xl bg-surface/50 border border-slate-800/80 p-4">
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-emerald-400" /> What worked
              </h3>
              <ul className="space-y-2">
                {report.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>

            {report.interview_feedback && (
              <div className="rounded-2xl bg-surface/50 border border-slate-800/80 p-4">
                <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                  <MessageSquareQuote className="w-3.5 h-3.5 text-purple-400" /> Interview feedback
                </h3>
                <div className="space-y-2.5">
                  <ScoreBar label="Relevance" value={report.interview_feedback.relevance} />
                  <ScoreBar label="Structure (STAR)" value={report.interview_feedback.structure} />
                  <ScoreBar label="Confidence" value={report.interview_feedback.confidence} />
                </div>
                <p className="mt-3 text-xs text-slate-400 leading-relaxed">
                  {report.interview_feedback.comments}
                </p>
              </div>
            )}
          </div>

          {/* Grammar mistakes */}
          <div className="rounded-2xl bg-surface/50 border border-slate-800/80 p-4">
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5 text-amber-400" /> Grammar fixes
            </h3>
            {report.grammar_mistakes.length === 0 ? (
              <p className="text-sm text-slate-400">No clear grammar errors were found in this session.</p>
            ) : (
              <div className="space-y-2">
                {report.grammar_mistakes.map((m, i) => (
                  <div key={i} className="rounded-xl bg-slate-900/60 border border-slate-800/70 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-rose-300 line-through decoration-rose-500/50">{m.said}</span>
                      <span className="text-slate-500">→</span>
                      <span className="text-emerald-300">{m.better}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">{m.rule}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Words to upgrade */}
          {report.words_to_upgrade.length > 0 && (
            <div className="rounded-2xl bg-surface/50 border border-slate-800/80 p-4">
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <Repeat2 className="w-3.5 h-3.5 text-cyan-400" /> Words to upgrade
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {report.words_to_upgrade.map((w, i) => (
                  <div key={i} className="rounded-xl bg-slate-900/60 border border-slate-800/70 p-3">
                    <span className="text-sm text-slate-300">{w.used}</span>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {w.alternatives.map((alt) => (
                        <span
                          key={alt}
                          className="px-2 py-0.5 rounded-full bg-primary/10 border border-primary/25 text-[11px] text-primary-glow"
                        >
                          {alt}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action plan */}
          <ActionPlan steps={report.action_plan} />

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900/40 border border-slate-800/70 p-4">
            <p className="text-xs text-slate-400">
              Practice these five steps before your next session to move your score.
            </p>
            <button
              onClick={() => onOpenTranscript(sessionId)}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700/60"
            >
              <Mic className="w-3.5 h-3.5" />
              <span>Review what you said</span>
            </button>
          </div>
        </div>
      )}

      {/* No data at all (should be rare) */}
      {!loading && !error && !data && (
        <div className="text-center py-16 text-slate-400">
          <p className="text-sm">No report data.</p>
          <button onClick={() => void load()} className="mt-3 text-xs underline hover:text-white">
            Reload
          </button>
        </div>
      )}
    </div>
  );

  function ActionPlan({ steps }: { steps: ReportAnalysis['action_plan'] }) {
    return (
      <div className="rounded-2xl bg-surface/50 border border-slate-800/80 p-4">
        <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
          <Lightbulb className="w-3.5 h-3.5 text-amber-300" /> Your 5-step action plan
        </h3>
        <div className="space-y-2">
          {steps.map((step, i) => {
            const done = openStep[i] ?? false;
            return (
              <label
                key={i}
                className={`flex items-start gap-3 p-3 rounded-xl border transition-colors cursor-pointer ${
                  done
                    ? 'bg-emerald-950/20 border-emerald-900/40'
                    : 'bg-slate-900/60 border-slate-800/70 hover:border-slate-700'
                }`}
              >
                <input
                  type="checkbox"
                  checked={done}
                  onChange={() => setOpenStep((prev) => ({ ...prev, [i]: !done }))}
                  className="mt-1 w-4 h-4 accent-emerald-500 rounded"
                  aria-label={`Mark step ${i + 1} as done`}
                />
                <span className="flex-1">
                  <span className={`block text-sm ${done ? 'text-slate-400 line-through' : 'text-slate-200'}`}>
                    {step.step}
                  </span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">Daily: {step.daily_exercise}</span>
                </span>
                <span className="text-[10px] font-mono text-slate-600">{i + 1}</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  }
};

const Metric: React.FC<{ label: string; value: React.ReactNode; suffix?: string; title?: string }> = ({
  label,
  value,
  suffix,
  title,
}) => (
  <div title={title}>
    <div className="text-lg font-bold text-slate-100 tabular-nums">
      {value}
      {suffix && <span className="text-[10px] font-normal text-slate-500 ml-1">{suffix}</span>}
    </div>
    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">{label}</div>
  </div>
);

