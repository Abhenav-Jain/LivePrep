import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, Eye, X } from 'lucide-react';

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
    <div className="animate-scale-in overflow-hidden rounded-2xl border border-cyan-400/25 bg-surface/90 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/[0.07] bg-black/40 px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-cyan-300">
          <Eye className="h-3 w-3 animate-pulse" />
          <span>{type === 'screen' ? 'Screen' : 'Camera'}</span>
        </div>
        <div className="flex items-center gap-0.5">
          {onSnapshot && (
            <button
              onClick={handleSnapshot}
              className="grid h-6 w-6 place-items-center rounded-md text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              title="Send an instant snapshot"
              aria-label="Send an instant snapshot"
            >
              {snapshotTaken ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Camera className="h-3 w-3 text-cyan-300" />
              )}
            </button>
          )}
          <button
            onClick={onStop}
            className="grid h-6 w-6 place-items-center rounded-md text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            title="Stop the vision feed"
            aria-label="Stop the vision feed"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="relative flex aspect-video max-h-48 items-center justify-center bg-black sm:max-h-56">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
        <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1.5 rounded-md border border-white/10 bg-black/70 px-1.5 py-0.5 font-mono text-[9px] text-slate-300 backdrop-blur">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          <span>Adaptive frames</span>
        </div>
      </div>
    </div>
  );
};
