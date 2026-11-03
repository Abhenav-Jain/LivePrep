import React, { useState, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Monitor,
  Video,
  VideoOff,
  Power,
  Settings as SettingsIcon,
  Send,
  Radio,
  Cpu,
  Layers,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { useLiveSession } from './audio/useLiveSession';
import { VoiceOrb } from './components/VoiceOrb';
import { ScreenPreview } from './components/ScreenPreview';
import { TranscriptView } from './components/TranscriptView';
import { ToolActivityCard } from './components/ToolActivityCard';
import { SettingsModal } from './components/SettingsModal';

export const App: React.FC = () => {
  const {
    status,
    statusMessage,
    transcripts,
    toolCalls,
    isMicActive,
    isScreenActive,
    isCameraActive,
    userVolume,
    agentVolume,
    agentState,
    echoShield,
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

  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('omni_gemini_api_key') || '');
  const [selectedModel, setSelectedModel] = useState<string>(
    () => localStorage.getItem('omni_gemini_model') || 'gemini-3.8-live'
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [inputPrompt, setInputPrompt] = useState<string>('');

  useEffect(() => {
    localStorage.setItem('omni_gemini_api_key', apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem('omni_gemini_model', selectedModel);
  }, [selectedModel]);

  const handleToggleConnect = () => {
    if (status === 'connected' || status === 'connecting') {
      disconnect();
    } else {
      connect(apiKey, selectedModel);
    }
  };

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputPrompt.trim()) {
      sendTextMessage(inputPrompt.trim());
      setInputPrompt('');
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-slate-100 font-sans selection:bg-primary/30">
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-slate-800/80 px-6 flex items-center justify-between bg-surface/40 backdrop-blur-md z-20">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
            <Radio className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-extrabold tracking-wider uppercase bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-cyan-400 to-purple-400">
                OmniCopilot Live
              </h1>
              <span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary-glow border border-primary/30 text-[10px] font-mono font-bold">
                ENTERPRISE
              </span>
            </div>
            <p className="text-[10px] font-mono text-slate-400">
              Low-Latency Multimodal Voice, Vision & Async Tool Agent
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3 sm:space-x-4">
          {/* Echo Shield Toggle */}
          <button
            onClick={toggleEchoShield}
            className={`hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono transition-colors ${
              echoShield
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:bg-slate-800'
            }`}
            title="Acoustic Echo Shield: Prevents laptop speakers from self-interrupting the agent."
          >
            {echoShield ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> : <ShieldAlert className="w-3.5 h-3.5 text-slate-400" />}
            <span>Echo Shield: {echoShield ? 'ON' : 'OFF'}</span>
          </button>

          {/* Connection Status Badge */}
          <div className="flex items-center space-x-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono">
            <span
              className={`w-2 h-2 rounded-full ${
                status === 'connected'
                  ? 'bg-emerald-400 shadow-sm shadow-emerald-400'
                  : status === 'connecting'
                  ? 'bg-amber-400 animate-ping'
                  : status === 'error'
                  ? 'bg-rose-500'
                  : 'bg-slate-500'
              }`}
            />
            <span className="text-slate-300 capitalize">{status}</span>
          </div>

          {/* Model Pill */}
          <div className="hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700/60 text-xs font-mono text-slate-300">
            <Cpu className="w-3.5 h-3.5 text-primary-glow" />
            <span>{selectedModel}</span>
          </div>

          {/* Settings Button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition-colors"
            title="Configure API Key & Model"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Cockpit Workspace */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden p-4 gap-4">
        {/* Left Section: Voice Orb, Vision PiP, and Controls */}
        <section className="flex-[5] flex flex-col rounded-3xl bg-surface/40 border border-slate-800/80 backdrop-blur-xl p-5 relative overflow-hidden justify-between shadow-2xl">
          {/* Status Message Header */}
          <div className="flex items-center justify-between text-xs font-mono text-slate-400 z-10">
            <span className="flex items-center space-x-2">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>{statusMessage}</span>
            </span>
            <div className="flex items-center space-x-2">
              {isMicActive && (
                <span className="flex items-center space-x-1 text-emerald-400 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>16kHz PCM MIC</span>
                </span>
              )}
            </div>
          </div>

          {/* Center Stage: Voice Orb & PiP overlay */}
          <div className="relative flex-1 flex flex-col items-center justify-center my-4">
            <VoiceOrb
              state={agentState}
              userVolume={userVolume}
              agentVolume={agentVolume}
            />

            {/* Live Video Preview overlay */}
            <div className="absolute top-0 right-0 max-w-[280px] z-10">
              <ScreenPreview
                stream={videoStream}
                isActive={isScreenActive || isCameraActive}
                type={isScreenActive ? 'screen' : 'camera'}
                onStop={isScreenActive ? stopScreenShare : stopCamera}
                onSnapshot={captureSnapshot}
              />
            </div>
          </div>

          {/* Bottom Dock Control Bar */}
          <div className="space-y-4 z-10">
            {/* Action Buttons */}
            <div className="flex items-center justify-center space-x-3 sm:space-x-4">
              {/* Power / Connect */}
              <button
                onClick={handleToggleConnect}
                className={`flex items-center space-x-2 px-5 py-3 rounded-2xl font-semibold text-sm transition-all shadow-lg ${
                  status === 'connected'
                    ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/30'
                    : 'bg-primary hover:bg-blue-600 text-white shadow-primary/30'
                }`}
              >
                <Power className="w-4 h-4" />
                <span>{status === 'connected' ? 'End Session' : 'Start Live Session'}</span>
              </button>

              {/* Mic Toggle */}
              <button
                onClick={toggleMic}
                disabled={status !== 'connected'}
                className={`p-3 rounded-2xl border transition-all ${
                  isMicActive
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/30'
                    : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
                } ${status !== 'connected' ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={isMicActive ? 'Mute Microphone' : 'Unmute Microphone'}
              >
                {isMicActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </button>

              {/* Screen Share Toggle */}
              <button
                onClick={isScreenActive ? stopScreenShare : startScreenShare}
                disabled={status !== 'connected'}
                className={`p-3 rounded-2xl border transition-all ${
                  isScreenActive
                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/30 shadow-lg shadow-cyan-500/20'
                    : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
                } ${status !== 'connected' ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={isScreenActive ? 'Stop Screen Share' : 'Share Screen with Gemini'}
              >
                <Monitor className="w-5 h-5" />
              </button>

              {/* Webcam Toggle */}
              <button
                onClick={isCameraActive ? stopCamera : startCamera}
                disabled={status !== 'connected'}
                className={`p-3 rounded-2xl border transition-all ${
                  isCameraActive
                    ? 'bg-purple-500/20 border-purple-500/50 text-purple-400 hover:bg-purple-500/30'
                    : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
                } ${status !== 'connected' ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={isCameraActive ? 'Stop Webcam' : 'Turn on Webcam'}
              >
                {isCameraActive ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </button>
            </div>

            {/* Text Input / Quick injection */}
            <form onSubmit={handleSendText} className="relative flex items-center">
              <input
                type="text"
                placeholder={
                  status === 'connected'
                    ? 'Type a message or speak into your mic...'
                    : 'Connect session to chat or speak...'
                }
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                disabled={status !== 'connected'}
                className="w-full pl-4 pr-12 py-3 rounded-2xl bg-slate-900/80 border border-slate-800 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary/60 transition-colors disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={status !== 'connected' || !inputPrompt.trim()}
                className="absolute right-2 p-2 rounded-xl bg-primary text-white hover:bg-blue-600 disabled:opacity-40 transition-opacity"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </section>

        {/* Right Section: Transcripts & Async Tool Activities */}
        <section className="flex-[6] flex flex-col gap-4 overflow-hidden">
          {/* Real-time Transcription Stream */}
          <div className="flex-1 overflow-hidden">
            <TranscriptView
              transcripts={transcripts}
              onSuggestedPromptClick={(prompt) => {
                if (status === 'connected') {
                  sendTextMessage(prompt);
                } else {
                  connect(apiKey, selectedModel);
                }
              }}
            />
          </div>

          {/* Async Non-Blocking Tool Cards */}
          <div className="h-64 sm:h-72">
            <ToolActivityCard toolCalls={toolCalls} />
          </div>
        </section>
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        apiKey={apiKey}
        onApiKeyChange={setApiKey}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
      />
    </div>
  );
};
