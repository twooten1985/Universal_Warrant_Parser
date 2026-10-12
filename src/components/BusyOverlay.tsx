import { Loader2 } from 'lucide-react';

export interface BusyState {
  label: string;
  detail?: string;
  current?: number;
  total?: number;
}

export function BusyOverlay({ busy }: { busy: BusyState | null }) {
  if (!busy) return null;
  const hasNumbers = typeof busy.current === 'number' && typeof busy.total === 'number' && busy.total > 0;
  const percent = hasNumbers ? Math.max(0, Math.min(100, Math.round((busy.current! / busy.total!) * 100))) : null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 backdrop-blur-[2px] p-4"
      role="alertdialog"
      aria-live="polite"
      aria-busy="true"
      aria-label={busy.label}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl p-5">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-400 shrink-0" />
          <div className="min-w-0">
            <p className="font-bold text-sm">{busy.label}</p>
            {busy.detail && (
              <p className="text-[11px] text-slate-400 truncate mt-0.5" title={busy.detail}>{busy.detail}</p>
            )}
          </div>
          {percent != null && (
            <span className="ml-auto text-xs font-mono font-bold text-indigo-300">{percent}%</span>
          )}
        </div>
        <div className="mt-4 h-2 rounded-full bg-slate-800 overflow-hidden">
          {percent != null ? (
            <div className="h-full bg-indigo-500 transition-all duration-150" style={{ width: `${percent}%` }} />
          ) : (
            <div className="h-full w-1/3 bg-indigo-500 animate-pulse" />
          )}
        </div>
        {hasNumbers && (
          <p className="mt-2 text-[11px] font-mono text-slate-400">
            {busy.current} / {busy.total}
          </p>
        )}
      </div>
    </div>
  );
}
