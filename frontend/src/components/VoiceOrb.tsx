import React, { useEffect, useRef } from 'react';

interface VoiceOrbProps {
  state: 'idle' | 'listening' | 'thinking' | 'speaking';
  userVolume: number;
  agentVolume: number;
}

export const VoiceOrb: React.FC<VoiceOrbProps> = ({ state, userVolume, agentVolume }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let angle = 0;

    const render = () => {
      angle += 0.03;
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Determine active power based on state and volumes
      let intensity = 0.15;
      let primaryColor = 'rgba(59, 130, 246, '; // Blue
      let secondaryColor = 'rgba(147, 51, 234, '; // Purple

      if (state === 'listening') {
        intensity = Math.min(1.0, 0.2 + userVolume * 4.0);
        primaryColor = 'rgba(6, 182, 212, '; // Cyan
        secondaryColor = 'rgba(16, 185, 129, '; // Emerald
      } else if (state === 'speaking') {
        intensity = Math.min(1.0, 0.3 + agentVolume * 3.5);
        primaryColor = 'rgba(99, 102, 241, '; // Indigo
        secondaryColor = 'rgba(236, 72, 153, '; // Pink
      } else if (state === 'thinking') {
        intensity = 0.5 + Math.sin(angle * 3) * 0.25;
        primaryColor = 'rgba(245, 158, 11, '; // Amber
        secondaryColor = 'rgba(168, 85, 247, '; // Purple
      }

      // Outer ambient glow
      const baseRadius = 80;
      const pulseRadius = baseRadius + intensity * 40;
      const gradient = ctx.createRadialGradient(
        centerX,
        centerY,
        baseRadius * 0.4,
        centerX,
        centerY,
        pulseRadius * 1.6
      );
      gradient.addColorStop(0, primaryColor + (0.4 + intensity * 0.4) + ')');
      gradient.addColorStop(0.5, secondaryColor + (0.2 + intensity * 0.3) + ')');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.beginPath();
      ctx.arc(centerX, centerY, pulseRadius * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Fluid Wave Rings
      const numRings = 3;
      for (let r = 0; r < numRings; r++) {
        ctx.beginPath();
        const ringAngleOffset = (r * Math.PI) / 3;
        const ringRadius = baseRadius + (r * 12) + Math.sin(angle * 2 + ringAngleOffset) * (8 * intensity);

        const points = 32;
        for (let i = 0; i <= points; i++) {
          const theta = (i / points) * Math.PI * 2;
          const wobble = Math.sin(theta * 4 + angle * (r + 1) * 1.5) * (10 * intensity);
          const currentR = ringRadius + wobble;
          const x = centerX + Math.cos(theta) * currentR;
          const y = centerY + Math.sin(theta) * currentR;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
        ctx.strokeStyle = r % 2 === 0 ? primaryColor + '0.7)' : secondaryColor + '0.7)';
        ctx.lineWidth = 2.5 + intensity * 2;
        ctx.stroke();
      }

      // Core sphere
      const coreGradient = ctx.createRadialGradient(
        centerX - 15,
        centerY - 15,
        5,
        centerX,
        centerY,
        baseRadius * 0.8
      );
      coreGradient.addColorStop(0, '#ffffff');
      coreGradient.addColorStop(0.3, primaryColor + '0.9)');
      coreGradient.addColorStop(1, secondaryColor + '0.9)');

      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * 0.65 + intensity * 15, 0, Math.PI * 2);
      ctx.fillStyle = coreGradient;
      ctx.shadowColor = primaryColor + '0.8)';
      ctx.shadowBlur = 25 + intensity * 20;
      ctx.fill();
      ctx.shadowBlur = 0;

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [state, userVolume, agentVolume]);

  return (
    <div className="relative flex flex-col items-center justify-center">
      <canvas
        ref={canvasRef}
        width={340}
        height={340}
        className="w-[300px] h-[300px] sm:w-[340px] sm:h-[340px] transition-transform duration-300"
      />
      <div className="absolute bottom-2 flex items-center space-x-2 px-3 py-1 rounded-full bg-surface/80 backdrop-blur-md border border-slate-800 text-xs font-mono font-medium tracking-wide">
        <span
          className={`w-2 h-2 rounded-full ${
            state === 'speaking'
              ? 'bg-primary-glow animate-ping'
              : state === 'listening'
              ? 'bg-accent-cyan animate-pulse'
              : state === 'thinking'
              ? 'bg-accent-amber animate-spin'
              : 'bg-slate-500'
          }`}
        />
        <span className="uppercase text-slate-300">
          {state === 'idle'
            ? 'OmniCopilot Ready'
            : state === 'listening'
            ? 'Listening to you...'
            : state === 'thinking'
            ? 'Processing & Thinking...'
            : 'Speaking...'}
        </span>
      </div>
    </div>
  );
};
