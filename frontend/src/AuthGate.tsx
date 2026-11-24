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
      <div className="flex min-h-[100dvh] w-screen items-center justify-center p-6 text-slate-100">
        <div className="panel-strong max-w-md space-y-3 p-6">
          <h1 className="text-2xl text-white">Login is not configured</h1>
          <p className="text-sm leading-relaxed text-slate-300">
            Set <code className="text-primary-glow">VITE_SUPABASE_URL</code> and{' '}
            <code className="text-primary-glow">VITE_SUPABASE_PUBLISHABLE_KEY</code> in{' '}
            <code className="text-slate-200">frontend/.env</code> (see{' '}
            <code className="text-slate-200">frontend/.env.example</code>), then restart the dev
            server or rebuild.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] w-screen items-center justify-center text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  return session ? <App /> : <LoginScreen />;
};
