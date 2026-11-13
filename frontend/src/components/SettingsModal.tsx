import React, { useState, useEffect } from 'react';
import { Settings, X, ShieldCheck } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  livePrepToken: string;
  onLivePrepTokenChange: (token: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  livePrepToken,
  onLivePrepTokenChange,
}) => {
  const [localToken, setLocalToken] = useState(livePrepToken);

  useEffect(() => {
    setLocalToken(livePrepToken);
  }, [livePrepToken]);

  if (!isOpen) return null;

  const handleSave = () => {
    onLivePrepTokenChange(localToken.trim());
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
              <p className="text-xs text-slate-400">Configure LivePrep Connection</p>
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
              placeholder="Enter LIVEPREP_TOKEN (min 32 characters)"
              value={localToken}
              onChange={(e) => setLocalToken(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[11px] text-slate-500 font-mono">
              The shared authentication token configured on the server.
            </p>
          </div>
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
