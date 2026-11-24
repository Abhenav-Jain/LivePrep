import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, KeyRound, Loader2, Mail, Mic, Radio, Sparkles, TrendingUp } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_SECONDS = 60;

/** Turns a Supabase / network error into a short, friendly sentence. */
export function friendlyAuthError(err: unknown): string {
  const e = err as { message?: string; status?: number; code?: string } | null;
  const text = (e?.message ?? '').toLowerCase();
  const code = e?.code ?? '';

  if (code === 'over_email_send_rate_limit' || e?.status === 429 || text.includes('rate limit')) {
    return 'Too many emails requested. Please wait a few minutes before asking for a new code.';
  }
  if (code === 'otp_expired' || text.includes('expired') || text.includes('invalid')) {
    return 'That code is wrong or has expired. Check the latest email, or request a new code.';
  }
  if (text.includes('email') && text.includes('valid')) {
    return 'Please enter a valid email address.';
  }
  if (text.includes('failed to fetch') || text.includes('network')) {
    return 'Cannot reach the login service. Check your internet connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}

const HIGHLIGHTS = [
  { icon: <Mic className="h-3.5 w-3.5" />, title: 'Real conversation', copy: 'Talk out loud; the coach listens and answers like a person.' },
  { icon: <Sparkles className="h-3.5 w-3.5" />, title: 'An honest report', copy: 'Fluency, grammar, vocabulary and pace after every call.' },
  { icon: <TrendingUp className="h-3.5 w-3.5" />, title: 'A memory', copy: 'Your mistakes return as a word bank, reviewed at the right time.' },
];

const BrandMark: React.FC<{ size?: 'sm' | 'lg' }> = ({ size = 'sm' }) => (
  <div className="flex items-center gap-2.5">
    <div
      className={`grid place-items-center rounded-2xl bg-gradient-to-br from-primary to-accent-cyan text-white shadow-glow ${
        size === 'lg' ? 'h-11 w-11' : 'h-9 w-9'
      }`}
    >
      <Radio className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} />
    </div>
    <div className="leading-none">
      <p className={`font-display tracking-tight text-white ${size === 'lg' ? 'text-2xl' : 'text-xl'}`}>LivePrep</p>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">AI communication coach</p>
    </div>
  </div>
);

export const LoginScreen: React.FC = () => {
  const { sendCode, verifyCode } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  useEffect(() => {
    if (step === 'code') codeInputRef.current?.focus();
  }, [step]);

  const normalizedEmail = email.trim().toLowerCase();

  const requestCode = async () => {
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendCode(normalizedEmail);
      setStep('code');
      setCode('');
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    if (code.length < 6) {
      setError('Enter the code from your email.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyCode(normalizedEmail, code);
      // On success the auth listener switches the app to the signed-in view.
    } catch (err) {
      setError(friendlyAuthError(err));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full overflow-y-auto">
      <div className="mx-auto grid min-h-[100dvh] w-full max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
        {/* Brand story */}
        <div className="hidden animate-fade-up flex-col gap-7 lg:flex">
          <BrandMark size="lg" />

          <div>
            <p className="eyebrow mb-3">Practice out loud, improve for real</p>
            <h1 className="font-display text-5xl leading-[1.05] text-white xl:text-6xl">
              Speak English
              <br />
              <span className="italic text-primary-glow">with confidence.</span>
            </h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">
              A patient AI coach for anyone — technical or not. Have a real conversation on any topic, then
              get a clear report and a plan for the next one.
            </p>
          </div>

          <ul className="space-y-3">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-primary-glow">
                  {item.icon}
                </span>
                <span>
                  <span className="block text-[13px] font-semibold text-slate-200">{item.title}</span>
                  <span className="block text-xs leading-relaxed text-slate-500">{item.copy}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Sign-in card */}
        <div className="mx-auto w-full max-w-sm animate-fade-up lg:mx-0">
          <div className="mb-6 flex justify-center lg:hidden">
            <BrandMark />
          </div>

          <div className="panel-strong p-6">
            {step === 'email' ? (
              <div className="space-y-5">
                <div className="space-y-1">
                  <h2 className="font-display text-2xl text-white">Sign in</h2>
                  <p className="text-xs leading-relaxed text-slate-400">
                    We email you a one-time link. No password to remember.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="email" className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <Mail className="h-3.5 w-3.5 text-primary-glow" />
                    <span>Email</span>
                  </label>
                  <input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoFocus
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !busy) void requestCode();
                    }}
                    className="field"
                  />
                </div>

                <button
                  onClick={() => void requestCode()}
                  disabled={busy || !email.trim()}
                  className="btn-primary w-full py-3 text-sm"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>{busy ? 'Sending…' : 'Email me a sign-in link'}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="space-y-1">
                  <h2 className="font-display text-2xl text-white">Check your email</h2>
                  <p className="text-xs leading-relaxed text-slate-400">
                    Sent to <span className="font-mono text-slate-200">{normalizedEmail}</span>. Click the link in
                    that email to sign in (check spam too). If your email shows a code instead, type it below.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="code" className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <KeyRound className="h-3.5 w-3.5 text-primary-glow" />
                    <span>Code (only if your email has one)</span>
                  </label>
                  <input
                    id="code"
                    ref={codeInputRef}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={10}
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !busy) void submitCode();
                    }}
                    className="field text-center font-mono text-lg tracking-[0.35em]"
                  />
                </div>

                <button
                  onClick={() => void submitCode()}
                  disabled={busy || code.length < 6}
                  className="btn-primary w-full py-3 text-sm"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>{busy ? 'Checking…' : 'Sign in with code'}</span>
                </button>

                <div className="flex items-center justify-between text-[11px]">
                  <button
                    onClick={() => {
                      setStep('email');
                      setError(null);
                      setCode('');
                    }}
                    className="flex items-center gap-1 text-slate-400 transition-colors hover:text-white"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Change email</span>
                  </button>
                  <button
                    onClick={() => void requestCode()}
                    disabled={busy || cooldown > 0}
                    className="text-primary-glow transition-colors hover:text-white disabled:cursor-not-allowed disabled:text-slate-600"
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div role="alert" className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-200">
                {error}
              </div>
            )}
          </div>

          <p className="mt-5 text-center text-[10px] leading-relaxed text-slate-500">
            By signing in you agree that your practice sessions are stored in your account.
          </p>
        </div>
      </div>
    </div>
  );
};
