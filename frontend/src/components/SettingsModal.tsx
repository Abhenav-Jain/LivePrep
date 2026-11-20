import React from 'react';
import { LogOut, User, X } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  email: string | null;
  onSignOut: () => void;
}

/** Account panel: who is signed in, and sign out. */
export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, email, onSignOut }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-md rounded-2xl bg-surface border border-slate-700/80 shadow-2xl overflow-hidden p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-primary/20 text-primary-glow">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Account</h2>
              <p className="text-xs text-slate-400">Your LivePrep login</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-300">Signed in as</p>
          <p className="px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-sm font-mono text-slate-100 break-all">
            {email ?? 'Unknown'}
          </p>
          <p className="text-[11px] text-slate-500">Your practice sessions are saved to this account.</p>
        </div>

        <div className="flex items-center justify-end space-x-3 pt-2 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            Close
          </button>
          <button
            onClick={onSignOut}
            className="flex items-center space-x-1.5 px-5 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-colors shadow-lg shadow-rose-600/20"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </div>
    </div>
  );
};
