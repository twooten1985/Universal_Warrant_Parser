/**
 * Read cell values from an OOXML workbook (.xlsx).
 * Formulas are not executed: only the cached value is read.
 * Macros, external links, and embedded objects are ignored.
 * Uses JSZip (already in the app) and the platform XML parser.
 */

import JSZip from 'jszip';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';

export interface XlsxSheet {
  name: string;
  rows: string[][];
}

const DATE_FMT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

function xmlParser(): DOMParser {
  const existing = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (typeof existing === 'function') return new existing();
  return new XmlDOMParser() as unknown as DOMParser;
}

function localName(node: Node | null): string {
  if (!node || node.nodeType !== 1) return '';
  const el = node as Element;
  return (el.localName || el.nodeName || '').replace(/^.*:/, '');
}

function childElements(parent: Node | null, name: string): Element[] {
  if (!parent) return [];
  const out: Element[] = [];
  const nodes = parent.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    if (localName(nodes[i]) === name) out.push(nodes[i] as Element);
  }
  return out;
}

function firstChild(parent: Node | null, name: string): Element | null {
  return childElements(parent, name)[0] || null;
}

function attr(el: Element | null, name: string): string {
  if (!el) return '';
  return el.getAttribute(name) || el.getAttribute(name.toLowerCase()) || '';
}

function textContent(node: Node | null): string {
  if (!node) return '';
  return (node.textContent || '').replace(/\s+/g, ' ').trim() ? (node.textContent || '') : '';
}

function sharedStringText(si: Element): string {
  const direct = firstChild(si, 't');
  if (direct) return direct.textContent || '';
  const parts: string[] = [];
  const runs = childElements(si, 'r');
  for (let i = 0; i < runs.length; i++) {
    const t = firstChild(runs[i], 't');
    if (t?.textContent) parts.push(t.textContent);
  }
  return parts.join('');
}

function columnIndex(ref: string): number {
  const letters = (ref.match(/^[A-Za-z]+/) || [''])[0].toUpperCase();
  if (!letters) return -1;
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

function formatIsDate(numFmtId: number, code: string | undefined): boolean {
  if (DATE_FMT_IDS.has(numFmtId)) return true;
  if (!code) return false;
  const c = code.toLowerCase();
  return c.includes('yy') || c.includes('dd') || c.includes('hh') || c.includes('am/pm');
}

function excelSerialToIso(serial: number): string {
  if (!Number.isFinite(serial)) return '';
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(serial * 86400000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return String(serial);
  return d.toISOString();
}

function parseStyles(xml: string | null): boolean[] {
  if (!xml) return [];
  const doc = xmlParser().parseFromString(xml, 'application/xml');
  const custom = new Map<number, string>();
  childElements(firstChild(doc.documentElement, 'numFmts'), 'numFmt').forEach(fmt => {
    const id = Number(attr(fmt, 'numFmtId'));
    if (Number.isFinite(id)) custom.set(id, attr(fmt, 'formatCode'));
  });
  return childElements(firstChild(doc.documentElement, 'cellXfs'), 'xf').map(xf => {
    const id = Number(attr(xf, 'numFmtId') || '0');
    return formatIsDate(id, custom.get(id));
  });
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const doc = xmlParser().parseFromString(xml, 'application/xml');
  return childElements(doc.documentElement, 'si').map(sharedStringText);
}

function cellValue(cell: Element, shared: string[], dateStyles: boolean[]): string {
  const type = attr(cell, 't');
  const styleIdx = Number(attr(cell, 's') || '-1');
  const isDate = styleIdx >= 0 && dateStyles[styleIdx] === true;
  if (type === 'inlineStr') {
    const isNode = firstChild(cell, 'is');
    return isNode ? sharedStringText(isNode) : '';
  }
  const raw = (firstChild(cell, 'v')?.textContent || '').trim();
  if (type === 's') {
    const idx = Number(raw);
    return Number.isFinite(idx) && shared[idx] != null ? shared[idx] : '';
  }
  if (type === 'b') return raw === '1' ? 'true' : 'false';
  if (type === 'str') return raw;
  if ((type === '' || type === 'n') && isDate && /^-?\d+(\.\d+)?$/.test(raw)) {
    return excelSerialToIso(Number(raw));
  }
  return raw;
}

function parseSheet(xml: string, shared: string[], dateStyles: boolean[]): string[][] {
  const doc = xmlParser().parseFromString(xml, 'application/xml');
  const sheetData = firstChild(doc.documentElement, 'sheetData');
  const rows: string[][] = [];
  childElements(sheetData, 'row').forEach(rowEl => {
    const cells = childElements(rowEl, 'c');
    const row: string[] = [];
    let cursor = 0;
    for (let i = 0; i < cells.length; i++) {
      const ref = attr(cells[i], 'r');
      const idx = ref ? columnIndex(ref) : cursor;
      const at = idx >= 0 ? idx : cursor;
      while (row.length < at) row.push('');
      row[at] = cellValue(cells[i], shared, dateStyles).trim();
      cursor = at + 1;
    }
    rows.push(row);
  });
  return rows;
}

function safeZipPath(target: string): string | null {
  const cleaned = target.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('..')) return null;
  return cleaned.startsWith('xl/') ? cleaned : `xl/${cleaned}`;
}

export function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** Null when the bytes are not an xlsx workbook. */
export async function readXlsxSheets(bytes: Uint8Array): Promise<XlsxSheet[] | null> {
  if (!isZipBytes(bytes)) return null;
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return null;
  }
  const workbookFile = zip.file('xl/workbook.xml');
  if (!workbookFile) return null;
  const workbookXml = await workbookFile.async('string');
  const relsFile = zip.file('xl/_rels/workbook.xml.rels');
  const relsXml = relsFile ? await relsFile.async('string') : '';
  const stylesFile = zip.file('xl/styles.xml');
  const sharedFile = zip.file('xl/sharedStrings.xml');
  const dateStyles = parseStyles(stylesFile ? await stylesFile.async('string') : null);
  const shared = parseSharedStrings(sharedFile ? await sharedFile.async('string') : null);

  const rels = new Map<string, string>();
  if (relsXml) {
    const relDoc = xmlParser().parseFromString(relsXml, 'application/xml');
    childElements(relDoc.documentElement, 'Relationship').forEach(rel => {
      const id = attr(rel, 'Id');
      const target = safeZipPath(attr(rel, 'Target'));
      if (id && target) rels.set(id, target);
    });
  }

  const book = xmlParser().parseFromString(workbookXml, 'application/xml');
  const sheets = childElements(firstChild(book.documentElement, 'sheets'), 'sheet');
  const out: XlsxSheet[] = [];
  for (let i = 0; i < sheets.length; i++) {
    const name = attr(sheets[i], 'name') || `Sheet${i + 1}`;
    const relId = attr(sheets[i], 'id') || sheets[i].getAttribute('r:id') || '';
    const target = rels.get(relId);
    if (!target) continue;
    const sheetFile = zip.file(target);
    if (!sheetFile) continue;
    const rows = parseSheet(await sheetFile.async('string'), shared, dateStyles);
    out.push({ name, rows });
  }
  return out;
}
