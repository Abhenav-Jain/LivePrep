import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isAuthConfigured } from '../lib/supabase';

interface AuthContextValue {
  /** False when VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are missing. */
  configured: boolean;
  /** True until the stored login (if any) has been read. */
  loading: boolean;
  session: Session | null;
  email: string | null;
  /** Sends a one-time code (and sign-in link) to the email address. */
  sendCode: (email: string) => Promise<void>;
  /** Checks the code from the email and signs the user in. */
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(isAuthConfigured);

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const sendCode = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Login is not configured.');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
  }, []);

  const verifyCode = useCallback(async (email: string, code: string) => {
    if (!supabase) throw new Error('Login is not configured.');
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: isAuthConfigured,
      loading,
      session,
      email: session?.user?.email ?? null,
      sendCode,
      verifyCode,
      signOut,
    }),
    [loading, session, sendCode, verifyCode, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
