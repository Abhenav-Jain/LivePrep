import React, { useState } from 'react';
import {
  AlertCircle,
  Award,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Globe,
  Loader2,
  Wrench,
} from 'lucide-react';
import { ToolCallItem } from '../audio/useLiveSession';
import { cx } from './ui';

interface ToolActivityCardProps {
  toolCalls: ToolCallItem[];
}

export const ToolActivityCard: React.FC<ToolActivityCardProps> = ({ toolCalls }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const getToolIcon = (name: string) => {
    switch (name) {
      case 'search_web':
        return <Globe className="h-3.5 w-3.5 text-cyan-300" />;
      case 'save_note':
        return <FileText className="h-3.5 w-3.5 text-primary-glow" />;
      case 'score_answer':
        return <Award className="h-3.5 w-3.5 text-amber-300" />;
      case 'get_progress':
        return <BarChart3 className="h-3.5 w-3.5 text-purple-300" />;
      default:
        return <Wrench className="h-3.5 w-3.5 text-emerald-300" />;
    }
  };

  const toggleExpand = (callId: string) => {
    setExpandedId((prev) => (prev === callId ? null : callId));
  };

  if (toolCalls.length === 0) {
    return (
      <div className="panel flex h-full flex-col items-center justify-center px-5 text-center">
        <Wrench className="h-5 w-5 text-slate-600" />
        <p className="mt-2 text-[11px] text-slate-400">No tools used yet</p>
        <p className="mt-0.5 max-w-xs text-[10px] leading-relaxed text-slate-500">
          Web search, notes, answer scoring and progress lookups appear here as your coach uses them.
        </p>
      </div>
    );
  }

  return (
    <div className="panel-strong flex h-full flex-col overflow-hidden">
      <div className="flex flex-none items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Wrench className="h-3.5 w-3.5 text-emerald-400" />
          <h2 className="text-[12px] font-semibold text-slate-200">Coaching tools</h2>
        </div>
        <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[9px] uppercase tracking-wider text-emerald-300">
          {toolCalls.length} executed
        </span>
      </div>

      <div className="flex-1 divide-y divide-white/[0.05] overflow-y-auto">
        {toolCalls.slice().reverse().map((tool) => {
          const isExpanded = expandedId === tool.callId;
          const duration = tool.endTime
            ? Math.round(tool.endTime.getTime() - tool.startTime.getTime())
            : null;

          return (
            <div key={tool.callId} className="px-3 py-2 transition-colors hover:bg-white/[0.03]">
              <button
                onClick={() => toggleExpand(tool.callId)}
                aria-expanded={isExpanded}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-7 w-7 flex-none place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04]">
                    {getToolIcon(tool.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] text-slate-200">{tool.name}</span>
                    <span className="block text-[9px] text-slate-600">
                      {tool.callId.slice(-8)}
                    </span>
                  </span>
                </span>

                <span className="flex flex-none items-center gap-2.5">
                  {tool.status === 'running' ? (
                    <span className="flex items-center gap-1 text-[10px] text-amber-300">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      running
                    </span>
                  ) : tool.status === 'completed' ? (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" />
                      {duration ? `${duration}ms` : 'done'}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] text-rose-300">
                      <AlertCircle className="h-3 w-3" />
                      error
                    </span>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                  )}
                </span>
              </button>

              {isExpanded && (
                <div className="mt-2.5 space-y-2 border-t border-white/[0.06] pt-2.5">
                  <div>
                    <span className="eyebrow block pb-1">Arguments</span>
                    <pre className="overflow-x-auto rounded-lg border border-white/[0.07] bg-black/40 p-2 text-[10px] text-cyan-200">
                      {JSON.stringify(tool.args, null, 2)}
                    </pre>
                  </div>

                  {tool.result !== undefined && (
                    <div>
                      <span className="eyebrow block pb-1">Result</span>
                      <pre
                        className={cx(
                          'max-h-36 overflow-auto rounded-lg border border-white/[0.07] bg-black/40 p-2 text-[10px] text-emerald-200',
                        )}
                      >
                        {typeof tool.result === 'object'
                          ? JSON.stringify(tool.result, null, 2)
                          : String(tool.result)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
