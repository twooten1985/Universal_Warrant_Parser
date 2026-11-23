/**
 * Read words from a PDF content stream, including FlateDecode streams.
 * Text is grouped by its position so a table cell stays with the cell beside it.
 * The inflate function is supplied by the caller so this file does not import Node zlib.
 */

export interface PdfTextRun {
  text: string;
  x: number;
  y: number;
  page: number;
  width: number;
}

export function extractPositionedPdfText(
  bytes: Uint8Array,
  inflate: (data: Uint8Array) => Uint8Array,
): { text: string; runs: PdfTextRun[] } {
  const latin = Buffer.from(bytes).toString('latin1');
  const runs: PdfTextRun[] = [];
  let page = 0;
  let cursor = 0;
  while (cursor < latin.length) {
    const pageAt = nextPageMark(latin, cursor);
    const streamAt = nextStream(latin, cursor);
    if (pageAt < 0 && streamAt < 0) break;
    if (pageAt >= 0 && (streamAt < 0 || pageAt < streamAt)) {
      page += 1;
      cursor = pageAt + 10;
      continue;
    }
    const found = readStream(latin, streamAt);
    if (!found) break;
    cursor = found.end;
    const body = decodeStream(found.dict, found.raw, inflate);
    if (!body) continue;
    runs.push(...textRunsFromContent(body, Math.max(page, 1)));
  }
  const text = linesFromRuns(runs);
  if (text.trim()) return { text, runs };
  const loose = looseLiteralText(latin);
  return { text: loose, runs };
}

function nextPageMark(latin: string, from: number): number {
  const re = /\/Type\s*\/Page(?!s)\b/g;
  re.lastIndex = from;
  const match = re.exec(latin);
  return match ? match.index : -1;
}

function nextStream(latin: string, from: number): number {
  let at = from;
  while (at < latin.length) {
    const found = latin.indexOf('stream', at);
    if (found < 0) return -1;
    const prev = found === 0 ? ' ' : latin[found - 1];
    const next = latin[found + 6] || ' ';
    if (/\s/.test(prev) && /\s/.test(next)) return found;
    at = found + 6;
  }
  return -1;
}

function readStream(latin: string, at: number): { dict: string; raw: string; end: number } | null {
  let start = at + 6;
  if (latin[start] === '\r') start += 1;
  if (latin[start] === '\n') start += 1;
  const end = latin.indexOf('endstream', start);
  if (end < 0) return null;
  const dictStart = latin.lastIndexOf('<<', at);
  const dict = dictStart >= 0 ? latin.slice(dictStart, at) : '';
  let raw = latin.slice(start, end);
  const length = dict.match(/\/Length\s+(\d+)/);
  if (length) {
    const n = Number(length[1]);
    if (n >= 0 && n <= raw.length) raw = raw.slice(0, n);
  }
  return { dict, raw, end: end + 'endstream'.length };
}

function decodeStream(dict: string, raw: string, inflate: (data: Uint8Array) => Uint8Array): string {
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
  if (/\/FlateDecode\b/.test(dict)) {
    try {
      const inflated = inflate(bytes);
      return Buffer.from(inflated).toString('latin1');
    } catch {
      return '';
    }
  }
  if (/\/Filter\b/.test(dict)) return '';
  return raw;
}

type Tok =
  | { k: 'str'; v: string }
  | { k: 'num'; v: number }
  | { k: 'arr'; v: Array<{ k: 'str'; v: string } | { k: 'num'; v: number }> }
  | { k: 'op'; v: string }
  | { k: 'name'; v: string };

function textRunsFromContent(content: string, page: number): PdfTextRun[] {
  const tokens = tokenizeContent(content);
  const runs: PdfTextRun[] = [];
  let i = 0;
  let inText = false;
  let x = 0;
  let y = 0;
  let fontSize = 12;
  let leading = 14;
  const operands: Tok[] = [];
  const flush = () => { operands.length = 0; };
  const nums = () => operands.filter((item): item is { k: 'num'; v: number } => item.k === 'num').map(item => item.v);
  while (i < tokens.length) {
    const token = tokens[i];
    i += 1;
    if (token.k === 'op' && token.v === 'BT') { inText = true; flush(); continue; }
    if (token.k === 'op' && token.v === 'ET') { inText = false; flush(); continue; }
    if (token.k !== 'op') { operands.push(token); continue; }
    const op = token.v;
    if (!inText && op !== 'Tj' && op !== 'TJ' && op !== "'" && op !== '"') { flush(); continue; }
    if (op === 'Tf') {
      const values = nums();
      const size = values[values.length - 1];
      if (Number.isFinite(size) && size > 0) fontSize = size;
    } else if (op === 'TL') {
      const size = nums()[0];
      if (Number.isFinite(size)) leading = size;
    } else if (op === 'Tm') {
      const values = nums();
      if (values.length >= 6) {
        x = values[4] || 0;
        y = values[5] || 0;
      }
    } else if (op === 'Td' || op === 'TD') {
      const values = nums();
      if (values.length >= 2) {
        x += values[0] || 0;
        y += values[1] || 0;
        if (op === 'TD') leading = Math.abs(values[1] || leading);
      }
    } else if (op === 'T*') {
      y -= leading;
    } else if (op === 'Tj' || op === "'" || op === '"') {
      if (op === "'" || op === '"') y -= leading;
      const text = [...operands].reverse().find((item): item is { k: 'str'; v: string } => item.k === 'str')?.v || '';
      if (text) {
        const width = Math.max(text.length * fontSize * 0.45, fontSize * 0.3);
        runs.push({ text, x, y, page, width });
        x += width;
      }
    } else if (op === 'TJ') {
      const arr = operands.find((item): item is { k: 'arr'; v: Array<{ k: 'str'; v: string } | { k: 'num'; v: number }> } => item.k === 'arr');
      if (arr) {
        let piece = '';
        let startX = x;
        for (let n = 0; n < arr.v.length; n++) {
          const part = arr.v[n];
          if (part.k === 'str') {
            if (!piece) startX = x;
            piece += part.v;
            x += part.v.length * fontSize * 0.45;
          } else if (part.v < -80 && piece) {
            runs.push({ text: piece, x: startX, y, page, width: Math.max(x - startX, 1) });
            piece = '';
            x += -(part.v / 1000) * fontSize;
          } else {
            x += -(part.v / 1000) * fontSize;
          }
        }
        if (piece) runs.push({ text: piece, x: startX, y, page, width: Math.max(x - startX, 1) });
      }
    }
    flush();
  }
  return runs;
}

function tokenizeContent(content: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const pushString = (text: string) => out.push({ k: 'str', v: text });
  while (i < content.length) {
    const ch = content[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '%') {
      while (i < content.length && content[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '(') {
      const read = readLiteral(content, i);
      pushString(read.text);
      i = read.next;
      continue;
    }
    if (ch === '<') {
      if (content[i + 1] === '<') { i += 2; continue; }
      const end = content.indexOf('>', i + 1);
      if (end < 0) break;
      pushString(decodeHex(content.slice(i + 1, end)));
      i = end + 1;
      continue;
    }
    if (ch === '>') { i += 1; continue; }
    if (ch === '[') {
      const inner: Array<{ k: 'str'; v: string } | { k: 'num'; v: number }> = [];
      i += 1;
      while (i < content.length && content[i] !== ']') {
        if (/\s/.test(content[i])) { i += 1; continue; }
        if (content[i] === '(') {
          const read = readLiteral(content, i);
          inner.push({ k: 'str', v: read.text });
          i = read.next;
          continue;
        }
        if (content[i] === '<') {
          const end = content.indexOf('>', i + 1);
          if (end < 0) break;
          inner.push({ k: 'str', v: decodeHex(content.slice(i + 1, end)) });
          i = end + 1;
          continue;
        }
        const num = content.slice(i).match(/^[+-]?(?:\d+\.\d+|\d+\.|\.\d+|\d+)/);
        if (num) { inner.push({ k: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
        i += 1;
      }
      out.push({ k: 'arr', v: inner });
      if (content[i] === ']') i += 1;
      continue;
    }
    if (ch === ']') { i += 1; continue; }
    const num = content.slice(i).match(/^[+-]?(?:\d+\.\d+|\d+\.|\.\d+|\d+)/);
    if (num) { out.push({ k: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    if (ch === '/') {
      const name = content.slice(i).match(/^\/[A-Za-z0-9_.+-]+/);
      if (name) { out.push({ k: 'name', v: name[0] }); i += name[0].length; continue; }
    }
    const word = content.slice(i).match(/^[A-Za-z*'"\\]+/);
    if (word) { out.push({ k: 'op', v: word[0] }); i += word[0].length; continue; }
    i += 1;
  }
  return out;
}

function readLiteral(content: string, start: number): { text: string; next: number } {
  let i = start + 1;
  let text = '';
  while (i < content.length) {
    const ch = content[i];
    if (ch === '\\') {
      const n = content[i + 1] || '';
      if (n === 'n') text += '\n';
      else if (n === 'r') text += '\r';
      else if (n === 't') text += '\t';
      else if (n === '(' || n === ')' || n === '\\') text += n;
      else if (/[0-7]/.test(n)) {
        const oct = content.slice(i + 1, i + 4).match(/^[0-7]{1,3}/);
        if (oct) { text += String.fromCharCode(parseInt(oct[0], 8)); i += oct[0].length + 1; continue; }
      } else text += n;
      i += 2;
      continue;
    }
    if (ch === ')') return { text, next: i + 1 };
    text += ch;
    i += 1;
  }
  return { text, next: i };
}

function decodeHex(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (Number.isNaN(code)) continue;
    if (code === 10 || code === 13) out += '\n';
    else if (code >= 32 && code <= 126) out += String.fromCharCode(code);
  }
  return out;
}

function linesFromRuns(runs: PdfTextRun[]): string {
  const sorted = [...runs].filter(run => run.text.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: string[] = [];
  let current = '';
  let last: PdfTextRun | null = null;
  let endX = 0;
  for (let i = 0; i < sorted.length; i++) {
    const run = sorted[i];
    const newLine = !last || run.page !== last.page || Math.abs(run.y - last.y) > 2.5;
    if (newLine) {
      if (current.trim()) lines.push(current.trim());
      current = run.text;
      endX = run.x + run.width;
    } else {
      const gap = run.x - endX;
      if (gap > 10) current += ' | ';
      else if (gap > 1.2 && !current.endsWith(' ') && !run.text.startsWith(' ')) current += ' ';
      current += run.text;
      endX = Math.max(endX, run.x + run.width);
    }
    last = run;
  }
  if (current.trim()) lines.push(current.trim());
  return lines.join('\n');
}

function looseLiteralText(latin: string): string {
  const chunks: string[] = [];
  const re = /\((?:\\.|[^\\)]){1,500}\)/g;
  let match: RegExpExecArray | null;
  let guard = 0;
  while ((match = re.exec(latin)) !== null) {
    if (++guard > 20000) break;
    const read = readLiteral(match[0], 0);
    if (/[\x20-\x7E]{2,}/.test(read.text)) chunks.push(read.text.replace(/\s+/g, ' ').trim());
  }
  return chunks.join('\n');
}
