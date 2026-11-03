import React, { useEffect, useRef } from 'react';
import { User, Sparkles, Clock } from 'lucide-react';
import { TranscriptItem } from '../audio/useLiveSession';

interface TranscriptViewProps {
  transcripts: TranscriptItem[];
  onSuggestedPromptClick?: (prompt: string) => void;
}

const SUGGESTED_PROMPTS = [
  "Look at my screen and tell me what you see.",
  "Run 'dir' in my workspace terminal to see the files.",
  "Search the web for the latest Gemini 3.8 features.",
  "Write a python script that tests prime numbers.",
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
    <div className="flex flex-col h-full rounded-2xl bg-surface/70 border border-slate-800/80 backdrop-blur-xl overflow-hidden shadow-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-slate-900/40">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-primary-glow" />
          <h2 className="text-sm font-semibold tracking-wide text-slate-200">
            Live Multimodal Transcript
          </h2>
        </div>
        <span className="text-[11px] font-mono text-slate-400">
          {transcripts.length} {transcripts.length === 1 ? 'turn' : 'turns'}
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth scrollbar-thin scrollbar-thumb-slate-700"
      >
        {transcripts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
            <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20 text-primary-glow">
              <Sparkles className="w-8 h-8 animate-pulse" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-300">
                Ready for Voice, Vision, or Text Input
              </p>
              <p className="text-xs text-slate-400 max-w-sm">
                Speak into your mic, share your screen, or click a suggestion below to begin.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md pt-2">
              {SUGGESTED_PROMPTS.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => onSuggestedPromptClick?.(prompt)}
                  className="text-left p-2.5 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-primary/40 text-xs text-slate-300 transition-all hover:scale-[1.01]"
                >
                  "{prompt}"
                </button>
              ))}
            </div>
          </div>
        ) : (
          transcripts.map((item) => (
            <div
              key={item.id}
              className={`flex items-start space-x-3 ${
                item.sender === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {item.sender === 'agent' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-gradient-to-tr from-primary to-purple-600 flex items-center justify-center text-white shadow-md shadow-primary/20">
                  <Sparkles className="w-4 h-4" />
                </div>
              )}

              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-lg ${
                  item.sender === 'user'
                    ? 'bg-blue-600/90 text-white border border-blue-400/30 rounded-tr-sm'
                    : 'bg-slate-800/90 text-slate-100 border border-slate-700/70 rounded-tl-sm'
                }`}
              >
                <div className="flex items-center justify-between space-x-4 mb-1">
                  <span
                    className={`text-[10px] font-mono uppercase tracking-wider font-semibold ${
                      item.sender === 'user' ? 'text-blue-200' : 'text-purple-300'
                    }`}
                  >
                    {item.sender === 'user' ? 'You' : 'OmniCopilot'}
                  </span>
                  <span className="text-[10px] font-mono opacity-50 flex items-center space-x-1">
                    <Clock className="w-2.5 h-2.5" />
                    <span>
                      {item.timestamp.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </span>
                </div>
                <div className="whitespace-pre-wrap break-words">{item.text}</div>
              </div>

              {item.sender === 'user' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-slate-700 flex items-center justify-center text-slate-200">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
