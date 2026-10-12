import { MEDIA_PAGE_SIZES } from '../lib/casePersistence';

interface MediaPagerProps {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  start: number;
  end: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  /** Noun used in the empty-state sentence. */
  noun?: string;
  showPageSize?: boolean;
}

export function MediaPager({
  page,
  pageCount,
  pageSize,
  total,
  start,
  end,
  onPage,
  onPageSize,
  noun = 'media items',
  showPageSize = true,
}: MediaPagerProps) {
  const atStart = page <= 1;
  const atEnd = page >= pageCount;
  const btn = 'px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer';

  return (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
      <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
        {total === 0 ? (
          `No ${noun} in this view`
        ) : (
          <>
            Showing <span className="font-bold">{start + 1}</span>–<span className="font-bold">{end}</span> of{' '}
            <span className="font-bold">{total.toLocaleString()}</span>
            <span className="text-slate-400"> · </span>
            Page <span className="font-bold">{page}</span> of <span className="font-bold">{pageCount}</span>
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {showPageSize && (
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
            Per page
            <select
              aria-label="Items per page"
              value={pageSize}
              onChange={(e) => onPageSize(parseInt(e.target.value, 10))}
              className="text-xs font-bold p-1.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 cursor-pointer"
            >
              {MEDIA_PAGE_SIZES.map(size => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className={btn} disabled={atStart} onClick={() => onPage(1)}>First</button>
        <button type="button" className={btn} disabled={atStart} onClick={() => onPage(page - 1)}>Prev</button>
        <button type="button" className={btn} disabled={atEnd} onClick={() => onPage(page + 1)}>Next</button>
        <button type="button" className={btn} disabled={atEnd} onClick={() => onPage(pageCount)}>Last</button>
      </div>
    </div>
  );
}
