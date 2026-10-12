import type { HashInventory, MediaDigestReport } from '../lib/hashMatchReport';

function counts(row: { total: number; md5: number; sha1: number; sha256: number }): string {
  return `${row.total.toLocaleString()} total · MD5 ${row.md5.toLocaleString()} · SHA-1 ${row.sha1.toLocaleString()} · SHA-256 ${row.sha256.toLocaleString()}`;
}

export function HashMatchReport({
  inventory,
  report,
}: {
  inventory: HashInventory | null;
  report: MediaDigestReport;
}) {
  const missing = report.missingReasons.slice(0, 12);
  return (
    <div className="pt-4 border-t border-slate-200 dark:border-slate-800 text-left space-y-3">
      <div>
        <h4 className="font-bold text-slate-850 dark:text-slate-100 text-sm">Hash match report</h4>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-normal">
          Hashes loaded in each set, and how many media files have MD5, SHA-1, and SHA-256 computed from their bytes.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500">
            <tr>
              <th className="px-2 py-1.5 font-bold">Set</th>
              <th className="px-2 py-1.5 font-bold">Hashes</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100 dark:border-slate-800">
              <td className="px-2 py-1.5 font-bold text-slate-800 dark:text-slate-100">Project VIC</td>
              <td className="px-2 py-1.5 font-mono text-slate-600 dark:text-slate-300">{inventory ? counts(inventory.vic) : 'Loading…'}</td>
            </tr>
            {(inventory?.sets || []).map(set => (
              <tr key={set.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-2 py-1.5 text-slate-800 dark:text-slate-100">{set.name}</td>
                <td className="px-2 py-1.5 font-mono text-slate-600 dark:text-slate-300">{counts(set)}</td>
              </tr>
            ))}
            {inventory && inventory.sets.length === 0 && (
              <tr className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-2 py-1.5 text-slate-400" colSpan={2}>No named hash sets are loaded.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-700 dark:text-slate-200 leading-relaxed">
        Media files: {report.mediaFiles.toLocaleString()}. Digests computed: {report.computed.toLocaleString()}. Not computed: {report.missing.toLocaleString()}. Project VIC matches: {report.vicMatched.toLocaleString()}. Named-set matches: {report.namedSetMatched.toLocaleString()}.
      </p>
      {report.matchedBySet.length > 0 && (
        <ul className="text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
          {report.matchedBySet.map(row => (
            <li key={row.name}>{row.name}: {row.count.toLocaleString()} file{row.count === 1 ? '' : 's'}</li>
          ))}
        </ul>
      )}
      {missing.length > 0 && (
        <ul className="text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5 max-h-40 overflow-y-auto">
          {missing.map(row => (
            <li key={row.name}><span className="font-mono">{row.name}</span> — {row.reason}</li>
          ))}
          {report.missingReasons.length > missing.length && (
            <li>and {report.missingReasons.length - missing.length} more</li>
          )}
        </ul>
      )}
    </div>
  );
}
