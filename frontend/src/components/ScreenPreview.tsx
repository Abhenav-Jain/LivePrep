import React, { useEffect, useRef, useState } from 'react';
import { X, Eye, Camera, Check } from 'lucide-react';

interface ScreenPreviewProps {
  stream: MediaStream | null;
  isActive: boolean;
  type: 'screen' | 'camera';
  onStop: () => void;
  onSnapshot?: () => void;
}

export const ScreenPreview: React.FC<ScreenPreviewProps> = ({
  stream,
  isActive,
  type,
  onStop,
  onSnapshot,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [snapshotTaken, setSnapshotTaken] = useState(false);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch((e) => console.warn('Video preview play error:', e));
    }
  }, [stream]);

  if (!isActive || !stream) {
    return null;
  }

  const handleSnapshot = () => {
    onSnapshot?.();
    setSnapshotTaken(true);
    setTimeout(() => setSnapshotTaken(false), 1200);
  };

  return (
    <div className="relative rounded-2xl overflow-hidden border border-cyan-500/30 bg-surface/90 shadow-2xl backdrop-blur-xl group transition-all duration-300">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/80 border-b border-slate-800 text-xs">
        <div className="flex items-center space-x-2 text-cyan-400 font-medium">
          <Eye className="w-3.5 h-3.5 animate-pulse text-cyan-400" />
          <span>ADAPTIVE VISION ({type === 'screen' ? 'SCREEN' : 'WEBCAM'})</span>
        </div>
        <div className="flex items-center space-x-1">
          {onSnapshot && (
            <button
              onClick={handleSnapshot}
              className="p-1 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
              title="Send Instant Snapshot to Gemini"
            >
              {snapshotTaken ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Camera className="w-3.5 h-3.5 text-cyan-400" />
              )}
            </button>
          )}
          <button
            onClick={onStop}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Stop Vision Feed"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="relative aspect-video max-h-48 sm:max-h-56 bg-black flex items-center justify-center">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-contain"
        />
        <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur border border-white/10 text-[10px] font-mono text-slate-300 flex items-center space-x-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Smart Motion Throttling (80% token savings)</span>
        </div>
      </div>
    </div>
  );
};
