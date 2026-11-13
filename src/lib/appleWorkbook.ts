/**
 * Server-only: read an Apple .xlsx in memory (no derived files written) and parse each sheet
 * with the Apple table parser. Used by the plain Folder import.
 */
import path from 'path';
import { pushAll } from './safeArray'; /*uwrp-b13*/
import { createRequire } from 'module';
import { parseAppleFile } from './appleParsers';
import type { ParseResult } from '../types';

function loadAppleCore(): any {
  const req: any = typeof require !== 'undefined' ? require : createRequire(path.join(process.cwd(), 'server.ts'));
  const bases = [typeof __dirname !== 'undefined' ? path.join(__dirname, '..') : '', process.env.UWRP_ROOT || '', process.cwd()].filter(Boolean);
  let last: unknown;
  for (const b of bases) { try { return req(path.join(b, 'electron', 'apple', 'core.cjs')); } catch (e) { last = e; } }
  throw last;
}

const cell = (v: unknown) => { const t = v == null ? '' : String(v); return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };

export async function parseAppleWorkbook(name: string, sourcePath: string, relativePath?: string): Promise<ParseResult> {
  const core = loadAppleCore();
  const sheets: Array<{ name: string; rows: string[][] }> = await core.readXlsx(sourcePath);
  const merged: ParseResult = { provider: 'apple', events: [], accountInfo: undefined, summaryStats: { totalEvents: 0, messagesCount: 0, connectionsCount: 0, filesCount: 0, callsCount: 0, uniqueIPs: [], dateRange: null } };
  for (const sh of sheets) {
    const { preamble, header, data } = core.splitPreamble(sh.rows);
    const lines = [...preamble.map((l: string) => '# ' + l.replace(/[\r\n]+/g, ' ')), '# Sheet: ' + sh.name, '# Source: ' + name];
    if (header.length) lines.push(header.map(cell).join(','));
    for (const r of data) lines.push(r.map(cell).join(','));
    const r = parseAppleFile(name.replace(/\.xlsx$/i, '') + '__' + sh.name + '.csv', lines.join('\n'), relativePath);
    for (const e of r.events) e.sourceFile = name;
    pushAll(merged.events, r.events);
    merged.accountInfo = merged.accountInfo || r.accountInfo;
    const st = r.summaryStats, m = merged.summaryStats;
    m.totalEvents += st.totalEvents; m.messagesCount += st.messagesCount; m.connectionsCount += st.connectionsCount; m.filesCount += st.filesCount; m.callsCount += st.callsCount;
    m.uniqueIPs = [...new Set([...m.uniqueIPs, ...st.uniqueIPs])];
    if (st.dateRange) m.dateRange = !m.dateRange ? st.dateRange : { start: st.dateRange.start < m.dateRange.start ? st.dateRange.start : m.dateRange.start, end: st.dateRange.end > m.dateRange.end ? st.dateRange.end : m.dateRange.end };
  }
  return merged;
}
