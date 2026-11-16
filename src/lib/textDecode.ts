/**
 * Warrant HTML and CSV files are not always UTF-8.
 * Google productions are often UTF-16 LE with a BOM. Reading those bytes as
 * UTF-8 inserts NULs and the text looks blank.
 */

export type TextEncoding = 'utf8' | 'utf16le' | 'utf16be';

export function detectTextEncoding(buf: Buffer): TextEncoding {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf16le';
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf16be';
  const n = Math.min(buf.length, 512);
  if (n < 8) return 'utf8';
  let odd = 0;
  let even = 0;
  for (let i = 0; i < n; i++) {
    if (buf[i] !== 0) continue;
    if (i % 2 === 0) even++;
    else odd++;
  }
  if (odd + even < n / 8) return 'utf8';
  return odd >= even ? 'utf16le' : 'utf16be';
}

export function decodeTextBuffer(buf: Buffer): string {
  const enc = detectTextEncoding(buf);
  let text: string;
  if (enc === 'utf16be') {
    const swapped = Buffer.alloc(buf.length - (buf.length % 2));
    for (let i = 0; i + 1 < buf.length; i += 2) {
      swapped[i] = buf[i + 1];
      swapped[i + 1] = buf[i];
    }
    text = swapped.toString('utf16le');
  } else if (enc === 'utf16le') {
    text = buf.toString('utf16le');
  } else {
    text = buf.toString('utf8');
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}
