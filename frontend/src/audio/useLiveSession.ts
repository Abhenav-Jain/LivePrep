import { useState, useRef, useEffect, useCallback } from 'react';
import { StreamAudioPlayer } from './audio-player';

export interface TranscriptItem {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: Date;
}

export interface ToolCallItem {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'completed' | 'error';
  result?: unknown;
  startTime: Date;
  endTime?: Date;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

const WORKLET_PROCESSOR_CODE = `
class PCMRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.targetSampleRate = 16000;
    this.chunkSize = 1600;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;
    const channelData = input[0];
    const inputSampleRate = globalThis.sampleRate || 48000;
    const ratio = inputSampleRate / this.targetSampleRate;
    let inIndex = 0;
    while (inIndex < channelData.length) {
      const idx = Math.floor(inIndex);
      const nextIdx = Math.min(idx + 1, channelData.length - 1);
      const fraction = inIndex - idx;
      const sample = channelData[idx] * (1 - fraction) + channelData[nextIdx] * fraction;
      const s = Math.max(-1, Math.min(1, sample));
      const pcm16 = s < 0 ? s * 0x8000 : s * 0x7FFF;
      this.buffer.push(Math.round(pcm16));
      inIndex += ratio;
    }
    while (this.buffer.length >= this.chunkSize) {
      const chunk = this.buffer.splice(0, this.chunkSize);
      const int16Array = new Int16Array(chunk);
      let sum = 0;
      for (let i = 0; i < chunk.length; i++) {
        sum += (chunk[i] / 32768) * (chunk[i] / 32768);
      }
      const rms = Math.sqrt(sum / chunk.length);
      this.port.postMessage({ pcmData: int16Array.buffer, volume: rms }, [int16Array.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-recorder-processor', PCMRecorderProcessor);
`;

export function useLiveSession() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [statusMessage, setStatusMessage] = useState<string>('Ready to connect');
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallItem[]>([]);
  const [isMicActive, setIsMicActive] = useState<boolean>(false);
  const [isScreenActive, setIsScreenActive] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [userVolume, setUserVolume] = useState<number>(0);
  const [agentVolume, setAgentVolume] = useState<number>(0);
  const [agentState, setAgentState] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [echoShield, setEchoShield] = useState<boolean>(true); // Anti-Self-Interruption Shield
  const [visionMode, setVisionMode] = useState<'adaptive' | 'continuous'>('adaptive');

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const videoFrameIntervalRef = useRef<number | null>(null);
  const audioPlayerRef = useRef<StreamAudioPlayer | null>(null);

  // References to avoid stale state closures inside event loops
  const isUserSpeakingRef = useRef<boolean>(false);
  const silenceTimerRef = useRef<number | null>(null);
  const agentStateRef = useRef<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const echoShieldRef = useRef<boolean>(true);
  const lastThumbnailRef = useRef<Uint8ClampedArray | null>(null);
  const framesSinceLastSendRef = useRef<number>(0);

  useEffect(() => {
    agentStateRef.current = agentState;
  }, [agentState]);

  useEffect(() => {
    echoShieldRef.current = echoShield;
  }, [echoShield]);

  // Initialize 24kHz Stream Audio Player with instant flush
  useEffect(() => {
    audioPlayerRef.current = new StreamAudioPlayer((volume) => {
      setAgentVolume(volume);
      if (volume > 0.02) {
        setAgentState('speaking');
      } else {
        setAgentState((prev) => (prev === 'speaking' ? 'idle' : prev));
      }
    });

    return () => {
      audioPlayerRef.current?.close();
    };
  }, []);

  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  // Start Microphone with Acoustic Echo Shield
  const startMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const source = audioCtx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioCtx, 'pcm-recorder-processor');
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (event) => {
        const { pcmData, volume } = event.data;
        setUserVolume(volume);

        const isSpeaking = agentStateRef.current === 'speaking';
        // Echo Shield: If AI is actively speaking from laptop speakers, raise threshold to 0.12
        // so ambient speaker bleed doesn't falsely interrupt. Intentional user voice easily exceeds 0.12!
        const effectiveThreshold = echoShieldRef.current && isSpeaking ? 0.12 : 0.028;

        if (volume > effectiveThreshold) {
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
          isUserSpeakingRef.current = true;
          setAgentState('listening');
        } else if (isUserSpeakingRef.current && !silenceTimerRef.current) {
          // Fast Hybrid VAD trigger (280ms debounce for natural turn-taking)
          silenceTimerRef.current = window.setTimeout(() => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && isUserSpeakingRef.current) {
              wsRef.current.send(JSON.stringify({ type: 'audio_stream_end' }));
            }
            isUserSpeakingRef.current = false;
            silenceTimerRef.current = null;
            setAgentState('thinking');
          }, 280);
        }

        // Stream audio chunk to backend as binary frame (0x01 type byte + raw PCM)
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && pcmData) {
          const typeByte = new Uint8Array([0x01]);
          const combined = new Uint8Array(typeByte.length + pcmData.byteLength);
          combined.set(typeByte, 0);
          combined.set(new Uint8Array(pcmData), typeByte.length);
          wsRef.current.send(combined);
        }
      };

      source.connect(workletNode);
      workletNode.connect(audioCtx.destination);
      setIsMicActive(true);
    } catch (err) {
      console.error('Failed to start microphone:', err);
      setStatusMessage('Microphone access denied or unavailable.');
    }
  };

  const stopMic = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    isUserSpeakingRef.current = false;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsMicActive(false);
    setUserVolume(0);
  };

  // Sends a single crisp frame from the active video stream
  const sendCurrentVideoFrame = () => {
    const video = videoElementRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const maxDim = 1024;
    let w = video.videoWidth;
    let h = video.videoHeight;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }

    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
    const b64 = dataUrl.split(',')[1];

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && b64) {
      wsRef.current.send(JSON.stringify({ type: 'video', data: b64 }));
    }
  };

  // Adaptive Motion-Based Video Stream Loop (saves up to 80% tokens & bandwidth)
  const startVideoFrameLoop = (stream: MediaStream) => {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    video.play();
    videoElementRef.current = video;

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 32;
    thumbCanvas.height = 32;
    const thumbCtx = thumbCanvas.getContext('2d');

    lastThumbnailRef.current = null;
    framesSinceLastSendRef.current = 0;

    // Send initial frame immediately upon stream open
    setTimeout(() => sendCurrentVideoFrame(), 400);

    videoFrameIntervalRef.current = window.setInterval(() => {
      if (!video.videoWidth || !video.videoHeight || !thumbCtx) return;

      // Compute motion difference using low-res 32x32 thumbnail
      thumbCtx.drawImage(video, 0, 0, 32, 32);
      const currentThumb = thumbCtx.getImageData(0, 0, 32, 32).data;

      let isMotion = false;
      if (lastThumbnailRef.current) {
        let diffSum = 0;
        for (let i = 0; i < currentThumb.length; i += 4) {
          diffSum += Math.abs(currentThumb[i] - lastThumbnailRef.current[i]);
        }
        const avgDiff = diffSum / (32 * 32 * 255);
        if (avgDiff > 0.035) {
          isMotion = true;
        }
      } else {
        isMotion = true;
      }
      lastThumbnailRef.current = currentThumb;

      framesSinceLastSendRef.current++;

      // In adaptive mode: send on visual change OR every 6 seconds heartbeat
      if (visionMode === 'adaptive') {
        if (isMotion || framesSinceLastSendRef.current >= 6) {
          sendCurrentVideoFrame();
          framesSinceLastSendRef.current = 0;
        }
      } else {
        // Continuous mode: 1 frame every second
        sendCurrentVideoFrame();
      }
    }, 1000);
  };

  const stopVideo = () => {
    if (videoFrameIntervalRef.current) {
      clearInterval(videoFrameIntervalRef.current);
      videoFrameIntervalRef.current = null;
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop());
      videoStreamRef.current = null;
    }
    if (videoElementRef.current) {
      videoElementRef.current.pause();
      videoElementRef.current.srcObject = null;
      videoElementRef.current = null;
    }
    setIsScreenActive(false);
    setIsCameraActive(false);
  };

  const startScreenShare = async () => {
    try {
      stopVideo();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
      });
      videoStreamRef.current = stream;
      setIsScreenActive(true);
      startVideoFrameLoop(stream);

      stream.getVideoTracks()[0].onended = () => {
        stopVideo();
      };
    } catch (err) {
      console.warn('Screen share canceled or failed:', err);
    }
  };

  const startCamera = async () => {
    try {
      stopVideo();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
      });
      videoStreamRef.current = stream;
      setIsCameraActive(true);
      startVideoFrameLoop(stream);

      stream.getVideoTracks()[0].onended = () => {
        stopVideo();
      };
    } catch (err) {
      console.warn('Camera canceled or failed:', err);
    }
  };

  // Connect to WebSocket Gateway with resilient state
  const connect = useCallback((apiKey?: string, model?: string, livePrepToken?: string) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    setStatus('connecting');
    setStatusMessage('Connecting to Live Gateway...');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const params = new URLSearchParams();
    // API key is now sent via auth message, NOT query string (security fix)
    if (model) params.set('model', model);

    const wsUrl = `${protocol}//${host}/ws/live?${params.toString()}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Send auth message as the first message (required by backend)
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'auth',
          token: livePrepToken || '',
          api_key: apiKey || '',
        }));
      }
      setStatus('connected');
      setStatusMessage('Connected. Initializing Gemini Live...');
      startMic();
    };

    ws.onmessage = (event) => {
      // Handle binary audio frames (0x01 type byte + raw PCM)
      if (typeof event.data !== 'string') {
        const reader = new FileReader();
        reader.onload = () => {
          const buffer = reader.result as ArrayBuffer;
          if (buffer.byteLength < 2) return;
          const view = new Uint8Array(buffer);
          const typeByte = view[0];
          if (typeByte === 0x01) {
            // Binary audio frame - play directly
            audioPlayerRef.current?.playChunk(buffer.slice(1));
          }
        };
        reader.readAsArrayBuffer(event.data as Blob);
        return;
      }

      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'session_status':
            setStatusMessage(msg.message);
            if (msg.status === 'connected') {
              setStatus('connected');
            } else if (msg.status === 'disconnected') {
              setStatus('disconnected');
            }
            break;

          case 'audio':
            if (msg.data) {
              audioPlayerRef.current?.playChunk(msg.data);
            }
            break;

          case 'interrupted':
            audioPlayerRef.current?.flush();
            setAgentState('listening');
            break;

          case 'user_transcription':
            setTranscripts((prev) => [
              ...prev,
              {
                id: Math.random().toString(),
                sender: 'user',
                text: msg.text,
                timestamp: new Date(),
              },
            ]);
            break;

          case 'agent_transcription':
            setTranscripts((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.sender === 'agent') {
                return [
                  ...prev.slice(0, -1),
                  { ...last, text: last.text + ' ' + msg.text },
                ];
              }
              return [
                ...prev,
                {
                  id: Math.random().toString(),
                  sender: 'agent',
                  text: msg.text,
                  timestamp: new Date(),
                },
              ];
            });
            break;

          case 'tool_started':
            setAgentState('thinking');
            setToolCalls((prev) => [
              ...prev,
              {
                callId: msg.call_id,
                name: msg.name,
                args: msg.args || {},
                status: 'running',
                startTime: new Date(),
              },
            ]);
            break;

          case 'tool_completed':
            setToolCalls((prev) =>
              prev.map((t) =>
                t.callId === msg.call_id
                  ? {
                      ...t,
                      status: t.status === 'error' ? 'error' : (msg.result?.status === 'error' ? 'error' : 'completed'),
                      result: msg.result,
                      endTime: new Date(),
                    }
                  : t
              )
            );
            break;

          case 'error':
            setStatus('error');
            setStatusMessage(msg.message || 'An error occurred.');
            break;

          default:
            break;
        }
      } catch (e) {
        console.error('Failed to parse incoming WebSocket message:', e);
      }
    };

    ws.onerror = (e) => {
      console.error('WebSocket encountered an error:', e);
      setStatus('error');
      setStatusMessage('WebSocket connection failed.');
    };

    ws.onclose = () => {
      setStatus('disconnected');
      setStatusMessage('Session disconnected.');
      stopMic();
      stopVideo();
    };
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    stopMic();
    stopVideo();
    audioPlayerRef.current?.flush();
    setStatus('disconnected');
    setStatusMessage('Disconnected.');
  }, []);

  const sendTextMessage = (text: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && text.trim()) {
      wsRef.current.send(JSON.stringify({ type: 'text', text }));
      setTranscripts((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          sender: 'user',
          text,
          timestamp: new Date(),
        },
      ]);
    }
  };

  return {
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
    visionMode,
    videoStream: videoStreamRef.current,
    connect,
    disconnect,
    toggleMic: () => (isMicActive ? stopMic() : startMic()),
    startScreenShare,
    stopScreenShare: stopVideo,
    startCamera,
    stopCamera: stopVideo,
    sendTextMessage,
    captureSnapshot: sendCurrentVideoFrame,
    toggleEchoShield: () => setEchoShield((prev) => !prev),
    setVisionMode,
  };
}
