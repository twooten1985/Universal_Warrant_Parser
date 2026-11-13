/**
 * uwrp-b13: array helpers that never spread a large array into function
 * arguments (V8 throws "Maximum call stack size exceeded" past ~100k args).
 */
export function minMax(values: ArrayLike<number>): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** target.push(...source) without the argument spread. Returns target. */
export function pushAll<T>(target: T[], source: ArrayLike<T> | Iterable<T>): T[] {
  if (Array.isArray(source) || (source as ArrayLike<T>).length !== undefined) {
    const s = source as ArrayLike<T>;
    for (let i = 0; i < s.length; i++) target.push(s[i]);
  } else {
    for (const v of source as Iterable<T>) target.push(v);
  }
  return target;
}

/** Bytes to a binary string in small chunks. */
export function bytesToBinaryString(bytes: Uint8Array, chunk = 0x2000): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return out;
}
