import { useMemo as reactUseMemo, type DependencyList } from 'react';
/** useMemo that reports slow computations ("[uwrp-perf]" in the console / main log). Same semantics as React.useMemo. */
export function useMemoTimed<T>(fn: () => T, deps: DependencyList): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return reactUseMemo(() => { const t = performance.now(); const r = fn(); const d = performance.now() - t;
    if (d > 250) { try { console.warn('[uwrp-perf] ' + Math.round(d) + 'ms memo ' + String(fn).replace(/\s+/g, ' ').slice(0, 160)); } catch { /* ignore */ } }
    return r; }, deps);
}
