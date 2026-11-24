import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  History,
  Layers,
  Mic,
  MicOff,
  Monitor,
  Power,
  Radio,
  Send,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  Target,
  TrendingUp,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react';
import { useLiveSession } from './audio/useLiveSession';
import { useAuth } from './auth/AuthProvider';
import { VoiceOrb } from './components/VoiceOrb';
import { ScreenPreview } from './components/ScreenPreview';
import { TranscriptView } from './components/TranscriptView';
import { ToolActivityCard } from './components/ToolActivityCard';
import { SettingsModal } from './components/SettingsModal';
import { SessionsList } from './components/SessionsList';
import { SessionTranscriptView } from './components/SessionTranscriptView';
import { ReportView } from './components/ReportView';
import { ProgressView } from './components/ProgressView';
import { WordBankView } from './components/WordBankView';
import { UsageCard, UsagePill } from './components/UsageMeter';
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

const DOCK_TONES = {
  emerald: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300',
  cyan: 'border-cyan-400/40 bg-cyan-400/15 text-cyan-300',
  violet: 'border-primary/40 bg-primary/15 text-primary-glow',
} as const;

const Brand: React.FC<{ mini?: boolean }> = ({ mini = false }) => (
  <div className="flex items-center gap-2.5">
    <div className="grid h-9 w-9 flex-none place-items-center rounded-2xl bg-gradient-to-br from-primary to-accent-cyan text-white shadow-glow">
      <Radio className="h-4 w-4" />
    </div>
    <div className="leading-none">
      <p className={cx('font-display tracking-tight text-white', mini ? 'text-xl' : 'text-[1.35rem]')}>LivePrep</p>
      {!mini && (
        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">
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
      <span className="rounded-full bg-primary/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary-glow">
        {badge}
      </span>
    )}
  </button>
);

const DockButton: React.FC<{
  label: string;
  active?: boolean;
  tone?: keyof typeof DOCK_TONES;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, active = false, tone = 'violet', disabled = false, onClick, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    aria-pressed={active}
    aria-label={label}
    title={label}
    className={cx(
      'grid h-11 w-11 place-items-center rounded-2xl border transition-all duration-200 active:scale-95',
      active
        ? DOCK_TONES[tone]
        : 'border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] hover:text-white',
      disabled && 'cursor-not-allowed opacity-35 hover:bg-white/[0.04] hover:text-slate-400',
    )}
  >
    {children}
  </button>
);

export const App: React.FC = () => {
  const {
    status,
    statusMessage,
    sessionId,
    transcripts,
    toolCalls,
    isMicActive,
    isScreenActive,
    isCameraActive,
    userVolume,
    agentVolume,
    agentState,
    echoShield,
    isAiMuted,
    toggleAiMute,
    videoStream,
    connect,
    disconnect,
    toggleMic,
    startScreenShare,
    stopScreenShare,
    startCamera,
    stopCamera,
    sendTextMessage,
    captureSnapshot,
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
  const [showTools, setShowTools] = useState<boolean>(false);

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

  return (
    <div className="relative flex h-[100dvh] w-full overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden w-[248px] flex-none flex-col border-r border-white/[0.06] bg-black/20 px-3 py-4 backdrop-blur-xl lg:flex">
        <div className="px-1.5">
          <Brand />
        </div>

        <nav className="mt-8 space-y-1" aria-label="Main">
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

        <div className="mt-auto space-y-3">
          <div className="panel px-3.5 py-3">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Status</span>
              <span className="flex items-center gap-1.5 font-mono text-[10px] capitalize text-slate-400">
                <span
                  className={cx(
                    'h-1.5 w-1.5 rounded-full',
                    status === 'connected'
                      ? 'bg-emerald-400'
                      : status === 'connecting'
                      ? 'animate-pulse bg-amber-400'
                      : status === 'error'
                      ? 'bg-rose-500'
                      : 'bg-slate-500',
                  )}
                />
                {status}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">{statusLabel}</p>
          </div>

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
            <span
              className={cx(
                'h-1.5 w-1.5 flex-none rounded-full',
                status === 'connected'
                  ? 'bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.5)]'
                  : status === 'connecting'
                  ? 'animate-pulse bg-amber-400'
                  : status === 'error'
                  ? 'bg-rose-500'
                  : 'bg-slate-500',
              )}
            />
            <span className="truncate text-xs text-slate-400">{statusLabel}</span>
            {isMicActive && (
              <span className="chip ml-1 border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                Mic live
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <UsagePill
              usage={practiceUsage.usage}
              liveSeconds={practiceUsage.liveSeconds}
              isLive={status === 'connected'}
              loading={practiceUsage.loading}
              error={practiceUsage.error}
            />

            <button
              onClick={toggleAiMute}
              aria-pressed={isAiMuted}
              className={cx(
                'grid h-9 w-9 place-items-center rounded-xl border transition-colors',
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
              className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-400 transition-colors hover:text-white lg:hidden"
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
            <div className="h-full overflow-y-auto">
              <div className="mx-auto flex w-full max-w-6xl animate-fade-up flex-col gap-4 px-3 pb-28 pt-4 sm:px-4 lg:h-full lg:flex-row lg:overflow-hidden lg:pb-4">
                {/* Session panel */}
                <section className="panel-strong flex flex-col gap-3.5 p-4 sm:p-5 lg:w-[420px] lg:flex-none xl:w-[460px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="chip max-w-[70%] truncate normal-case tracking-normal text-slate-300">
                      <Layers className="h-3 w-3 flex-none text-primary-glow" />
                      <span className="truncate">{statusMessage}</span>
                    </span>
                    {isMicActive && (
                      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-300">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                        16 kHz
                      </span>
                    )}
                  </div>

                  <UsageCard
                    usage={practiceUsage.usage}
                    liveSeconds={practiceUsage.liveSeconds}
                    isLive={status === 'connected'}
                    loading={practiceUsage.loading}
                    error={practiceUsage.error}
                  />

                  <div>
                    <label htmlFor="focus" className="eyebrow mb-1.5 flex items-center gap-1.5">
                      <Target className="h-3 w-3 text-cyan-400" />
                      Today&apos;s focus
                      <span className="font-sans text-[10px] normal-case tracking-normal text-slate-600">optional</span>
                    </label>
                    <input
                      id="focus"
                      type="text"
                      value={focus}
                      onChange={(e) => setFocus(e.target.value)}
                      maxLength={160}
                      disabled={status === 'connected'}
                      placeholder="Past tense, telling stories, small talk…"
                      title="Your coach starts from this goal and returns to it during the call."
                      className="field text-xs disabled:opacity-50"
                    />
                  </div>

                  <div className="relative flex min-h-[240px] flex-1 items-center justify-center overflow-hidden rounded-3xl border border-white/[0.05] bg-black/20">
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-0 animate-breathe"
                      style={{
                        background:
                          'radial-gradient(circle at 50% 52%, rgba(124,108,255,0.22), transparent 62%)',
                      }}
                    />
                    <VoiceOrb state={agentState} userVolume={userVolume} agentVolume={agentVolume} />
                    <div className="absolute right-2.5 top-2.5 z-10 max-w-[220px]">
                      <ScreenPreview
                        stream={videoStream}
                        isActive={isScreenActive || isCameraActive}
                        type={isScreenActive ? 'screen' : 'camera'}
                        onStop={isScreenActive ? stopScreenShare : stopCamera}
                        onSnapshot={captureSnapshot}
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={handleToggleConnect}
                        className={cx(
                          'btn h-11 gap-2 px-5 text-[13px] shadow-lg',
                          status === 'connected'
                            ? 'bg-rose-600 text-white shadow-rose-600/25 hover:bg-rose-500'
                            : 'btn-primary',
                        )}
                      >
                        <Power className="h-4 w-4" />
                        <span>{status === 'connected' ? 'End call' : 'Start session'}</span>
                      </button>

                      <DockButton
                        label={isMicActive ? 'Mute microphone' : 'Unmute microphone'}
                        active={isMicActive}
                        tone="emerald"
                        disabled={status !== 'connected'}
                        onClick={toggleMic}
                      >
                        {isMicActive ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                      </DockButton>

                      <DockButton
                        label={isScreenActive ? 'Stop screen share' : 'Share your screen'}
                        active={isScreenActive}
                        tone="cyan"
                        disabled={status !== 'connected'}
                        onClick={isScreenActive ? stopScreenShare : startScreenShare}
                      >
                        <Monitor className="h-4 w-4" />
                      </DockButton>

                      <DockButton
                        label={isCameraActive ? 'Stop camera' : 'Turn on camera'}
                        active={isCameraActive}
                        tone="violet"
                        disabled={status !== 'connected'}
                        onClick={isCameraActive ? stopCamera : startCamera}
                      >
                        {isCameraActive ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                      </DockButton>
                    </div>

                    <form onSubmit={handleSendText} className="relative">
                      <input
                        type="text"
                        placeholder={
                          status === 'connected'
                            ? 'Type a message, or just speak…'
                            : 'Start a session to talk with your coach'
                        }
                        value={inputPrompt}
                        onChange={(e) => setInputPrompt(e.target.value)}
                        disabled={status !== 'connected'}
                        aria-label="Message to your coach"
                        className="field pr-12 disabled:opacity-50"
                      />
                      <button
                        type="submit"
                        disabled={status !== 'connected' || !inputPrompt.trim()}
                        aria-label="Send message"
                        className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-xl bg-primary text-white transition-all hover:bg-primary-hover disabled:opacity-30"
                      >
                        <Send className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  </div>
                </section>

                {/* Transcript + tools */}
                <section className="flex min-h-[440px] flex-1 flex-col gap-3">
                  <div className="min-h-[280px] flex-1">
                    <TranscriptView
                      transcripts={transcripts}
                      onSuggestedPromptClick={(prompt) => {
                        if (status === 'connected') {
                          sendTextMessage(prompt);
                        } else {
                          handleToggleConnect();
                        }
                      }}
                    />
                  </div>

                  <div className="flex-none">
                    <button
                      onClick={() => setShowTools((value) => !value)}
                      aria-expanded={showTools}
                      className="flex w-full items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 transition-colors hover:border-white/10 hover:bg-white/[0.04]"
                    >
                      <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400">
                        <Wrench className="h-3.5 w-3.5 text-emerald-400" />
                        Coaching tools
                        <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-slate-400">
                          {toolCalls.length}
                        </span>
                      </span>
                      <ChevronDown
                        className={cx('h-4 w-4 text-slate-500 transition-transform', showTools && 'rotate-180')}
                      />
                    </button>
                    {showTools && (
                      <div className="mt-2 h-52 animate-scale-in">
                        <ToolActivityCard toolCalls={toolCalls} />
                      </div>
                    )}
                  </div>
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
                    <span className="rounded-full bg-primary/25 px-1 font-mono text-[9px] text-primary-glow">
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
