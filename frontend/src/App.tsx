import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  History,
  Mic,
  MicOff,
  Power,
  Radio,
  Send,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  Target,
  TrendingUp,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useLiveSession } from './audio/useLiveSession';
import { useAuth } from './auth/AuthProvider';
import { VoiceOrb } from './components/VoiceOrb';
import { TranscriptView } from './components/TranscriptView';
import { SettingsModal } from './components/SettingsModal';
import { SessionsList } from './components/SessionsList';
import { SessionTranscriptView } from './components/SessionTranscriptView';
import { ReportView } from './components/ReportView';
import { ProgressView } from './components/ProgressView';
import { WordBankView } from './components/WordBankView';
import { UsageCard } from './components/UsageMeter';
import { usePracticeUsage } from './lib/usePracticeUsage';
import { fetchWordBank } from './lib/api';
import { cx } from './components/ui';

type NavItem = {
  hash: string;
  label: string;
  icon: React.ReactNode;
  isActive: (route: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  { hash: '#/', label: 'Practice', icon: <Radio className="h-4 w-4" />, isActive: (r) => !r.startsWith('#/sessions') && r !== '#/progress' && r !== '#/words' },
  { hash: '#/sessions', label: 'Sessions', icon: <History className="h-4 w-4" />, isActive: (r) => r.startsWith('#/sessions') },
  { hash: '#/progress', label: 'Progress', icon: <TrendingUp className="h-4 w-4" />, isActive: (r) => r === '#/progress' },
  { hash: '#/words', label: 'Word bank', icon: <BookOpen className="h-4 w-4" />, isActive: (r) => r === '#/words' },
];

/** One-tap goals for the focus field: quicker than typing on a small screen. */
const FOCUS_PRESETS = ['Past tense', 'Small talk', 'Storytelling', 'Interview prep'];

/** First name from the account email, used only for the greeting. */
function firstNameFrom(email: string | null): string {
  const local = (email ?? '').split('@')[0];
  const first = local.split(/[._\-+\d]/).filter(Boolean)[0] ?? '';
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'there';
}

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const Brand: React.FC<{ mini?: boolean }> = ({ mini = false }) => (
  <div className="flex items-center gap-2.5">
    <div className="grid h-9 w-9 flex-none place-items-center rounded-2xl bg-gradient-to-br from-primary to-accent-cyan text-white shadow-glow">
      <Radio className="h-4 w-4" />
    </div>
    <div className="leading-none">
      <p className={cx('font-display tracking-tight text-white', mini ? 'text-xl' : 'text-[1.35rem]')}>LivePrep</p>
      {!mini && (
        <p className="mt-1 whitespace-nowrap text-[9px] uppercase tracking-[0.12em] text-slate-400">
          AI communication coach
        </p>
      )}
    </div>
  </div>
);

const SidebarLink: React.FC<{
  active: boolean;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  onClick: () => void;
}> = ({ active, label, icon, badge, onClick }) => (
  <button
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    className={cx(
      'group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200',
      active ? 'bg-white/[0.07] text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100',
    )}
  >
    {active && (
      <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
    )}
    <span className={cx('transition-colors', active ? 'text-primary-glow' : 'text-slate-500 group-hover:text-slate-300')}>
      {icon}
    </span>
    <span className="flex-1 text-left">{label}</span>
    {badge !== undefined && badge > 0 && (
      <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary-glow">
        {badge}
      </span>
    )}
  </button>
);

export const App: React.FC = () => {
  const {
    status,
    statusMessage,
    sessionId,
    transcripts,
    isMicActive,
    userVolume,
    agentVolume,
    agentState,
    echoShield,
    isAiMuted,
    toggleAiMute,
    connect,
    disconnect,
    toggleMic,
    sendTextMessage,
    toggleEchoShield,
  } = useLiveSession();

  const { email, signOut } = useAuth();
  // Today's allowance: the server total, plus the seconds of a call that is still running.
  const practiceUsage = usePracticeUsage(status === 'connected');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [route, setRoute] = useState<string>(() => window.location.hash || '#/');
  // Optional goal the learner sets before a call; the coach starts from it.
  const [focus, setFocus] = useState<string>('');
  // Cards due in the word bank: shown as a badge so practice is one click away.
  const [dueCount, setDueCount] = useState<number>(0);

  // Listen to hash changes for simple routing without an external library
  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash || '#/');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Refresh the word-bank badge when the page changes (a finished practice empties it).
  useEffect(() => {
    let cancelled = false;
    void fetchWordBank()
      .then((data) => {
        if (!cancelled) setDueCount(data.summary.due);
      })
      .catch(() => {
        /* badge is decoration: a failed count must not disturb the app */
      });
    return () => {
      cancelled = true;
    };
  }, [route]);

  // Purge deprecated storage keys (old API key, model choice and the retired shared token)
  useEffect(() => {
    localStorage.removeItem('omni_gemini_api_key');
    localStorage.removeItem('omni_gemini_model');
    localStorage.removeItem('omni_liveprep_token');
  }, []);

  const displayName = useMemo(() => firstNameFrom(email), [email]);
  const greeting = useMemo(() => greetingFor(new Date()), []);
  const suggestion = useMemo(
    () =>
      dueCount > 0
        ? `${dueCount} word${dueCount === 1 ? '' : 's'} due today — a two-minute review keeps them fresh.`
        : 'Pick a focus below and talk for ten minutes. Your coach keeps the notes.',
    [dueCount],
  );

  const handleToggleConnect = () => {
    if (status === 'connected' || status === 'connecting') {
      disconnect();
    } else {
      void connect(focus);
    }
  };

  const handleSignOut = async () => {
    disconnect(); // end any running call first
    setIsSettingsOpen(false);
    await signOut();
  };

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputPrompt.trim()) {
      sendTextMessage(inputPrompt.trim());
      setInputPrompt('');
    }
  };

  const navigate = (hash: string) => {
    window.location.hash = hash;
  };

  // Determine current page
  const isSessionsList = route === '#/sessions';
  const isProgressView = route === '#/progress';
  const isWordBankView = route === '#/words';
  const isReportView = route.startsWith('#/sessions/') && route.endsWith('/report');
  const reportSessionId = isReportView
    ? route.replace('#/sessions/', '').replace('/report', '')
    : null;
  const isTranscriptView = route.startsWith('#/sessions/') && !isReportView;
  const transcriptSessionId = isTranscriptView
    ? route.replace('#/sessions/', '').split('/')[0]
    : null;

  const statusLabel =
    status === 'connected'
      ? 'Live call in progress'
      : status === 'connecting'
      ? 'Connecting to your coach'
      : status === 'error'
      ? 'Connection problem'
      : 'Ready when you are';

  const statusTone =
    status === 'connected'
      ? 'bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.5)]'
      : status === 'connecting'
      ? 'animate-pulse bg-amber-400'
      : status === 'error'
      ? 'bg-rose-500'
      : 'bg-slate-500';

  const isLive = status === 'connected';
  // Before a call the mic is simply idle, so a crossed-out icon would read as "broken".
  const micShowsMuted = isLive && !isMicActive;

  return (
    <div className="relative flex h-[100dvh] w-full overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden w-[248px] flex-none flex-col border-r border-white/[0.06] bg-black/20 px-3 py-4 backdrop-blur-xl lg:flex">
        <div className="px-1.5">
          <Brand />
        </div>

        <div className="mt-7 px-2">
          <p className="text-[15px] font-semibold leading-snug text-white">
            {greeting}, {displayName}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{suggestion}</p>
        </div>

        <nav className="mt-6 space-y-1" aria-label="Main">
          <p className="eyebrow px-3 pb-2">Workspace</p>
          {NAV_ITEMS.map((item) => (
            <SidebarLink
              key={item.hash}
              active={item.isActive(route)}
              label={item.label}
              icon={item.icon}
              badge={item.hash === '#/words' ? dueCount : undefined}
              onClick={() => navigate(item.hash)}
            />
          ))}
        </nav>

        <div className="mt-auto">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.05]"
          >
            <span className="grid h-8 w-8 flex-none place-items-center rounded-full border border-white/10 bg-white/[0.06] text-[11px] font-bold uppercase text-primary-glow">
              {(email ?? '?').slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-medium text-slate-300">
                {email ?? 'Signed in'}
              </span>
              <span className="block text-[10px] text-slate-500">Account &amp; sign out</span>
            </span>
            <SettingsIcon className="h-3.5 w-3.5 flex-none text-slate-500" />
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-20 flex h-16 flex-none items-center gap-3 border-b border-white/[0.06] bg-background/50 px-4 backdrop-blur-xl sm:px-6">
          <div className="lg:hidden">
            <Brand mini />
          </div>

          <div className="hidden min-w-0 items-center gap-2 lg:flex">
            <span className={cx('h-2 w-2 flex-none rounded-full', statusTone)} />
            <span className="truncate text-sm text-slate-300">{statusLabel}</span>
            {isMicActive && (
              <span className="chip ml-1 border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                Mic live
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={toggleAiMute}
              aria-pressed={isAiMuted}
              className={cx(
                'grid h-10 w-10 place-items-center rounded-xl border transition-colors',
                isAiMuted
                  ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                  : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white',
              )}
              title={isAiMuted ? 'Unmute coach voice' : 'Mute coach voice'}
              aria-label={isAiMuted ? 'Unmute coach voice' : 'Mute coach voice'}
            >
              {isAiMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>

            <button
              onClick={toggleEchoShield}
              aria-pressed={echoShield}
              className={cx(
                'hidden h-9 w-9 place-items-center rounded-xl border transition-colors xl:grid',
                echoShield
                  ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                  : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white',
              )}
              title={`Echo shield ${echoShield ? 'on' : 'off'}: stops speakers interrupting the coach`}
              aria-label="Toggle echo shield"
            >
              {echoShield ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            </button>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-400 transition-colors hover:text-white lg:hidden"
              title="Settings & profile"
              aria-label="Open settings"
            >
              <SettingsIcon className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Post-call banner */}
        {status === 'disconnected' && sessionId && route === '#/' && (
          <div className="animate-fade-in mx-3 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-2.5 text-xs text-primary-glow sm:mx-4">
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary-glow" />
              Call ended — your report is being prepared.
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => navigate(`#/sessions/${sessionId}`)} className="btn-ghost px-3 py-1.5">
                Transcript
              </button>
              <button onClick={() => navigate(`#/sessions/${sessionId}/report`)} className="btn-primary px-3 py-1.5">
                View report
              </button>
            </div>
          </div>
        )}

        <main className="relative min-h-0 flex-1">
          {isWordBankView ? (
            <WordBankView onBack={() => navigate('#/')} />
          ) : isProgressView ? (
            <ProgressView onBack={() => navigate('#/')} onOpenReport={(id) => navigate(`#/sessions/${id}/report`)} />
          ) : isSessionsList ? (
            <SessionsList
              onSelectSession={(id) => navigate(`#/sessions/${id}`)}
              onOpenReport={(id) => navigate(`#/sessions/${id}/report`)}
              onBackToCall={() => navigate('#/')}
            />
          ) : isReportView && reportSessionId ? (
            <ReportView
              sessionId={reportSessionId}
              onBack={() => navigate('#/sessions')}
              onOpenTranscript={(id) => navigate(`#/sessions/${id}`)}
              onOpenWordBank={() => navigate('#/words')}
            />
          ) : isTranscriptView && transcriptSessionId ? (
            <SessionTranscriptView
              sessionId={transcriptSessionId}
              onBack={() => navigate('#/sessions')}
              onOpenReport={(id) => navigate(`#/sessions/${id}/report`)}
            />
          ) : (
            /* Practice cockpit */
            <div className="h-full overflow-y-auto lg:overflow-hidden">
              <div className="mx-auto flex w-full max-w-7xl animate-fade-up flex-col gap-4 px-3 pb-24 pt-4 sm:px-4 lg:h-full lg:flex-row lg:gap-5 lg:pb-4">
                {/* Session panel */}
                <section className="panel-strong flex flex-col gap-3 p-4 sm:p-5 lg:h-full lg:min-h-0 lg:w-[400px] lg:flex-none xl:w-[440px]">
                  <UsageCard
                    usage={practiceUsage.usage}
                    liveSeconds={practiceUsage.liveSeconds}
                    isLive={isLive}
                    loading={practiceUsage.loading}
                    error={practiceUsage.error}
                  />

                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2">
                      <label htmlFor="focus" className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                        <Target className="h-3 w-3 text-cyan-400" />
                        Today&apos;s focus
                      </label>
                      <span className="text-[11px] text-slate-500">optional</span>
                    </div>
                    <input
                      id="focus"
                      type="text"
                      value={focus}
                      onChange={(e) => setFocus(e.target.value)}
                      maxLength={160}
                      disabled={isLive}
                      placeholder="What should we work on today?"
                      title="Your coach starts from this goal and returns to it during the call."
                      className="field border-white/20 bg-black/40 text-xs disabled:opacity-50"
                    />
                    {!isLive && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {FOCUS_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setFocus(preset)}
                            className={cx(
                              'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                              focus === preset
                                ? 'border-primary/50 bg-primary/15 text-primary-glow'
                                : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200',
                            )}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="relative flex h-[clamp(168px,26vh,240px)] items-center justify-center overflow-hidden rounded-3xl border border-white/[0.05] bg-black/20 lg:h-auto lg:min-h-[150px] lg:flex-1">
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-0 animate-breathe"
                      style={{
                        background:
                          'radial-gradient(circle at 50% 52%, rgba(124,108,255,0.22), transparent 62%)',
                      }}
                    />
                    <div className="orb-stage flex items-center justify-center">
                      <VoiceOrb state={agentState} userVolume={userVolume} agentVolume={agentVolume} />
                    </div>
                  </div>

                  <div className="flex-none space-y-2.5">
                    <div className="flex items-stretch gap-2">
                      <button
                        onClick={handleToggleConnect}
                        className={cx(
                          'btn h-11 flex-1 gap-2 px-4 text-[13px] shadow-lg',
                          isLive
                            ? 'bg-rose-600 text-white shadow-rose-600/25 hover:bg-rose-500'
                            : 'btn-primary',
                        )}
                      >
                        <Power className="h-4 w-4" />
                        <span>{isLive ? 'End session' : status === 'connecting' ? 'Connecting…' : 'Start session'}</span>
                      </button>

                      <button
                        onClick={toggleMic}
                        disabled={!isLive}
                        aria-pressed={isMicActive}
                        title={isLive ? 'Toggle your microphone' : 'Your microphone unlocks when the session starts'}
                        className={cx(
                          'btn h-11 gap-2 border px-4',
                          isMicActive
                            ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200'
                            : 'border-white/[0.12] bg-white/[0.05] text-slate-200 hover:bg-white/[0.09]',
                          !isLive && 'cursor-not-allowed opacity-45 hover:bg-white/[0.05]',
                        )}
                      >
                        {micShowsMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        <span>{micShowsMuted ? 'Unmute' : 'Mute'}</span>
                      </button>
                    </div>

                    <form onSubmit={handleSendText} className="relative">
                      <input
                        type="text"
                        placeholder={
                          isLive ? 'Type a message, or just speak…' : 'Start a session to talk with your coach'
                        }
                        value={inputPrompt}
                        onChange={(e) => setInputPrompt(e.target.value)}
                        disabled={!isLive}
                        aria-label="Message to your coach"
                        className="field border-white/15 pr-12 disabled:opacity-50"
                      />
                      <button
                        type="submit"
                        disabled={!isLive || !inputPrompt.trim()}
                        aria-label="Send message"
                        className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-xl bg-primary text-white transition-all hover:bg-primary-hover disabled:opacity-30"
                      >
                        <Send className="h-3.5 w-3.5" />
                      </button>
                    </form>

                    <p className="text-[11px] leading-snug text-slate-400">
                      {isLive
                        ? statusMessage
                        : 'Mic and chat unlock when the session starts. Headphones give the cleanest audio.'}
                    </p>
                  </div>
                </section>

                {/* Transcript */}
                <section className="flex min-h-[420px] flex-1 flex-col lg:h-full lg:min-h-0">
                  <TranscriptView
                    transcripts={transcripts}
                    onSuggestedPromptClick={(prompt) => {
                      setFocus(prompt);
                      if (isLive) {
                        sendTextMessage(prompt);
                      } else {
                        void connect(prompt);
                      }
                    }}
                  />
                </section>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.07] bg-background/90 backdrop-blur-xl lg:hidden"
      >
        <div className="grid grid-cols-4 px-1.5 pb-[env(safe-area-inset-bottom)]">
          {NAV_ITEMS.map((item) => {
            const active = item.isActive(route);
            return (
              <button
                key={item.hash}
                onClick={() => navigate(item.hash)}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors',
                  active ? 'text-white' : 'text-slate-500',
                )}
              >
                <span className={cx('transition-colors', active && 'text-primary-glow')}>{item.icon}</span>
                <span className="flex items-center gap-1">
                  {item.label}
                  {item.hash === '#/words' && dueCount > 0 && (
                    <span className="rounded-full bg-primary/25 px-1 text-[9px] text-primary-glow">
                      {dueCount}
                    </span>
                  )}
                </span>
                {active && <span className="absolute inset-x-5 top-0 h-[2px] rounded-full bg-primary" />}
              </button>
            );
          })}
        </div>
      </nav>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        email={email}
        onSignOut={() => void handleSignOut()}
      />
    </div>
  );
};
