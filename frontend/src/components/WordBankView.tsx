import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  Eye,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  WordBankItem,
  WordBankResponse,
  createWordBankCard,
  deleteWordBankCard,
  describeApiError,
  fetchWordBank,
  reviewWordBankCard,
} from '../lib/api';
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

interface WordBankViewProps {
  onBack: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  new: 'border-primary/30 bg-primary/10 text-primary-glow',
  learning: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  mastered: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
};

/** "due now" or "in 3 days" — a quick sense of when a card comes back. */
function nextReviewLabel(item: WordBankItem): string {
  if (item.due) return 'due now';
  if (!item.next_review_at) return 'scheduled';
  const diffMs = new Date(item.next_review_at).getTime() - Date.now();
  const days = Math.ceil(diffMs / 86_400_000);
  if (days <= 0) return 'due now';
  return days === 1 ? 'in 1 day' : `in ${days} days`;
}

const SOURCE_LABEL: Record<string, string> = {
  vocabulary: 'vocabulary',
  grammar: 'correction',
  manual: 'yours',
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
  const [query, setQuery] = useState<string>('');

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

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.term.toLowerCase().includes(needle) ||
        item.alternatives.some((alt) => alt.toLowerCase().includes(needle)) ||
        (item.note ?? '').toLowerCase().includes(needle),
    );
  }, [data, query]);

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
    <Page>
      <PageHeader
        eyebrow="Remember what you learn"
        title="Word bank"
        icon={<BookOpen className="h-6 w-6 text-primary-glow" />}
        description="Words and corrections from your reports, reviewed a few at a time so they actually stick."
        onBack={onBack}
        backLabel="Back to practice"
        actions={<RefreshButton onClick={() => void load()} loading={loading} />}
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} onRetry={() => void load()} />
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Saved" value={summary.total} />
        <StatTile label="Due now" value={summary.due} valueClassName="text-cyan-300" />
        <StatTile label="Learning" value={summary.learning + summary.new} valueClassName="text-amber-300" />
        <StatTile label="Mastered" value={summary.mastered} valueClassName="text-emerald-300" />
      </div>

      {notice && (
        <div className="animate-fade-in mb-4 flex items-center gap-2 rounded-2xl border border-primary/25 bg-primary/[0.08] px-4 py-2.5 text-xs text-primary-glow">
          <Check className="h-3.5 w-3.5 flex-none" />
          <span>{notice}</span>
        </div>
      )}

      {/* Practice card */}
      <section className="panel-strong relative mb-4 overflow-hidden p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-primary/15 blur-3xl"
        />
        <div className="relative flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-slate-200">
            <Sparkles className="h-3.5 w-3.5 text-primary-glow" />
            Today&apos;s practice
          </h2>
          {current && (
            <span className="chip border-cyan-400/25 bg-cyan-400/10 text-cyan-300">{dueItems.length} due</span>
          )}
        </div>

        {loading && !data ? (
          <div className="mt-6">
            <SkeletonLines rows={3} />
          </div>
        ) : current ? (
          <div className="relative mt-5">
            <p className="eyebrow mb-2">
              {current.source === 'grammar' ? 'Correction to fix' : 'Say it a better way'}
            </p>
            <p className="font-display text-[2rem] leading-tight text-white sm:text-[2.4rem]">{current.term}</p>

            {revealed ? (
              <div className="mt-5 space-y-3">
                {current.alternatives.length > 0 ? (
                  <div>
                    <p className="eyebrow mb-2">Better version</p>
                    <div className="flex flex-wrap gap-1.5">
                      {current.alternatives.map((alt) => (
                        <span
                          key={alt}
                          className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs text-primary-glow"
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
                {current.note && <p className="text-[11px] leading-relaxed text-slate-400">{current.note}</p>}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                Say it out loud with a better word, then check yourself.
              </p>
            )}

            <div className="mt-6 flex flex-wrap gap-2">
              {!revealed ? (
                <button onClick={() => setRevealed(true)} className="btn-ghost px-4 py-2.5">
                  <Eye className="h-3.5 w-3.5" />
                  Show answer
                </button>
              ) : (
                <>
                  <button
                    onClick={() => void handleReview('again')}
                    disabled={busy}
                    className="btn gap-1.5 border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-rose-300 hover:bg-rose-500/20"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Again
                  </button>
                  <button
                    onClick={() => void handleReview('good')}
                    disabled={busy}
                    className="btn gap-1.5 border border-primary/30 bg-primary/15 px-4 py-2.5 text-primary-glow hover:bg-primary/25"
                  >
                    <Check className="h-3.5 w-3.5" /> Good
                  </button>
                  <button
                    onClick={() => void handleReview('easy')}
                    disabled={busy}
                    className="btn gap-1.5 border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-emerald-300 hover:bg-emerald-400/20"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Easy
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="relative mt-6 flex flex-col items-center py-4 text-center">
            <div className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-400">
              <BookOpen className="h-5 w-5" />
            </div>
            <p className="mt-3 max-w-sm text-sm text-slate-300">
              {summary.total === 0
                ? 'Your word bank is empty. Finish a session and your report fills it automatically.'
                : 'Nothing due right now. Come back after your next session.'}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">Saved words appear here as soon as a report is ready.</p>
          </div>
        )}
      </section>

      {/* Add a word */}
      <SectionCard
        title="Add your own"
        description="Anything you keep forgetting — a phrase, a spelling, a better word."
        icon={<Plus className="h-3.5 w-3.5 text-cyan-400" />}
        className="mb-4"
      >
        <form onSubmit={(event) => void handleAdd(event)} className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              maxLength={120}
              placeholder="Word or phrase (e.g. very good)"
              aria-label="Word or phrase"
              className="field text-xs"
            />
            <input
              value={alternatives}
              onChange={(event) => setAlternatives(event.target.value)}
              placeholder="Better versions, comma separated"
              aria-label="Better versions"
              className="field text-xs"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={300}
              placeholder="Note (optional)"
              aria-label="Note"
              className="field flex-1 text-xs"
            />
            <button type="submit" disabled={busy || !term.trim()} className="btn-primary px-4 py-2.5">
              Save word
            </button>
          </div>
        </form>
      </SectionCard>

      {/* All cards */}
      {data && data.items.length > 0 && (
        <SectionCard
          title={`All words (${data.items.length})`}
          icon={<BookOpen className="h-3.5 w-3.5 text-primary-glow" />}
          actions={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                aria-label="Search saved words"
                className="field w-36 py-1.5 pl-8 text-xs sm:w-48"
              />
            </div>
          }
        >
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Search className="h-5 w-5" />}
              title="No matching words"
              description={`Nothing here matches “${query}”. Try a shorter search.`}
            />
          ) : (
            <div className="space-y-2">
              {filtered.map((item) => (
                <div
                  key={item.id}
                  className="group flex items-start justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:border-white/[0.12]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-words text-sm font-medium text-slate-200">{item.term}</span>
                      <span
                        className={cx(
                          'rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider',
                          STATUS_STYLES[item.status] ?? STATUS_STYLES.new,
                        )}
                      >
                        {item.status}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        {SOURCE_LABEL[item.source] ?? item.source}
                      </span>
                      <span
                        className={cx(
                          'font-mono text-[10px]',
                          item.due ? 'text-cyan-300' : 'text-slate-500',
                        )}
                      >
                        {nextReviewLabel(item)}
                      </span>
                    </div>
                    {item.alternatives.length > 0 && (
                      <p className="mt-1 break-words text-[11px] text-slate-400">{item.alternatives.join(' · ')}</p>
                    )}
                    {item.note && <p className="mt-0.5 text-[10px] text-slate-500">{item.note}</p>}
                  </div>
                  <button
                    onClick={() => void handleDelete(item.id)}
                    disabled={busy}
                    title="Remove this word"
                    aria-label={`Remove ${item.term}`}
                    className="rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}
    </Page>
  );
};
