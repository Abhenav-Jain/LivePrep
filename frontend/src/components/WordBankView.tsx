import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Check,
  Eye,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  WordBankResponse,
  createWordBankCard,
  deleteWordBankCard,
  describeApiError,
  fetchWordBank,
  reviewWordBankCard,
} from '../lib/api';

interface WordBankViewProps {
  onBack: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-blue-950/50 text-blue-300 border-blue-800/60',
  learning: 'bg-amber-950/50 text-amber-300 border-amber-800/60',
  mastered: 'bg-emerald-950/50 text-emerald-300 border-emerald-800/60',
};

/**
 * The word bank: words and corrections saved from reports, practised with a short
 * spaced-repetition loop. Deliberately one card at a time and three simple answers.
 */
export const WordBankView: React.FC<WordBankViewProps> = ({ onBack }) => {
  const [data, setData] = useState<WordBankResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [revealed, setRevealed] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [term, setTerm] = useState<string>('');
  const [alternatives, setAlternatives] = useState<string>('');
  const [note, setNote] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchWordBank());
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dueItems = data?.items.filter((item) => item.due) ?? [];
  const current = dueItems[0] ?? null;
  const summary = data?.summary ?? { total: 0, due: 0, new: 0, learning: 0, mastered: 0 };

  const handleReview = async (result: 'again' | 'good' | 'easy') => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await reviewWordBankCard(current.id, result);
      setNotice(
        result === 'again'
          ? `“${current.term}” will come back in about 10 minutes.`
          : result === 'easy'
            ? `“${current.term}” next in ${response.item.interval_days} days.`
            : `“${current.term}” next in ${response.item.interval_days} day(s).`,
      );
      setRevealed(false);
      await load();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!term.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const altList = alternatives
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const result = await createWordBankCard({
        term: term.trim(),
        alternatives: altList,
        note: note.trim() || null,
      });
      setTerm('');
      setAlternatives('');
      setNote('');
      setNotice(
        result.created
          ? `Saved “${result.item.term}” to your word bank.`
          : `“${result.item.term}” was already in your word bank.`,
      );
      await load();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteWordBankCard(id);
      await load();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg bg-surface border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Back to the practice call"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-white tracking-wide flex items-center space-x-2">
              <BookOpen className="w-5 h-5 text-primary" />
              <span>Word Bank</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Words and corrections from your reports, reviewed a few at a time.
            </p>
          </div>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-surface border border-slate-800 hover:border-slate-700 text-xs text-slate-300 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
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

      {/* Counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Words saved" value={summary.total} tone="text-slate-100" />
        <Stat label="Due now" value={summary.due} tone="text-cyan-300" />
        <Stat label="Learning" value={summary.learning + summary.new} tone="text-amber-300" />
        <Stat label="Mastered" value={summary.mastered} tone="text-emerald-300" />
      </div>

      {notice && (
        <div className="mb-4 px-3 py-2 rounded-xl bg-primary/10 border border-primary/25 text-xs text-blue-200 flex items-center gap-2">
          <Check className="w-3.5 h-3.5" />
          <span>{notice}</span>
        </div>
      )}

      {/* Practice card */}
      <div className="rounded-2xl bg-gradient-to-br from-surface/90 to-slate-900/80 border border-slate-800/80 p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" /> Today&apos;s practice
          </h3>
          {current && (
            <span className="text-[10px] font-mono text-slate-500">
              {dueItems.length} due
            </span>
          )}
        </div>

        {loading && !data ? (
          <p className="text-sm text-slate-400 py-6 text-center">Loading your words…</p>
        ) : current ? (
          <div>
            <p className="text-[11px] text-slate-500 mb-1">
              {current.source === 'grammar' ? 'Correction to fix' : 'Say it a better way'}
            </p>
            <p className="text-2xl font-bold text-white break-words">{current.term}</p>

            {revealed ? (
              <div className="mt-4 space-y-2">
                {current.alternatives.length > 0 ? (
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
                      Better version
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {current.alternatives.map((alt) => (
                        <span
                          key={alt}
                          className="px-2.5 py-1 rounded-full bg-primary/10 border border-primary/25 text-xs text-primary-glow"
                        >
                          {alt}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    No model answer saved. Try using it in a sentence out loud.
                  </p>
                )}
                {current.note && <p className="text-[11px] text-slate-400">{current.note}</p>}
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                Say it out loud with a better word, then check yourself.
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {!revealed ? (
                <button
                  onClick={() => setRevealed(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100 border border-slate-700"
                >
                  <Eye className="w-3.5 h-3.5" /> Show answer
                </button>
              ) : (
                <>
                  <button
                    onClick={() => void handleReview('again')}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600/15 hover:bg-rose-600/25 text-xs font-semibold text-rose-300 border border-rose-800/60 disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Again
                  </button>
                  <button
                    onClick={() => void handleReview('good')}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary/15 hover:bg-primary/25 text-xs font-semibold text-primary-glow border border-primary/30 disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" /> Good
                  </button>
                  <button
                    onClick={() => void handleReview('easy')}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 text-xs font-semibold text-emerald-300 border border-emerald-800/60 disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Easy
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <BookOpen className="w-9 h-9 mx-auto text-slate-600 mb-2" />
            <p className="text-sm text-slate-300">
              {summary.total === 0
                ? 'Your word bank is empty. Finish a session and your report fills it automatically.'
                : 'Nothing due right now. Come back after your next session.'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Saved words appear here as soon as a report is ready.
            </p>
          </div>
        )}
      </div>

      {/* Add a word */}
      <form
        onSubmit={(event) => void handleAdd(event)}
        className="rounded-2xl bg-surface/50 border border-slate-800/80 p-4 mb-4"
      >
        <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5 text-cyan-400" /> Add your own
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            maxLength={120}
            placeholder="Word or phrase (e.g. very good)"
            className="px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary/60"
          />
          <input
            value={alternatives}
            onChange={(event) => setAlternatives(event.target.value)}
            placeholder="Better versions, comma separated"
            className="px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary/60"
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-2">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={300}
            placeholder="Note (optional)"
            className="flex-1 px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary/60"
          />
          <button
            type="submit"
            disabled={busy || !term.trim()}
            className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold disabled:opacity-50"
          >
            Save word
          </button>
        </div>
      </form>

      {/* All cards */}
      {data && data.items.length > 0 && (
        <div className="rounded-2xl bg-surface/50 border border-slate-800/80 p-4">
          <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3">
            All words ({data.items.length})
          </h3>
          <div className="space-y-2">
            {data.items.map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800/70"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-200 break-words">{item.term}</span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono uppercase border ${
                        STATUS_STYLES[item.status] ?? STATUS_STYLES.new
                      }`}
                    >
                      {item.status}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {item.source}
                    </span>
                  </div>
                  {item.alternatives.length > 0 && (
                    <p className="text-[11px] text-slate-400 mt-1 break-words">
                      {item.alternatives.join(' · ')}
                    </p>
                  )}
                  {item.note && <p className="text-[10px] text-slate-500 mt-0.5">{item.note}</p>}
                </div>
                <button
                  onClick={() => void handleDelete(item.id)}
                  disabled={busy}
                  title="Remove this word"
                  className="p-1.5 rounded-lg text-slate-500 hover:text-rose-300 hover:bg-rose-950/40 disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; tone: string }> = ({ label, value, tone }) => (
  <div className="rounded-xl bg-surface/60 border border-slate-800/80 p-3 text-center">
    <div className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mt-0.5">{label}</div>
  </div>
);
