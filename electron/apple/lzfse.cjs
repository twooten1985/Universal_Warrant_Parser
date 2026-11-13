'use strict';
// Pure-JS LZFSE / LZVN decoder (Apple "bvx" streams: bvx- raw, bvxn LZVN, bvx1/bvx2 LZFSE, bvx$ end).
// Port of the reference decoder (github.com/lzfse/lzfse, BSD-3, (c) Apple Inc.). Decode only; output kept in memory.
const L_SYM = 20, M_SYM = 20, D_SYM = 64, LIT_SYM = 256, L_ST = 64, M_ST = 64, D_ST = 256, LIT_ST = 1024;
const L_XB = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,3,5,8], L_BASE = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,20,28,60];
const M_XB = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,5,8,11], M_BASE = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,24,56,312];
const D_XB = [0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,6,6,6,6,7,7,7,7,8,8,8,8,9,9,9,9,10,10,10,10,11,11,11,11,12,12,12,12,13,13,13,13,14,14,14,14,15,15,15,15];
const D_BASE = [0,1,2,3,4,6,8,10,12,16,20,24,28,36,44,52,60,76,92,108,124,156,188,220,252,316,380,444,508,636,764,892,1020,1276,1532,1788,2044,2556,3068,3580,4092,5116,6140,7164,8188,10236,12284,14332,16380,20476,24572,28668,32764,40956,49148,57340,65532,81916,98300,114684,131068,163836,196604,229372];
const MAGIC = { EOS: 0x24787662, RAW: 0x2d787662, V1: 0x31787662, V2: 0x32787662, VN: 0x6e787662 };
const clz32 = Math.clz32;
class Out { constructor(n) { this.b = Buffer.allocUnsafe(Math.max(1024, n)); this.n = 0; }
  need(k) { if (this.n + k > this.b.length) { const nb = Buffer.allocUnsafe(Math.max(this.b.length * 2, this.n + k)); this.b.copy(nb, 0, 0, this.n); this.b = nb; } }
  result() { return this.b.subarray(0, this.n); } }
function fail(m) { throw new Error('LZFSE: ' + m); }
function decTable(nstates, freq) { // literal decoder: per state {k, sym, delta}
  const K = new Int8Array(nstates), S = new Uint8Array(nstates), DL = new Int32Array(nstates); const nclz = clz32(nstates); let t = 0, sum = 0;
  for (let i = 0; i < freq.length; i++) { const f = freq[i]; if (!f) continue; sum += f; if (sum > nstates) fail('bad freq');
    const k = clz32(f) - nclz, j0 = ((2 * nstates) >> k) - f;
    for (let j = 0; j < f; j++, t++) { S[t] = i; if (j < j0) { K[t] = k; DL[t] = ((f + j) << k) - nstates; } else { K[t] = k - 1; DL[t] = (j - j0) << (k - 1); } } }
  return { K, S, DL };
}
function valTable(nstates, freq, xb, base) {
  const TB = new Uint8Array(nstates), VB = new Uint8Array(nstates), DL = new Int32Array(nstates), BS = new Int32Array(nstates); const nclz = clz32(nstates); let t = 0, sum = 0;
  for (let i = 0; i < freq.length; i++) { const f = freq[i]; if (!f) continue; sum += f; if (sum > nstates) fail('bad freq');
    const k = clz32(f) - nclz, j0 = ((2 * nstates) >> k) - f;
    for (let j = 0; j < f; j++, t++) { VB[t] = xb[i]; BS[t] = base[i];
      if (j < j0) { TB[t] = k + xb[i]; DL[t] = ((f + j) << k) - nstates; } else { TB[t] = k - 1 + xb[i]; DL[t] = (j - j0) << (k - 1); } } }
  return { TB, VB, DL, BS };
}
// 32-bit backward bit stream (FSE_IOSTREAM_64 == 0 variant); accum kept as an unsigned JS number < 2^32
class InStream {
  constructor(src, nbits, end, start) { // reads backwards from `end`, not below `start`
    this.src = src; this.start = start; let p = end;
    if (nbits) { if (p < start + 4) fail('range'); p -= 4; this.accum = src.readUInt32LE(p); this.nb = nbits + 32; }
    else { if (p < start + 3) fail('range'); p -= 3; this.accum = src[p] | (src[p + 1] << 8) | (src[p + 2] << 16); this.nb = 24; }
    this.p = p; if (this.nb < 24 || this.nb >= 32 || (this.nb < 32 && Math.floor(this.accum / 2 ** this.nb) !== 0)) fail('stream init');
  }
  flush() { const n = (31 - this.nb) & -8; if (n > 0) { const p = this.p - (n >> 3); if (p < this.start) fail('range'); this.p = p;
      let inc = 0; for (let i = 0; i < 4; i++) inc += (this.src[p + i] || 0) * 2 ** (8 * i); inc = inc % 2 ** n;
      this.accum = (this.accum % 2 ** (32 - n)) * 2 ** n + inc; this.nb += n; } }
  pull(n) { this.nb -= n; const r = Math.floor(this.accum / 2 ** this.nb); this.accum = this.accum % 2 ** this.nb; return r; }
}
function readFreqV2(src, off, end, total) { // compressed frequency tables
  const out = new Uint16Array(total); let accum = 0, nb = 0, p = off;
  const NB = [2,3,2,5,2,3,2,8,2,3,2,5,2,3,2,14,2,3,2,5,2,3,2,8,2,3,2,5,2,3,2,14], VAL = [0,2,1,4,0,3,1,-1,0,2,1,5,0,3,1,-1,0,2,1,6,0,3,1,-1,0,2,1,7,0,3,1,-1];
  if (p === end) return out;
  for (let i = 0; i < total; i++) {
    while (p < end && nb + 8 <= 32) { accum += src[p] * 2 ** nb; nb += 8; p++; }
    const b = accum % 32, n = NB[b]; let v;
    if (n === 8) v = 8 + (Math.floor(accum / 16) % 16); else if (n === 14) v = 24 + (Math.floor(accum / 16) % 1024); else v = VAL[b];
    if (n > nb) fail('freq'); out[i] = v; accum = Math.floor(accum / 2 ** n); nb -= n;
  }
  if (nb >= 8 || p !== end) fail('freq end');
  return out;
}
const bits = (lo, hi, off, n) => { // field from a 64-bit little-endian value given as two uint32 halves
  const v = BigInt(lo) | (BigInt(hi) << 32n); return Number((v >> BigInt(off)) & ((1n << BigInt(n)) - 1n)); };
function lzfseBlock(src, pos, magic, out) {
  let h; let hsize;
  if (magic === MAGIC.V2) {
    const r = i => src.readUInt32LE(pos + 8 + i * 4); const v0l = r(0), v0h = r(1), v1l = r(2), v1h = r(3), v2l = r(4), v2h = r(5);
    hsize = v2l; if (pos + hsize > src.length) fail('truncated header');
    h = { nraw: src.readUInt32LE(pos + 4), nLit: bits(v0l, v0h, 0, 20), nLitPay: bits(v0l, v0h, 20, 20), nMatch: bits(v0l, v0h, 40, 20), litBits: bits(v0l, v0h, 60, 3) - 7,
      litState: [bits(v1l, v1h, 0, 10), bits(v1l, v1h, 10, 10), bits(v1l, v1h, 20, 10), bits(v1l, v1h, 30, 10)], nLmdPay: bits(v1l, v1h, 40, 20), lmdBits: bits(v1l, v1h, 60, 3) - 7,
      lS: bits(v2l, v2h, 32, 10), mS: bits(v2l, v2h, 42, 10), dS: bits(v2l, v2h, 52, 10) };
    const f = readFreqV2(src, pos + 32, pos + hsize, L_SYM + M_SYM + D_SYM + LIT_SYM); h.f = f;
  } else { // V1: uncompressed tables
    const u = i => src.readUInt32LE(pos + i * 4), s16 = o => src.readUInt16LE(pos + o); hsize = 772;
    h = { nraw: u(1), nLit: u(3), nMatch: u(4), nLitPay: u(5), nLmdPay: u(6), litBits: src.readInt32LE(pos + 28), litState: [s16(32), s16(34), s16(36), s16(38)], lmdBits: src.readInt32LE(pos + 40), lS: s16(44), mS: s16(46), dS: s16(48) };
    const f = new Uint16Array(L_SYM + M_SYM + D_SYM + LIT_SYM); for (let i = 0; i < f.length; i++) f[i] = s16(50 + 2 * i); h.f = f;
  }
  if (h.nLit > 40000 || h.nMatch > 10000 || h.nLit % 4 || h.litBits < -7 || h.litBits > 0 || h.lmdBits < -7 || h.lmdBits > 0) fail('bad block header');
  const f = h.f, lf = f.subarray(0, 20), mf = f.subarray(20, 40), df = f.subarray(40, 104), litf = f.subarray(104, 360);
  const p0 = pos + hsize; if (p0 + h.nLitPay + h.nLmdPay > src.length) fail('truncated block');
  // literals
  const lit = decTable(LIT_ST, litf); const literals = new Uint8Array(h.nLit + 64);
  { const ins = new InStream(src, h.litBits, p0 + h.nLitPay, 0); const st = h.litState.slice();
    for (let i = 0; i < h.nLit; i += 4) { for (let q = 0; q < 4; q++) { if (q % 2 === 0) ins.flush(); const s = st[q]; literals[i + q] = lit.S[s]; st[q] = lit.DL[s] + ins.pull(lit.K[s]); } } }
  // L, M, D
  const lt = valTable(L_ST, lf, L_XB, L_BASE), mt = valTable(M_ST, mf, M_XB, M_BASE), dt = valTable(D_ST, df, D_XB, D_BASE);
  const lmd0 = p0 + h.nLitPay; const ins = new InStream(src, h.lmdBits, lmd0 + h.nLmdPay, lmd0);
  let ls = h.lS, ms = h.mS, dsd = h.dS, D = -1, lp = 0; const start = out.n; out.need(h.nraw);
  const vdec = (t, s) => { const v = ins.pull(t.TB[s]); return [t.DL[s] + Math.floor(v / 2 ** t.VB[s]), t.BS[s] + (v % 2 ** t.VB[s])]; };
  for (let k = 0; k < h.nMatch; k++) {
    ins.flush(); let r = vdec(lt, ls); ls = r[0]; const L = r[1];
    ins.flush(); r = vdec(mt, ms); ms = r[0]; const M = r[1];
    ins.flush(); r = vdec(dt, dsd); dsd = r[0]; if (r[1]) D = r[1];
    if (lp + L > h.nLit + 64) fail('literal overrun');
    out.need(L + M); const b = out.b;
    for (let i = 0; i < L; i++) b[out.n++] = literals[lp++];
    if (D <= 0 || D > out.n) fail('bad distance');
    for (let i = 0; i < M; i++) { b[out.n] = b[out.n - D]; out.n++; }
  }
  if (out.n - start !== h.nraw) fail('size mismatch');
  return lmd0 + h.nLmdPay;
}
function lzvnBlock(src, pos, nraw, npay, out) {
  const end = pos + npay, start = out.n; let p = pos, D = 0; out.need(nraw);
  const lit = L => { if (p + L > end) fail('lzvn literal'); out.need(L); src.copy(out.b, out.n, p, p + L); out.n += L; p += L; };
  const match = M => { if (D <= 0 || D > out.n) fail('lzvn distance'); out.need(M); const b = out.b; for (let i = 0; i < M; i++) { b[out.n] = b[out.n - D]; out.n++; } };
  while (p < end) {
    const op = src[p];
    if (op === 6) { p += 8; break; } // eos
    if (op === 14 || op === 22) { p++; continue; } // nop
    if (op >= 0xf0) { if (op === 0xf0) { const M = src[p + 1] + 16; p += 2; match(M); } else { p++; match(op & 15); } continue; }
    if (op >= 0xe0) { if (op === 0xe0) { const L = src[p + 1] + 16; p += 2; lit(L); } else { p++; lit(op & 15); } continue; }
    if ((op >= 0x70 && op <= 0x7f) || (op >= 0xd0 && op <= 0xdf) || [30, 38, 46, 54, 62].includes(op)) fail('lzvn undefined opcode');
    let L, M;
    if (op >= 0xa0 && op <= 0xbf) { const o2 = src[p + 1] | (src[p + 2] << 8); L = (op >> 3) & 3; M = (((op & 7) << 2) | (o2 & 3)) + 3; D = o2 >> 2; p += 3; }
    else if ((op & 7) === 7) { L = op >> 6; M = ((op >> 3) & 7) + 3; D = src[p + 1] | (src[p + 2] << 8); p += 3; }
    else if ((op & 7) === 6) { L = op >> 6; M = ((op >> 3) & 7) + 3; p += 1; }
    else { L = op >> 6; M = ((op >> 3) & 7) + 3; D = ((op & 7) << 8) | src[p + 1]; p += 2; }
    lit(L); match(M);
  }
  if (out.n - start !== nraw) fail('lzvn size mismatch');
  return end;
}
/** Decode a complete LZFSE stream (Buffer) into a Buffer. Throws on malformed input. */
function decompress(src, maxOut = 512 * 1024 * 1024) {
  const out = new Out(src.length * 4); let p = 0;
  for (;;) {
    if (p + 4 > src.length) fail('truncated (no end-of-stream marker)');
    const m = src.readUInt32LE(p);
    if (m === MAGIC.EOS) return out.result();
    if (m === MAGIC.RAW) { const n = src.readUInt32LE(p + 4); if (p + 8 + n > src.length) fail('truncated raw'); out.need(n); src.copy(out.b, out.n, p + 8, p + 8 + n); out.n += n; p += 8 + n; }
    else if (m === MAGIC.VN) { const nraw = src.readUInt32LE(p + 4), npay = src.readUInt32LE(p + 8); if (p + 12 + npay > src.length) fail('truncated lzvn'); p = lzvnBlock(src, p + 12, nraw, npay, out); }
    else if (m === MAGIC.V1 || m === MAGIC.V2) p = lzfseBlock(src, p, m, out);
    else fail('unknown block magic');
    if (out.n > maxOut) fail('output too large');
  }
}
const isLzfse = b => b && b.length >= 4 && b[0] === 0x62 && b[1] === 0x76 && b[2] === 0x78 && [0x32, 0x31, 0x2d, 0x6e, 0x24].includes(b[3]);
module.exports = { decompress, isLzfse };
