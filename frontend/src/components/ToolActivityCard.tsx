import React, { useState } from 'react';
import { Terminal, FileCode, Folder, Globe, Cpu, ChevronDown, ChevronUp, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { ToolCallItem } from '../audio/useLiveSession';

interface ToolActivityCardProps {
  toolCalls: ToolCallItem[];
}

export const ToolActivityCard: React.FC<ToolActivityCardProps> = ({ toolCalls }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const getToolIcon = (name: string) => {
    switch (name) {
      case 'execute_command':
        return <Terminal className="w-4 h-4 text-emerald-400" />;
      case 'read_file':
      case 'write_file':
        return <FileCode className="w-4 h-4 text-blue-400" />;
      case 'list_directory':
        return <Folder className="w-4 h-4 text-amber-400" />;
      case 'search_web':
        return <Globe className="w-4 h-4 text-cyan-400" />;
      case 'get_system_telemetry':
      default:
        return <Cpu className="w-4 h-4 text-purple-400" />;
    }
  };

  const toggleExpand = (callId: string) => {
    setExpandedId((prev) => (prev === callId ? null : callId));
  };

  if (toolCalls.length === 0) {
    return (
      <div className="rounded-2xl bg-surface/70 border border-slate-800/80 p-4 text-center text-xs text-slate-400">
        <p className="font-mono">No active tool executions.</p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Tools (terminal, code edits, web search) run asynchronously when requested.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-surface/70 border border-slate-800/80 backdrop-blur-xl overflow-hidden shadow-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-slate-900/40">
        <div className="flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-semibold tracking-wide text-slate-200">
            Async Non-Blocking Tools
          </h2>
        </div>
        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          {toolCalls.length} executed
        </span>
      </div>

      <div className="divide-y divide-slate-800/60 max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700">
        {toolCalls.slice().reverse().map((tool) => {
          const isExpanded = expandedId === tool.callId;
          const duration = tool.endTime
            ? Math.round(tool.endTime.getTime() - tool.startTime.getTime())
            : null;

          return (
            <div key={tool.callId} className="p-3 hover:bg-slate-800/30 transition-colors">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => toggleExpand(tool.callId)}
              >
                <div className="flex items-center space-x-2.5">
                  <div className="p-1.5 rounded-lg bg-slate-800 border border-slate-700/60">
                    {getToolIcon(tool.name)}
                  </div>
                  <div>
                    <span className="font-mono text-xs font-medium text-slate-200">
                      {tool.name}
                    </span>
                    <span className="text-[10px] text-slate-400 block font-mono">
                      ID: {tool.callId.slice(-8)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  {tool.status === 'running' ? (
                    <div className="flex items-center space-x-1.5 text-xs text-amber-400 font-mono">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>running</span>
                    </div>
                  ) : tool.status === 'completed' ? (
                    <div className="flex items-center space-x-1.5 text-xs text-emerald-400 font-mono">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{duration ? `${duration}ms` : 'done'}</span>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-1.5 text-xs text-rose-400 font-mono">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>error</span>
                    </div>
                  )}

                  <button className="text-slate-400 hover:text-white p-1">
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-slate-800 space-y-2 text-xs font-mono">
                  <div>
                    <span className="text-slate-400 uppercase text-[10px] block mb-1">
                      Arguments
                    </span>
                    <pre className="p-2 rounded-lg bg-slate-950/70 border border-slate-800/80 text-cyan-300 overflow-x-auto text-[11px]">
                      {JSON.stringify(tool.args, null, 2)}
                    </pre>
                  </div>

                  {tool.result !== undefined && (
                    <div>
                      <span className="text-slate-400 uppercase text-[10px] block mb-1">
                        Result Output
                      </span>
                      <pre className="p-2 rounded-lg bg-slate-950/70 border border-slate-800/80 text-emerald-300 overflow-x-auto max-h-40 text-[11px]">
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
