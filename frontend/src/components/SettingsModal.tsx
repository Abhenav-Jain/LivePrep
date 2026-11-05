import React, { useState, useEffect } from 'react';
import { Settings, Key, Cpu, X, Check, ExternalLink, ShieldCheck } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  livePrepToken: string;
  onLivePrepTokenChange: (token: string) => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  apiKey,
  onApiKeyChange,
  livePrepToken,
  onLivePrepTokenChange,
  selectedModel,
  onModelChange,
}) => {
  const [localKey, setLocalKey] = useState(apiKey);
  const [localToken, setLocalToken] = useState(livePrepToken);
  const [localModel, setLocalModel] = useState(selectedModel);
  const [serverHealth, setServerHealth] = useState<{
    status: string;
    api_key_configured: boolean;
    workspace: string;
  } | null>(null);

  useEffect(() => {
    setLocalKey(apiKey);
  }, [apiKey]);

  useEffect(() => {
    setLocalToken(livePrepToken);
  }, [livePrepToken]);

  useEffect(() => {
    setLocalModel(selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/health')
        .then((res) => res.json())
        .then((data) => setServerHealth(data))
        .catch((err) => console.warn('Could not fetch backend health:', err));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    onApiKeyChange(localKey.trim());
    onLivePrepTokenChange(localToken.trim());
    onModelChange(localModel);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-lg rounded-2xl bg-surface border border-slate-700/80 shadow-2xl overflow-hidden p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-primary/20 text-primary-glow">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Agent Settings</h2>
              <p className="text-xs text-slate-400">Configure Gemini Live API & Models</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* API Key */}
          <div className="space-y-1.5">
            <label className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center space-x-1.5">
                <Key className="w-3.5 h-3.5 text-amber-400" />
                <span>Gemini API Key</span>
              </span>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-primary-glow hover:underline flex items-center space-x-1"
              >
                <span>Get API Key</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </label>
            <input
              type="password"
              placeholder={
                serverHealth?.api_key_configured
                  ? 'Configured in backend .env (or override here)'
                  : 'Enter AI Studio API Key (AIzaSy...)'
              }
              value={localKey}
              onChange={(e) => setLocalKey(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary"
            />
            {serverHealth?.api_key_configured && !localKey && (
              <p className="text-[11px] text-emerald-400 flex items-center space-x-1 mt-1 font-mono">
                <Check className="w-3 h-3" />
                <span>Backend has a configured GEMINI_API_KEY</span>
              </p>
            )}
          </div>


          {/* LivePrep Auth Token */}
          <div className="space-y-1.5">
            <label className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center space-x-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>LivePrep Auth Token</span>
              </span>
            </label>
            <input
              type="password"
              placeholder="Enter LIVEPREP_TOKEN (required for WebSocket auth)"
              value={localToken}
              onChange={(e) => setLocalToken(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[11px] text-slate-500 font-mono">
              Set LIVEPREP_TOKEN in backend .env and use the same value here.
            </p>
          </div>
          {/* Model Selection */}
          <div className="space-y-1.5">
            <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300">
              <Cpu className="w-3.5 h-3.5 text-primary-glow" />
              <span>Gemini Live Model</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLocalModel('gemini-3.8-live')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  localModel === 'gemini-3.8-live'
                    ? 'border-primary bg-primary/10 text-white shadow-lg shadow-primary/10'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-mono font-semibold text-xs text-primary-glow">
                  gemini-3.8-live
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Default low-latency conversational audio & async tools.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setLocalModel('gemini-3.8-live-extended-thinking')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  localModel === 'gemini-3.8-live-extended-thinking'
                    ? 'border-purple-500 bg-purple-500/10 text-white shadow-lg shadow-purple-500/10'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-mono font-semibold text-xs text-purple-400">
                  extended-thinking
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Deep background reasoning with conversational fillers.
                </div>
              </button>
            </div>
          </div>

          {/* Workspace info */}
          {serverHealth && (
            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 text-xs font-mono space-y-1">
              <div className="text-slate-400">WORKSPACE ROOT:</div>
              <div className="text-slate-200 truncate">{serverHealth.workspace}</div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end space-x-3 pt-2 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-primary hover:bg-blue-600 transition-colors shadow-lg shadow-primary/20"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};
