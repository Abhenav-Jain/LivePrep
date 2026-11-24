import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Clock,
  FileText,
  Flame,
  Gauge,
  Lightbulb,
  MessageSquareQuote,
  Mic,
  Repeat2,
  Sparkles,
  Target,
  TrendingUp,
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
import {
  ErrorNote,
  Page,
  PageHeader,
  RefreshButton,
  SectionCard,
  cx,
} from './ui';

interface ReportViewProps {
  sessionId: string;
  onBack: () => void;
  onOpenTranscript: (id: string) => void;
  onOpenWordBank: () => void;
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

export const ReportView: React.FC<ReportViewProps> = ({
  sessionId,
  onBack,
  onOpenTranscript,
  onOpenWordBank,
}) => {
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
  // Reports stored before the communication-coach rubric used interview_feedback.
  const feedback = report?.communication_feedback
    ?? (report?.interview_feedback
      ? {
          clarity: report.interview_feedback.relevance,
          structure: report.interview_feedback.structure,
          confidence: report.interview_feedback.confidence,
          comments: report.interview_feedback.comments,
        }
      : null);

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
    <Page>
      <PageHeader
        eyebrow={`${formatDate(data?.updated_at ?? null) || 'Session analysis'}${
          report?.rubric_version ? ` · rubric ${report.rubric_version}` : ''
        }`}
        title="Session report"
        icon={<Sparkles className="h-6 w-6 text-primary-glow" />}
        description="What went well, what to fix, and exactly what to practise next."
        onBack={onBack}
        backLabel="Back to past sessions"
        actions={
          <>
            <button onClick={() => onOpenTranscript(sessionId)} className="btn-ghost px-3 py-2">
              <FileText className="h-3.5 w-3.5" />
              <span>Transcript</span>
            </button>
            <RefreshButton onClick={() => void load()} loading={loading} />
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} onRetry={() => void load()} />
        </div>
      )}

      {/* Pending / generating */}
      {data?.status === 'pending' && (
        <div className="panel flex flex-col items-center px-6 py-16 text-center">
          <div className="relative mb-5 h-16 w-16">
            <div className="absolute inset-0 rounded-full border border-white/10" />
            <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary" />
            <Sparkles className="absolute inset-0 m-auto h-5 w-5 text-primary-glow" />
          </div>
          <h3 className="text-xl text-white">Your coach is reviewing the call</h3>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-400">
            Scoring fluency, vocabulary, grammar, communication and pace. This usually takes under a minute.
          </p>
          {polls >= MAX_POLLS && (
            <button onClick={() => void load()} className="btn-ghost mt-5 px-4 py-2">
              Taking longer than usual — check again
            </button>
          )}
        </div>
      )}

      {/* Failed */}
      {data?.status === 'failed' && (
        <div className="panel flex flex-col items-center border-rose-500/20 px-6 py-14 text-center">
          <AlertCircle className="mb-3 h-9 w-9 text-rose-400" />
          <h3 className="text-xl text-white">We could not build this report</h3>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-400">
            {data.error || 'The analysis failed. Your transcript is safe — try again.'}
          </p>
          <button onClick={() => void handleRetry()} disabled={retrying} className="btn-primary mt-5 px-4 py-2.5">
            <Repeat2 className={cx('h-4 w-4', retrying && 'animate-spin')} />
            <span>{retrying ? 'Rebuilding report…' : 'Retry report'}</span>
          </button>
        </div>
      )}

      {/* Missing: the call ended but no report row exists (auto-generation never ran) */}
      {data?.status === 'missing' && (
        <div className="panel flex flex-col items-center px-6 py-14 text-center">
          <Sparkles className="mb-3 h-9 w-9 text-primary-glow" />
          <h3 className="text-xl text-white">No report for this session yet</h3>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-400">
            The transcript is saved. Generate the analysis now to see your scores and action plan.
          </p>
          <button onClick={() => void handleRetry()} disabled={retrying} className="btn-primary mt-5 px-4 py-2.5">
            <Sparkles className={cx('h-4 w-4', retrying && 'animate-pulse')} />
            <span>{retrying ? 'Building report…' : 'Generate report'}</span>
          </button>
        </div>
      )}

      {/* Too short */}
      {data?.status === 'ready' && report?.too_short && (
        <div className="space-y-4">
          <SectionCard icon={<Clock className="h-3.5 w-3.5 text-amber-400" />} title="Session too short to score">
            <p className="text-sm leading-relaxed text-slate-300">{report.summary}</p>
            {data.metrics && (
              <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-slate-400">
                <span>{data.metrics.user_word_count} words</span>
                <span>{data.metrics.user_turn_count} answer(s)</span>
                {data.metrics.words_per_minute !== null && <span>{data.metrics.words_per_minute} wpm</span>}
              </div>
            )}
          </SectionCard>
          <ActionPlan steps={report.action_plan} />
        </div>
      )}

      {/* Ready, scored */}
      {data?.status === 'ready' && report && !report.too_short && report.scores && (
        <div className="space-y-4 pb-6">
          {/* Hero */}
          <section className="panel-strong flex flex-col items-center gap-6 p-5 sm:flex-row sm:p-6">
            <ScoreRing value={report.scores.overall} caption="Overall" />
            <div className="flex-1 text-center sm:text-left">
              <div className="mb-2.5 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <span className="chip border-primary/30 bg-primary/10 text-primary-glow">
                  CEFR {report.estimated_cefr ?? '—'}
                </span>
                {previous?.overall !== undefined && previous?.overall !== null && (
                  <span
                    className={cx(
                      'chip',
                      report.scores.overall >= previous.overall
                        ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-300',
                    )}
                  >
                    {report.scores.overall >= previous.overall ? '▲' : '▼'}{' '}
                    {Math.abs(Math.round(report.scores.overall - previous.overall))} vs last session
                  </span>
                )}
              </div>
              <p className="text-sm leading-relaxed text-slate-300">{report.summary}</p>
              <div className="mt-3 inline-flex items-start gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] px-3 py-2 text-left">
                <Target className="mt-0.5 h-3.5 w-3.5 flex-none text-cyan-300" />
                <span className="text-[11px] leading-relaxed text-cyan-100">{report.next_session_focus}</span>
              </div>
            </div>
          </section>

          {/* Best moment: one real sentence from the call, quoted back */}
          {report.best_moment && (
            <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4 sm:p-5">
              <h3 className="eyebrow mb-2 flex items-center gap-1.5 text-emerald-300/80">
                <MessageSquareQuote className="h-3.5 w-3.5" /> Your best moment
              </h3>
              <p className="text-lg italic leading-relaxed text-emerald-50/90">
                &ldquo;{report.best_moment}&rdquo;
              </p>
              <p className="mt-2 text-[10px] text-emerald-200/45">
                Your own sentence from the call. Reuse it as a model next time.
              </p>
            </section>
          )}

          {/* Score cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {scoreLabels.map(({ key, label, hint }) => (
              <ScoreBar
                key={key}
                label={label}
                value={report.scores![key] as number}
                previous={(previous?.[key] as number | undefined) ?? null}
                hint={hint}
              />
            ))}
            <div className="rounded-xl border border-dashed border-white/[0.09] bg-white/[0.015] p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium text-slate-400">Pronunciation</span>
                <span className="text-[10px] text-slate-600">soon</span>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                {report.notes?.pronunciation || 'Audio-based pronunciation analysis is coming soon.'}
              </p>
            </div>
          </div>

          {/* Objective metrics */}
          {data.metrics && (
            <SectionCard
              title="Objective metrics"
              icon={<Gauge className="h-3.5 w-3.5 text-cyan-400" />}
            >
              <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-3 lg:grid-cols-6">
                <Metric label="Words" value={data.metrics.user_word_count} />
                <Metric
                  label="Pace"
                  value={data.metrics.words_per_minute === null ? '—' : `${Math.round(data.metrics.words_per_minute)}`}
                  suffix={data.metrics.words_per_minute === null ? undefined : 'wpm'}
                />
                <Metric label="Fillers*" value={data.metrics.filler_count} title={report.notes?.filler} />
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
                    <span key={word} className="chip normal-case tracking-normal text-slate-300">
                      {word} ×{count}
                    </span>
                  ))}
                </div>
              )}
            </SectionCard>
          )}

          {/* Strengths + communication feedback */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <SectionCard title="What worked" icon={<Flame className="h-3.5 w-3.5 text-emerald-400" />}>
              <ul className="space-y-2">
                {report.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-slate-300">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-400" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>

            {feedback && (
              <SectionCard
                title="Communication feedback"
                icon={<MessageSquareQuote className="h-3.5 w-3.5 text-purple-300" />}
              >
                <div className="space-y-2.5">
                  <ScoreBar label="Clarity" value={feedback.clarity} />
                  <ScoreBar label="Structure" value={feedback.structure} />
                  <ScoreBar label="Confidence" value={feedback.confidence} />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-400">{feedback.comments}</p>
              </SectionCard>
            )}
          </div>

          {/* Grammar mistakes */}
          <SectionCard title="Grammar fixes" icon={<Wrench className="h-3.5 w-3.5 text-amber-400" />}>
            {report.grammar_mistakes.length === 0 ? (
              <p className="text-sm text-slate-400">No clear grammar errors were found in this session.</p>
            ) : (
              <div className="space-y-2">
                {report.grammar_mistakes.map((m, i) => (
                  <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-rose-300/90 line-through decoration-rose-500/40">{m.said}</span>
                      <span className="text-slate-600">→</span>
                      <span className="text-emerald-300">{m.better}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">{m.rule}</p>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Words to upgrade */}
          {report.words_to_upgrade.length > 0 && (
            <SectionCard title="Words to upgrade" icon={<Repeat2 className="h-3.5 w-3.5 text-cyan-400" />}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {report.words_to_upgrade.map((w, i) => (
                  <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <span className="text-sm text-slate-300">{w.used}</span>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {w.alternatives.map((alt) => (
                        <span
                          key={alt}
                          className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] text-primary-glow"
                        >
                          {alt}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Action plan */}
          <ActionPlan steps={report.action_plan} />

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
            <p className="max-w-md text-xs leading-relaxed text-slate-400">
              Practise these five steps before your next session to move your score.
              {report.words_to_upgrade.length + report.grammar_mistakes.length > 0 &&
                ' Your words and fixes were added to the word bank automatically.'}
            </p>
            <div className="flex items-center gap-2">
              {report.words_to_upgrade.length + report.grammar_mistakes.length > 0 && (
                <button onClick={onOpenWordBank} className="btn-primary px-3.5 py-2">
                  <Repeat2 className="h-3.5 w-3.5" />
                  <span>Practise these words</span>
                </button>
              )}
              <button onClick={() => onOpenTranscript(sessionId)} className="btn-ghost px-3.5 py-2">
                <Mic className="h-3.5 w-3.5" />
                <span>Review what you said</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* No data at all (should be rare) */}
      {!loading && !error && !data && (
        <div className="panel flex flex-col items-center px-6 py-14 text-center">
          <BarChart3 className="h-8 w-8 text-slate-500" />
          <p className="mt-3 text-sm text-slate-300">No report data.</p>
          <button onClick={() => void load()} className="btn-ghost mt-4 px-4 py-2">
            Reload
          </button>
        </div>
      )}
    </Page>
  );

  function ActionPlan({ steps }: { steps: ReportAnalysis['action_plan'] }) {
    return (
      <SectionCard
        title="Your 5-step action plan"
        icon={<Lightbulb className="h-3.5 w-3.5 text-amber-300" />}
        description="Tick a step when you have practised it."
      >
        <div className="space-y-2">
          {steps.map((step, i) => {
            const done = openStep[i] ?? false;
            return (
              <label
                key={i}
                className={cx(
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                  done
                    ? 'border-emerald-400/20 bg-emerald-400/[0.06]'
                    : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]',
                )}
              >
                <input
                  type="checkbox"
                  checked={done}
                  onChange={() => setOpenStep((prev) => ({ ...prev, [i]: !done }))}
                  className="mt-1 h-4 w-4 rounded accent-emerald-500"
                  aria-label={`Mark step ${i + 1} as done`}
                />
                <span className="flex-1">
                  <span className={cx('block text-sm leading-relaxed', done ? 'text-slate-500 line-through' : 'text-slate-200')}>
                    {step.step}
                  </span>
                  <span className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
                    <TrendingUp className="mt-0.5 h-3 w-3 flex-none" />
                    Daily: {step.daily_exercise}
                  </span>
                </span>
                <span className="text-[10px] text-slate-600">{String(i + 1).padStart(2, '0')}</span>
              </label>
            );
          })}
        </div>
      </SectionCard>
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
    <div className="text-xl leading-none tabular-nums text-white">
      {value}
      {suffix && <span className="ml-1 font-sans text-[10px] font-normal text-slate-500">{suffix}</span>}
    </div>
    <div className="mt-1.5 text-[9px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
  </div>
);
