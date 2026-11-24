import React, { useEffect } from 'react';
import { LogOut, User, X } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  email: string | null;
  onSignOut: () => void;
}

/** Account panel: who is signed in, and sign out. */
export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, email, onSignOut }) => {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        onClick={(event) => event.stopPropagation()}
        className="animate-scale-in w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-surface/95 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-start justify-between border-b border-white/[0.07] p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/15 text-primary-glow">
              <User className="h-4 w-4" />
            </span>
            <div>
              <h2 id="account-title" className="text-base font-semibold text-white">
                Account
              </h2>
              <p className="text-[11px] text-slate-500">Your LivePrep login</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="btn-quiet h-8 w-8">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          <div>
            <p className="eyebrow mb-1.5">Signed in as</p>
            <p className="break-all rounded-xl border border-white/[0.07] bg-black/30 px-3.5 py-2.5 text-[13px] text-slate-100">
              {email ?? 'Unknown'}
            </p>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Every practice session, report and saved word is stored to this account only.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] p-4">
          <button onClick={onClose} className="btn-ghost px-4 py-2">
            Close
          </button>
          <button
            onClick={onSignOut}
            className="btn gap-1.5 bg-rose-600 px-4 py-2 text-white shadow-lg shadow-rose-600/20 hover:bg-rose-500"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </div>
    </div>
  );
};
