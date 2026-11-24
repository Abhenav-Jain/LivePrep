import React from 'react';
import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';

export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');

/** Scrollable page frame with the shared max width, rhythm and bottom safe area. */
export const Page: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div className={cx('h-full overflow-y-auto', className)}>
    <div className="mx-auto w-full max-w-6xl animate-fade-up px-4 pb-28 pt-6 sm:px-6 lg:pb-14">
      {children}
    </div>
  </div>
);

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  onBack?: () => void;
  backLabel?: string;
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  eyebrow,
  title,
  description,
  icon,
  onBack,
  backLabel = 'Go back',
  actions,
}) => (
  <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
    <div className="flex items-start gap-3">
      {onBack && (
        <button onClick={onBack} aria-label={backLabel} title={backLabel} className="btn-ghost h-10 w-10 flex-none">
          <ArrowLeft className="h-4 w-4" />
        </button>
      )}
      <div>
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h1 className="flex items-center gap-2.5 font-display text-[1.9rem] leading-none text-white sm:text-[2.2rem]">
          {icon}
          <span>{title}</span>
        </h1>
        {description && <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">{description}</p>}
      </div>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

export const RefreshButton: React.FC<{ onClick: () => void; loading?: boolean; label?: string }> = ({
  onClick,
  loading = false,
  label = 'Refresh',
}) => (
  <button onClick={onClick} disabled={loading} className="btn-ghost px-3 py-2">
    <RefreshCw className={cx('h-3.5 w-3.5', loading && 'animate-spin')} />
    <span>{label}</span>
  </button>
);

export const SectionCard: React.FC<{
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}> = ({ title, description, icon, actions, children, className, bodyClassName }) => (
  <section className={cx('panel p-4 sm:p-5', className)}>
    {(title || actions) && (
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-slate-200">
            {icon}
            {title}
          </h2>
          {description && <p className="mt-0.5 text-[11px] text-slate-500">{description}</p>}
        </div>
        {actions}
      </div>
    )}
    <div className={bodyClassName}>{children}</div>
  </section>
);

export const StatTile: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  progress?: number | null;
  valueClassName?: string;
}> = ({ label, value, hint, icon, progress, valueClassName }) => (
  <div className="panel card-hover p-4">
    <div className="flex items-center justify-between gap-2">
      <span className="eyebrow">{label}</span>
      {icon}
    </div>
    <div className={cx('mt-2 font-display text-[1.75rem] leading-none tabular-nums text-white', valueClassName)}>
      {value}
    </div>
    {typeof progress === 'number' && (
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-accent-cyan transition-all duration-700"
          style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }}
        />
      </div>
    )}
    {hint && <p className="mt-2 text-[11px] leading-snug text-slate-500">{hint}</p>}
  </div>
);

export const SkeletonLines: React.FC<{ rows?: number }> = ({ rows = 3 }) => (
  <div className="space-y-2.5" aria-hidden>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="skeleton h-3.5" style={{ width: `${100 - i * 12}%` }} />
    ))}
  </div>
);

export const ErrorNote: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/[0.08] px-4 py-3 text-rose-200">
    <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-rose-300" />
    <div className="text-xs leading-relaxed">
      <p>{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 font-semibold text-rose-100 underline underline-offset-2 hover:text-white">
          Try again
        </button>
      )}
    </div>
  </div>
);

export const EmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}> = ({ icon, title, description, action }) => (
  <div className="panel flex flex-col items-center px-6 py-14 text-center">
    <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-400">
      {icon}
    </div>
    <h3 className="mt-4 text-sm font-semibold text-slate-100">{title}</h3>
    <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-400">{description}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>
);
