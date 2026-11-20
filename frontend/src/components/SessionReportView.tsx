import React, { useEffect, useState, useCallback } from 'react';
import {
  ArrowLeft,
  RefreshCw,
  AlertCircle,
  Clock,
  Sparkles,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  BookOpen,
  Zap,
  Target,
  FileText,
  CheckSquare,
  Square,
  Award,
  Layers,
  MessageSquare,
  HelpCircle,
} from 'lucide-react';
import {
  fetchReport,
  retryReport,
  ReportData,
  ReportResponse,
  describeApiError,
} from '../lib/api';

interface SessionReportViewProps {
  sessionId: string;
  onBack: () => void;
}

export const SessionReportView: React.FC<SessionReportViewProps> = ({
  sessionId,
  onBack,
}) => {
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<boolean>(false);
  const [pendingSeconds, setPendingSeconds] = useState<number>(0);

  // Interactive action plan checklist saved in localStorage
  const [completedSteps, setCompletedSteps] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem(`report_${sessionId}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const toggleStep = (stepNumber: number) => {
    const updated = completedSteps.includes(stepNumber)
      ? completedSteps.filter((s) => s !== stepNumber)
      : [...completedSteps, stepNumber];
    setCompletedSteps(updated);
    try {
      localStorage.setItem(`report_${sessionId}`, JSON.stringify(updated));
    } catch {
      // Ignore localStorage errors
    }
  };

  const loadReport = useCallback(
    async (isPolling = false) => {
      if (!isPolling) setLoading(true);
      setError(null);
      try {
        const res = await fetchReport(sessionId);
        setData(res);
        if (res.status === 'ready' || res.status === 'failed' || res.status === 'no_turns') {
          setLoading(false);
        }
      } catch (err) {
        setError(describeApiError(err));
        setLoading(false);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    void loadReport(false);
  }, [loadReport]);

  // Poll every 3 seconds while report is pending
  useEffect(() => {
    if (!data || data.status === 'pending') {
      const interval = setInterval(() => {
        setPendingSeconds((prev) => prev + 3);
        void loadReport(true);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [data, loadReport]);

  const handleRetry = async () => {
    setRetrying(true);
    setError(null);
    try {
      await retryReport(sessionId);
      setPendingSeconds(0);
      setData({ status: 'pending', report: null, metrics: null, previous: null });
      setLoading(true);
      void loadReport(false);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setRetrying(false);
    }
  };

  const getDeltaBadge = (current: number, prev: number | null | undefined) => {
    if (prev === null || prev === undefined) return null;
    const diff = current - prev;
    if (diff > 0) {
      return (
        <span className="inline-flex items-center text-[11px] font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.5 rounded ml-1.5">
          <TrendingUp className="w-3 h-3 mr-0.5" />
          +{diff}
        </span>
      );
    }
    if (diff < 0) {
      return (
        <span className="inline-flex items-center text-[11px] font-mono font-bold text-rose-400 bg-rose-950/60 border border-rose-800/60 px-1.5 py-0.5 rounded ml-1.5">
          <TrendingDown className="w-3 h-3 mr-0.5" />
          {diff}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center text-[11px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded ml-1.5">
        ±0
      </span>
    );
  };

  const getLevelColor = (level: string) => {
    switch (level.toUpperCase()) {
      case 'C1':
        return 'bg-purple-950/60 text-purple-300 border-purple-800/60';
      case 'B2':
        return 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60';
      case 'B1+':
      case 'B1':
        return 'bg-blue-950/60 text-blue-300 border-blue-800/60';
      default:
        return 'bg-amber-950/60 text-amber-300 border-amber-800/60';
    }
  };

  // 1. Loading & Pending state
  if (loading || (data && data.status === 'pending')) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6 animate-pulse">
          <Sparkles className="w-8 h-8 text-primary animate-spin" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Analyzing your speaking...</h2>
        <p className="text-sm text-slate-400 mb-6 leading-relaxed">
          Evaluating pronunciation rhythm, grammar accuracy, pacing, vocabulary range, and interview relevance. Usually takes 10–20 seconds.
        </p>

        <div className="w-full bg-slate-900 rounded-full h-1.5 mb-6 overflow-hidden border border-slate-800">
          <div
            className="bg-primary h-1.5 rounded-full transition-all duration-300 animate-pulse"
            style={{ width: `${Math.min(95, (pendingSeconds / 20) * 100)}%` }}
          />
        </div>

        {pendingSeconds > 120 && (
          <div className="space-y-3 p-4 rounded-xl bg-amber-950/40 border border-amber-800/50 text-amber-300 text-xs">
            <p>Analysis is taking longer than usual.</p>
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs transition-colors"
            >
              {retrying ? 'Retrying...' : 'Retry Report Generation'}
            </button>
          </div>
        )}

        <button
          onClick={onBack}
          className="mt-6 text-xs text-slate-500 hover:text-slate-300 underline"
        >
          Back to Sessions
        </button>
      </div>
    );
  }

  // 2. Failed state
  if (data?.status === 'failed' || error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
        <div className="w-14 h-14 rounded-2xl bg-rose-950/40 border border-rose-800/50 flex items-center justify-center mb-4 text-rose-400">
          <AlertCircle className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-bold text-white mb-2">Analysis Generation Failed</h2>
        <p className="text-sm text-slate-400 mb-6">
          {error || 'We encountered an issue analyzing this interview session. You can retry generating the report.'}
        </p>
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-xl bg-surface border border-slate-800 text-xs text-slate-300 hover:text-white"
          >
            Back to Sessions
          </button>
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold shadow-lg shadow-blue-500/20"
          >
            {retrying ? 'Retrying...' : 'Retry Analysis'}
          </button>
        </div>
      </div>
    );
  }

  // 3. No turns recorded
  if (data?.status === 'no_turns') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
        <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-4 text-slate-500">
          <MessageSquare className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-bold text-white mb-2">No Speech Detected</h2>
        <p className="text-sm text-slate-400 mb-6">
          This session concluded without any recorded user speech turns, so no speaking report could be created.
        </p>
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold"
        >
          Back to Sessions
        </button>
      </div>
    );
  }

  const report: ReportData = data?.report!;
  const prev = data?.previous;
  const metrics = data?.metrics;

  // Circular progress calculations for Overall score
  const overall = report.overall;
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (overall / 100) * circumference;

  const subscores = [
    { key: 'fluency', label: 'Fluency', value: report.scores.fluency, color: '#38bdf8' },
    { key: 'vocabulary', label: 'Vocabulary', value: report.scores.vocabulary, color: '#818cf8' },
    { key: 'grammar', label: 'Grammar', value: report.scores.grammar, color: '#34d399' },
    { key: 'communication', label: 'Communication', value: report.scores.communication, color: '#f472b6' },
    { key: 'pace', label: 'Pace', value: report.scores.pace, color: '#fbbf24' },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-4xl mx-auto w-full space-y-6">
      {/* Top Bar Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg bg-surface border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Back to Sessions"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white tracking-wide flex items-center space-x-2">
              <span>Speaking Performance Report</span>
            </h1>
            <p className="text-xs text-slate-400">Detailed diagnostic & personalized action plan</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              window.location.hash = `#/sessions/${sessionId}`;
            }}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-surface border border-slate-800 hover:border-slate-700 text-xs text-slate-300 hover:text-white transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>View Transcript</span>
          </button>
        </div>
      </div>

      {/* Brief Session Banner (Too short notice) */}
      {report.too_short && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-200 text-xs flex items-start space-x-3">
          <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <span className="font-semibold">Short Practice Session: </span>
            This session had less than 30 spoken words or 3 turns. Metrics and subscores are tentative baselines. Practice a full 3–5 minute session for deep diagnostic feedback.
          </div>
        </div>
      )}

      {/* Header Overview Card */}
      <div className="p-6 rounded-2xl bg-surface/70 border border-slate-800/80 shadow-xl backdrop-blur-sm grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
        {/* Left: Overall Ring */}
        <div className="md:col-span-4 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-slate-800 pb-6 md:pb-0 md:pr-6">
          <div className="relative w-36 h-36 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
              <circle
                cx="60"
                cy="60"
                r={radius}
                stroke="currentColor"
                strokeWidth="10"
                className="text-slate-800"
                fill="none"
              />
              <circle
                cx="60"
                cy="60"
                r={radius}
                stroke="url(#scoreGradient)"
                strokeWidth="10"
                fill="none"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-1000 ease-out"
              />
              <defs>
                <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-3xl font-extrabold text-white tracking-tight">{overall}</span>
              <span className="text-[10px] uppercase tracking-wider font-mono text-slate-400">Score / 100</span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-center space-x-2">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold border ${getLevelColor(report.estimated_level)}`}>
              CEFR {report.estimated_level}
            </span>
            {getDeltaBadge(overall, prev?.overall)}
          </div>
        </div>

        {/* Right: Subscores Bar Breakdown */}
        <div className="md:col-span-8 space-y-3">
          <h2 className="text-xs uppercase tracking-wider font-mono text-slate-400 font-bold mb-2">Core Skill Metrics</h2>
          <div className="space-y-2.5">
            {subscores.map((s) => {
              const prevSub = prev?.scores?.[s.key];
              return (
                <div key={s.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-300">{s.label}</span>
                    <div className="flex items-center space-x-1.5 font-mono">
                      <span className="font-bold text-white">{s.value}</span>
                      <span className="text-slate-500">/ 100</span>
                      {getDeltaBadge(s.value, prevSub)}
                    </div>
                  </div>
                  <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                    <div
                      className="h-2 rounded-full transition-all duration-700"
                      style={{ width: `${s.value}%`, backgroundColor: s.color }}
                    />
                  </div>
                </div>
              );
            })}

            {/* Pronunciation coming soon */}
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center space-x-1.5">
                <span>Pronunciation Precision</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  Coming Soon
                </span>
              </span>
              <span className="text-[11px] text-slate-500 italic">Raw audio analysis pending</span>
            </div>
          </div>
        </div>
      </div>

      {/* Summary & Strengths */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Performance Summary */}
        <div className="p-5 rounded-xl bg-surface/50 border border-slate-800/80 space-y-2">
          <h2 className="text-xs uppercase font-mono font-bold tracking-wider text-primary-glow flex items-center space-x-2">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span>Executive Summary</span>
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed">{report.summary}</p>
        </div>

        {/* Strengths */}
        <div className="p-5 rounded-xl bg-surface/50 border border-slate-800/80 space-y-2">
          <h2 className="text-xs uppercase font-mono font-bold tracking-wider text-emerald-400 flex items-center space-x-2">
            <Award className="w-3.5 h-3.5" />
            <span>Notable Strengths</span>
          </h2>
          <ul className="space-y-1.5">
            {report.strengths.map((s, idx) => (
              <li key={idx} className="flex items-start space-x-2 text-xs text-slate-300">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Flow & Delivery Diagnostics */}
      <div className="p-5 rounded-xl bg-surface/50 border border-slate-800/80 space-y-4">
        <h2 className="text-xs uppercase font-mono font-bold tracking-wider text-slate-300 flex items-center space-x-2">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span>Speech Delivery & Interaction Flow</span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/60 space-y-1">
            <span className="text-[11px] font-mono text-slate-400 uppercase font-bold">Answer Structure</span>
            <p className="text-xs text-slate-300">{report.flow.structure}</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/60 space-y-1">
            <span className="text-[11px] font-mono text-slate-400 uppercase font-bold">Turn Taking</span>
            <p className="text-xs text-slate-300">{report.flow.turn_taking}</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/60 space-y-1">
            <span className="text-[11px] font-mono text-slate-400 uppercase font-bold">Answer Length</span>
            <p className="text-xs text-slate-300">{report.flow.answer_length}</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/60 space-y-1">
            <span className="text-[11px] font-mono text-slate-400 uppercase font-bold">Hesitation & Pauses</span>
            <p className="text-xs text-slate-300">{report.flow.hesitation}</p>
          </div>
        </div>
      </div>

      {/* Say It Better Section */}
      {report.say_it_better && report.say_it_better.length > 0 && (
        <div className="p-5 rounded-xl bg-surface/50 border border-slate-800/80 space-y-3">
          <h2 className="text-xs uppercase font-mono font-bold tracking-wider text-primary-glow flex items-center space-x-2">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span>"Say It Better" Real Sentence Polish</span>
          </h2>
          <div className="space-y-3">
            {report.say_it_better.map((item, idx) => (
              <div key={idx} className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800/80 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
                  <div className="space-y-1">
                    <div className="flex items-start space-x-2">
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800/60">
                        Spoken
                      </span>
                      <span className="text-slate-300 italic">"{item.original}"</span>
                    </div>
                    <div className="flex items-start space-x-2 pt-1">
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
                        Polished
                      </span>
                      <span className="text-emerald-300 font-medium">"{item.improved}"</span>
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-slate-400 pl-2 border-l-2 border-primary/40">
                  {item.why}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grammar Section */}
      <div className="p-5 rounded-xl bg-surface/50 border border-slate-800/80 space-y-4">
        <h2 className="text-xs uppercase font-mono font-bold tracking-wider text-slate-300 flex items-center space-x-2">
          <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
          <span>Grammar & Syntax Precision</span>
        </h2>

        {report.grammar.mistakes && report.grammar.mistakes.length > 0 ? (
          <div className="space-y-2.5">
            {report.grammar.mistakes.map((m, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/60 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-200">
                    <span className="line-through text-rose-400 mr-2">"{m.said}"</span>
                    <span className="text-emerald-300 font-semibold">&rarr; "{m.better}"</span>
                  </span>
                  <span
                    className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                      m.severity === 'major'
                        ? 'bg-rose-950/60 text-rose-300 border-rose-800/60'
                        : 'bg-amber-950/60 text-amber-300 border-amber-800/60'
                    }`}
                  >
                    {m.severity}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">{m.rule}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 italic">No significant grammar mistakes detected.</p>
        )}

        {report.grammar.tips && report.grammar.tips.length > 0 && (
          <div className="pt-2 border-t border-slate-800/60">
            <span className="text-[11px] font-mono text-slate-400 uppercase font-bold">Quick Rules to Remember:</span>
            <ul className="mt-1.5 space-y-1">
              {report.grammar.tips.map((tip, idx) => (
                <li key={idx} className="text-xs text-slate-300 flex items-start space-x-1.5">
                  <span className="text-emerald-400 font-bold">•</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Vocabulary Upgrades */}
      <div className="p-5 rounded-xl bg-surface/50 border border-slate-800/80 space-y-4">
        <h2 className="text-xs uppercase font-mono font-bold tracking-wider text-slate-300 flex items-center space-x-2">
          <Layers className="w-3.5 h-3.5 text-indigo-400" />
          <span>Vocabulary & Lexical Upgrades</span>
        </h2>

        {report.vocabulary.repeated_or_basic && report.vocabulary.repeated_or_basic.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[11px] font-mono text-slate-400 uppercase font-bold">Frequently Repeated Words:</span>
            <div className="flex flex-wrap gap-1.5">
              {report.vocabulary.repeated_or_basic.map((w, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300"
                >
                  {w}
                </span>
              ))}
            </div>
          </div>
        )}

        {report.vocabulary.upgrades && report.vocabulary.upgrades.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            {report.vocabulary.upgrades.map((u, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/60 space-y-1.5">
                <div className="flex items-center space-x-2 text-xs">
                  <span className="text-slate-400">Instead of</span>
                  <span className="font-bold text-amber-300">"{u.used}"</span>
                  <span className="text-slate-400">&rarr; try</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {u.alternatives.map((alt, aidx) => (
                    <span
                      key={aidx}
                      className="px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-800/60 text-indigo-200 text-[11px] font-medium"
                    >
                      {alt}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 italic">Example: "{u.example}"</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Interview & Domain Feedback */}
      <div className="p-5 rounded-xl bg-surface/50 border border-slate-800/80 space-y-4">
        <h2 className="text-xs uppercase font-mono font-bold tracking-wider text-slate-300 flex items-center space-x-2">
          <Target className="w-3.5 h-3.5 text-cyan-400" />
          <span>Interview Coaching & Content Strategy</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/60 space-y-1">
            <span className="text-[10px] font-mono text-slate-400 uppercase font-bold">Answer Relevance</span>
            <p className="text-xs text-slate-300">{report.interview_feedback.relevance}</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/60 space-y-1">
            <span className="text-[10px] font-mono text-slate-400 uppercase font-bold">Structure (STAR/PAR)</span>
            <p className="text-xs text-slate-300">{report.interview_feedback.structure}</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/60 space-y-1">
            <span className="text-[10px] font-mono text-slate-400 uppercase font-bold">Vocal Confidence</span>
            <p className="text-xs text-slate-300">{report.interview_feedback.confidence}</p>
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <div className="p-3.5 rounded-lg bg-emerald-950/20 border border-emerald-800/40 space-y-1">
            <span className="text-[10px] font-mono text-emerald-400 uppercase font-bold">Strongest Response</span>
            <p className="text-xs text-slate-200">{report.interview_feedback.best_answer}</p>
          </div>

          <div className="p-3.5 rounded-lg bg-amber-950/20 border border-amber-800/40 space-y-1.5">
            <span className="text-[10px] font-mono text-amber-400 uppercase font-bold">Response Needing Improvement</span>
            <p className="text-xs text-slate-300">{report.interview_feedback.weakest_answer}</p>
            <div className="pt-1 text-xs text-amber-200 border-t border-amber-800/40">
              <span className="font-semibold">Coaching Tip: </span>
              {report.interview_feedback.how_to_fix_weakest}
            </div>
          </div>
        </div>
      </div>

      {/* 5-Step Action Plan (Interactive Checklist) */}
      <div className="p-5 rounded-xl bg-surface/50 border border-slate-800/80 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <div>
            <h2 className="text-xs uppercase font-mono font-bold tracking-wider text-slate-300 flex items-center space-x-2">
              <CheckSquare className="w-3.5 h-3.5 text-primary" />
              <span>Personalized 5-Step Action Plan</span>
            </h2>
            <p className="text-xs text-slate-400">Check off items as you complete your daily practice</p>
          </div>
          <span className="text-[11px] font-mono text-primary-glow">
            {completedSteps.length} of {report.action_plan.steps.length} done
          </span>
        </div>

        <div className="space-y-2.5">
          {report.action_plan.steps.map((st) => {
            const isDone = completedSteps.includes(st.step);
            return (
              <div
                key={st.step}
                onClick={() => toggleStep(st.step)}
                className={`p-3 rounded-lg border cursor-pointer transition-all flex items-start space-x-3 ${
                  isDone
                    ? 'bg-primary/5 border-primary/30 text-slate-400'
                    : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 text-slate-200'
                }`}
              >
                <button
                  type="button"
                  className="mt-0.5 text-primary focus:outline-none flex-shrink-0"
                  aria-label={`Toggle step ${st.step}`}
                >
                  {isDone ? (
                    <CheckSquare className="w-4 h-4 text-primary" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-500" />
                  )}
                </button>
                <div className="flex-1 space-y-0.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className={`font-semibold ${isDone ? 'line-through text-slate-400' : 'text-slate-200'}`}>
                      {st.title}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {st.minutes_per_day} min/day
                    </span>
                  </div>
                  <p className={`text-xs ${isDone ? 'text-slate-500' : 'text-slate-400'}`}>
                    {st.daily_exercise}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {report.action_plan.next_session_focus && (
          <div className="p-3.5 rounded-lg bg-primary/10 border border-primary/20 text-xs text-blue-200 flex items-start space-x-2">
            <Target className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-bold text-white">Next Session Focus: </span>
              {report.action_plan.next_session_focus}
            </div>
          </div>
        )}
      </div>

      {/* Footer Privacy Note */}
      <div className="text-center py-4 text-[11px] text-slate-500 border-t border-slate-900">
        Analysis is generated by an AI model. Transcripts and reports are processed securely.
      </div>
    </div>
  );
};
