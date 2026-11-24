import React, { useEffect, useRef } from 'react';
import { ArrowRight, Clock, Sparkles, User } from 'lucide-react';
import { TranscriptItem } from '../audio/useLiveSession';
import { cx } from './ui';

interface TranscriptViewProps {
  transcripts: TranscriptItem[];
  onSuggestedPromptClick?: (prompt: string) => void;
}

const SUGGESTED_PROMPTS = [
  "Let's have a free-flow conversation. Ask me about my day.",
  'I want to practise English. Pick an easy topic for me.',
  "Let's talk about films, food and travel.",
  'Correct my grammar gently while we chat.',
];

export const TranscriptView: React.FC<TranscriptViewProps> = ({
  transcripts,
  onSuggestedPromptClick,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  return (
    <div className="panel-strong flex h-full flex-col overflow-hidden">
      <div className="flex flex-none items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-primary/15 text-primary-glow">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-[13px] font-semibold text-slate-200">Live transcript</h2>
        </div>
        <span className="text-xs text-slate-400">
          {transcripts.length} {transcripts.length === 1 ? 'turn' : 'turns'}
        </span>
      </div>

      <div
        ref={scrollRef}
        className={cx(
          'flex-1 space-y-4 p-4',
          transcripts.length > 0 ? 'overflow-y-auto' : 'overflow-hidden',
        )}
      >
        {transcripts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-2 py-4 text-center">
            <div className="relative grid h-12 w-12 place-items-center">
              <span
                aria-hidden
                className="absolute inset-0 animate-breathe rounded-full bg-primary/25 blur-xl"
              />
              <span className="relative grid h-11 w-11 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary-glow">
                <Sparkles className="h-5 w-5" />
              </span>
            </div>
            <div className="space-y-1">
              <p className="text-lg font-semibold text-white">Your coach is listening</p>
              <p className="mx-auto max-w-sm text-xs leading-relaxed text-slate-400">
                Pick a topic to start the session — it becomes today&apos;s focus so your coach
                comes back to it.
              </p>
            </div>

            <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => onSuggestedPromptClick?.(prompt)}
                  aria-label={`Start a session: ${prompt}`}
                  className="group flex items-start justify-between gap-2 rounded-xl border border-white/[0.09] bg-white/[0.035] px-3 py-2.5 text-left text-[11px] leading-snug text-slate-300 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/45 hover:bg-primary/[0.1] hover:text-white"
                >
                  <span>{prompt}</span>
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-500 transition-colors group-hover:text-primary-glow" />
                </button>
              ))}
            </div>

            <p className="max-w-sm pt-1 text-[11px] leading-relaxed text-slate-500">
              Every call ends with a report: scores, corrections and the new words that go to
              your word bank.
            </p>
          </div>
        ) : (
          transcripts.map((item) => {
            const isUser = item.sender === 'user';
            return (
              <div
                key={item.id}
                className={cx('flex items-start gap-2.5', isUser ? 'justify-end' : 'justify-start')}
              >
                {!isUser && (
                  <div className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-gradient-to-br from-primary to-accent-cyan text-white shadow-glow">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                )}

                <div
                  className={cx(
                    'max-w-[85%] animate-fade-up rounded-2xl border px-4 py-2.5 text-sm leading-relaxed',
                    isUser
                      ? 'rounded-tr-sm border-primary/25 bg-primary/[0.14] text-slate-100'
                      : 'rounded-tl-sm border-white/[0.07] bg-white/[0.04] text-slate-100',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-4">
                    <span
                      className={cx(
                        'text-[10px] font-semibold uppercase tracking-[0.08em]',
                        isUser ? 'text-primary-glow' : 'text-cyan-300/80',
                      )}
                    >
                      {isUser ? 'You' : 'Coach'}
                    </span>
                    <span className="flex items-center gap-1 text-[9px] text-slate-500">
                      <Clock className="h-2.5 w-2.5" />
                      {item.timestamp.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap break-words">{item.text}</div>
                </div>

                {isUser && (
                  <div className="grid h-8 w-8 flex-none place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-slate-300">
                    <User className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
