import { computedHashCsv, missingHashCsv, type HashAudit, type HashInventory, type MediaDigestReport } from '../lib/hashMatchReport';

function counts(row: { total: number; md5: number; sha1: number; sha256: number }): string {
  return `${row.total.toLocaleString()} total · MD5 ${row.md5.toLocaleString()} · SHA-1 ${row.sha1.toLocaleString()} · SHA-256 ${row.sha256.toLocaleString()}`;
}

function downloadText(filename: string, body: string) {
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function HashMatchReport({
  inventory,
  report,
  audit,
}: {
  inventory: HashInventory | null;
  report: MediaDigestReport;
  audit: HashAudit | null;
}) {
  const missing = report.missingReasons.slice(0, 12);
  const uniqueLoaded = audit ? audit.uniqueLoaded : report.uniqueLoaded;
  const uniqueMatched = audit ? audit.uniqueMatched : report.uniqueMatched;
  const notFound = audit ? audit.notFound : report.notFound;
  return (
    <div className="pt-4 border-t border-slate-200 dark:border-slate-800 text-left space-y-3">
      <div>
        <h4 className="font-bold text-slate-850 dark:text-slate-100 text-sm">Hash match report</h4>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-normal">
          Unique hashes loaded from Project VIC and named sets, and how many of those values were found on a file hashed from its original bytes.
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
        Unique hashes loaded: {uniqueLoaded.toLocaleString()}. Unique hashes matched: {uniqueMatched.toLocaleString()}.
        Files hashed: {report.hashedFiles.toLocaleString()} of {report.totalFiles.toLocaleString()}.
        Not hashed: {report.notHashed.toLocaleString()}.
        Project VIC file matches: {report.vicMatched.toLocaleString()}. Named-set file matches: {report.namedSetMatched.toLocaleString()}.
      </p>
      {report.matchedBySet.length > 0 && (
        <ul className="text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
          {report.matchedBySet.map(row => (
            <li key={row.name}>{row.name}: {row.count.toLocaleString()} file{row.count === 1 ? '' : 's'}</li>
          ))}
        </ul>
      )}
      {missing.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Files not hashed</p>
          <ul className="text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5 max-h-40 overflow-y-auto">
            {missing.map(row => (
              <li key={`${row.name}-${row.reason}`}><span className="font-mono">{row.name}</span> — {row.reason}</li>
            ))}
            {report.missingReasons.length > missing.length && (
              <li>and {report.missingReasons.length - missing.length} more</li>
            )}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => downloadText('loaded-hashes-not-found.csv', missingHashCsv(notFound))}
          className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-300 dark:border-slate-600"
        >
          Download hashes not found ({notFound.length.toLocaleString()})
        </button>
        <button
          type="button"
          onClick={() => downloadText('computed-file-hashes.csv', computedHashCsv(report.computedHashes))}
          className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-300 dark:border-slate-600"
        >
          Download computed file hashes ({report.computedHashes.length.toLocaleString()})
        </button>
      </div>
    </div>
  );
}
