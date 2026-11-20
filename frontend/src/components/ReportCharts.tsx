import React from 'react';

/** Colour band used across score cards and charts. */
export function scoreTone(value: number | null): string {
  if (value === null) return 'text-slate-400';
  if (value >= 75) return 'text-emerald-400';
  if (value >= 50) return 'text-amber-400';
  return 'text-rose-400';
}

export function scoreStroke(value: number | null): string {
  if (value === null) return '#475569';
  if (value >= 75) return '#34d399';
  if (value >= 50) return '#fbbf24';
  return '#fb7185';
}

interface ScoreRingProps {
  value: number | null;
  size?: number;
  caption?: string;
  sublabel?: string;
}

/** Accessible circular score badge (no external chart dependency). */
export const ScoreRing: React.FC<ScoreRingProps> = ({ value, size = 132, caption, sublabel }) => {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * circumference;

  return (
    <div className="flex flex-col items-center" aria-label={caption ? `${caption}: ${value ?? 'not scored'}` : undefined}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1e293b" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={scoreStroke(value)}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-3xl font-extrabold tabular-nums ${scoreTone(value)}`}>
            {value === null ? '—' : Math.round(value)}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">{caption}</span>
        </div>
      </div>
      {sublabel && <span className="mt-2 text-xs text-slate-400">{sublabel}</span>}
    </div>
  );
};

interface ScoreBarProps {
  label: string;
  value: number | null;
  previous?: number | null;
  hint?: string;
}

/** One score row with an optional delta against the previous session. */
export const ScoreBar: React.FC<ScoreBarProps> = ({ label, value, previous, hint }) => {
  const delta = value !== null && previous !== undefined && previous !== null ? value - previous : null;
  const width = value === null ? 0 : Math.max(2, Math.min(100, value));

  return (
    <div className="rounded-xl bg-slate-900/60 border border-slate-800/80 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-300">{label}</span>
        <span className="flex items-center gap-1.5">
          {delta !== null && delta !== 0 && (
            <span className={`text-[10px] font-mono ${delta > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {delta > 0 ? '▲' : '▼'} {Math.abs(Math.round(delta))}
            </span>
          )}
          <span className={`text-sm font-bold tabular-nums ${scoreTone(value)}`}>
            {value === null ? '—' : Math.round(value)}
          </span>
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${width}%`, backgroundColor: scoreStroke(value) }}
        />
      </div>
      {hint && <p className="mt-1.5 text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
};

interface TrendPoint {
  label: string;
  value: number;
}

/** Dependency-free line chart for the progress trend (oldest left, newest right). */
export const TrendChart: React.FC<{ points: TrendPoint[]; height?: number }> = ({
  points,
  height = 180,
}) => {
  if (points.length === 0) return null;
  const width = 600;
  const padX = 16;
  const padY = 18;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = padX + (points.length > 1 ? i * stepX : innerW / 2);
    const y = padY + innerH - (Math.max(0, Math.min(100, p.value)) / 100) * innerH;
    return { ...p, x, y };
  });
  const line = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const area = `${padX},${height - padY} ${line} ${padX + innerW},${height - padY}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label={`Overall score trend: ${points.map((p) => `${p.label} ${p.value}`).join(', ')}`}
    >
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[25, 50, 75, 100].map((v) => {
        const y = padY + innerH - (v / 100) * innerH;
        return (
          <g key={v}>
            <line x1={padX} x2={width - padX} y1={y} y2={y} stroke="#1e293b" strokeWidth="1" />
            <text x={padX} y={y - 4} fill="#475569" fontSize="9" fontFamily="monospace">
              {v}
            </text>
          </g>
        );
      })}
      {points.length > 1 && <polygon points={area} fill="url(#trendFill)" />}
      <polyline
        points={line}
        fill="none"
        stroke="#60a5fa"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {coords.map((c) => (
        <g key={`${c.label}-${c.x}`}>
          <circle cx={c.x} cy={c.y} r="4.5" fill="#0f172a" stroke="#60a5fa" strokeWidth="2.5" />
          <text x={c.x} y={c.y - 10} fill="#cbd5e1" fontSize="10" textAnchor="middle">
            {c.value}
          </text>
        </g>
      ))}
    </svg>
  );
};
