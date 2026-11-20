import React from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from './auth/AuthProvider';
import { LoginScreen } from './components/LoginScreen';
import { App } from './App';

/** Shows the app only to signed-in users. */
export const AuthGate: React.FC = () => {
  const { configured, loading, session } = useAuth();

  if (!configured) {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center p-6 bg-background text-slate-100">
        <div className="max-w-md rounded-2xl bg-surface border border-slate-700/80 p-6 space-y-3">
          <h1 className="text-lg font-bold text-white">Login is not configured</h1>
          <p className="text-sm text-slate-300">
            Set <code className="font-mono text-primary-glow">VITE_SUPABASE_URL</code> and{' '}
            <code className="font-mono text-primary-glow">VITE_SUPABASE_PUBLISHABLE_KEY</code> in{' '}
            <code className="font-mono">frontend/.env</code> (see <code className="font-mono">frontend/.env.example</code>),
            then restart the dev server or rebuild.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center bg-background text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  return session ? <App /> : <LoginScreen />;
};
