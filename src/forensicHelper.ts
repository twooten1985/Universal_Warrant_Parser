/**
 * Forensic Helper Utilities for Media Classification
 * Runs entirely client-side, 100% offline.
 */

import ExifReader from 'exifreader';

/**
 * Calculates MD5 hash of raw file bytes (matches standard RFC 1321).
 */
export function calculateMD5(bytes: Uint8Array): string {
  const safeAdd = (x: number, y: number) => {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  };
  
  const bitRoll = (num: number, cnt: number) => (num << cnt) | (num >>> (32 - cnt));
  
  const md5cmn = (q: number, a: number, b: number, x: number, s: number, t: number) =>
    safeAdd(bitRoll(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  
  const md5ff = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    md5cmn((b & c) | (~b & d), a, b, x, s, t);
  const md5gg = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    md5cmn((b & d) | (c & ~d), a, b, x, s, t);
  const md5hh = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    md5cmn(b ^ c ^ d, a, b, x, s, t);
  const md5ii = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    md5cmn(c ^ (b | ~d), a, b, x, s, t);

  const len = bytes.length;
  const words: number[] = [];
  for (let i = 0; i < len * 8; i += 8) {
    words[i >> 5] |= (bytes[i / 8] & 0xff) << (i % 32);
  }
  
  words[len >> 2] |= 0x80 << ((len % 4) * 8);
  const wordCount = (((len + 8) >> 6) + 1) * 16;
  words[wordCount - 2] = len * 8;
  
  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;

  for (let i = 0; i < wordCount; i += 16) {
    const olda = a;
    const oldb = b;
    const oldc = c;
    const oldd = d;

    a = md5ff(a, b, c, d, words[i + 0] || 0, 7, -680876936);
    d = md5ff(d, a, b, c, words[i + 1] || 0, 12, -389564586);
    c = md5ff(c, d, a, b, words[i + 2] || 0, 17, 606105819);
    b = md5ff(b, c, d, a, words[i + 3] || 0, 22, -1044525330);
    a = md5ff(a, b, c, d, words[i + 4] || 0, 7, -176418897);
    d = md5ff(d, a, b, c, words[i + 5] || 0, 12, 1200080426);
    c = md5ff(c, d, a, b, words[i + 6] || 0, 17, -1473231341);
    b = md5ff(b, c, d, a, words[i + 7] || 0, 22, -45705983);
    a = md5ff(a, b, c, d, words[i + 8] || 0, 7, 1770035416);
    d = md5ff(d, a, b, c, words[i + 9] || 0, 12, -1958414417);
    c = md5ff(c, d, a, b, words[i + 10] || 0, 17, -42063);
    b = md5ff(b, c, d, a, words[i + 11] || 0, 22, -1990404162);
    a = md5ff(a, b, c, d, words[i + 12] || 0, 7, 1804603682);
    d = md5ff(d, a, b, c, words[i + 13] || 0, 12, -40341101);
    c = md5ff(c, d, a, b, words[i + 14] || 0, 17, -1502002290);
    b = md5ff(b, c, d, a, words[i + 15] || 0, 22, 1236535329);

    a = md5gg(a, b, c, d, words[i + 1] || 0, 5, -165796510);
    d = md5gg(d, a, b, c, words[i + 6] || 0, 9, -1069501632);
    c = md5gg(c, d, a, b, words[i + 11] || 0, 14, 643717713);
    b = md5gg(b, c, d, a, words[i + 0] || 0, 20, -373897302);
    a = md5gg(a, b, c, d, words[i + 5] || 0, 5, -701558691);
    d = md5gg(d, a, b, c, words[i + 10] || 0, 9, 38016083);
    c = md5gg(c, d, a, b, words[i + 15] || 0, 14, -660478335);
    b = md5gg(b, c, d, a, words[i + 4] || 0, 20, -405537848);
    a = md5gg(a, b, c, d, words[i + 9] || 0, 5, 568446438);
    d = md5gg(d, a, b, c, words[i + 14] || 0, 9, -1019803690);
    c = md5gg(c, d, a, b, words[i + 3] || 0, 14, -187363961);
    b = md5gg(b, c, d, a, words[i + 8] || 0, 20, 1163531501);
    a = md5gg(a, b, c, d, words[i + 13] || 0, 5, -1444681467);
    d = md5gg(d, a, b, c, words[i + 2] || 0, 9, -51403784);
    c = md5gg(c, d, a, b, words[i + 7] || 0, 14, 1735328473);
    b = md5gg(b, c, d, a, words[i + 12] || 0, 20, -1926607734);

    a = md5hh(a, b, c, d, words[i + 5] || 0, 4, -378558);
    d = md5hh(d, a, b, c, words[i + 8] || 0, 11, -2022574463);
    c = md5hh(c, d, a, b, words[i + 11] || 0, 16, 1839030562);
    b = md5hh(b, c, d, a, words[i + 14] || 0, 23, -35309556);
    a = md5hh(a, b, c, d, words[i + 1] || 0, 4, -1530992060);
    d = md5hh(d, a, b, c, words[i + 4] || 0, 11, 1272893353);
    c = md5hh(c, d, a, b, words[i + 7] || 0, 16, -155497632);
    b = md5hh(b, c, d, a, words[i + 10] || 0, 23, -1094730640);
    a = md5hh(a, b, c, d, words[i + 13] || 0, 4, 681279174);
    d = md5hh(d, a, b, c, words[i + 0] || 0, 11, -358537222);
    c = md5hh(c, d, a, b, words[i + 3] || 0, 16, -722521979);
    b = md5hh(b, c, d, a, words[i + 6] || 0, 23, 76029189);
    a = md5hh(a, b, c, d, words[i + 9] || 0, 4, -640364487);
    d = md5hh(d, a, b, c, words[i + 12] || 0, 11, -421815835);
    c = md5hh(c, d, a, b, words[i + 15] || 0, 16, 530742520);
    b = md5hh(b, c, d, a, words[i + 2] || 0, 23, -995338651);

    a = md5ii(a, b, c, d, words[i + 0] || 0, 6, -198630844);
    d = md5ii(d, a, b, c, words[i + 7] || 0, 10, 1126891415);
    c = md5ii(c, d, a, b, words[i + 14] || 0, 15, -1416354905);
    b = md5ii(b, c, d, a, words[i + 5] || 0, 21, -57434055);
    a = md5ii(a, b, c, d, words[i + 12] || 0, 6, 1700485571);
    d = md5ii(d, a, b, c, words[i + 3] || 0, 10, -1894986606);
    c = md5ii(c, d, a, b, words[i + 10] || 0, 15, -1050366);
    b = md5ii(b, c, d, a, words[i + 1] || 0, 21, -2054922799);
    a = md5ii(a, b, c, d, words[i + 8] || 0, 6, 1873313359);
    d = md5ii(d, a, b, c, words[i + 15] || 0, 10, -30611744);
    c = md5ii(c, d, a, b, words[i + 6] || 0, 15, -1560198380);
    b = md5ii(b, c, d, a, words[i + 13] || 0, 21, 1309151649);
    a = md5ii(a, b, c, d, words[i + 4] || 0, 6, -145523070);
    d = md5ii(d, a, b, c, words[i + 11] || 0, 10, -1120210379);
    c = md5ii(c, d, a, b, words[i + 2] || 0, 15, 718595305);
    b = md5ii(b, c, d, a, words[i + 9] || 0, 21, -343485551);

    a = safeAdd(a, olda);
    b = safeAdd(b, oldb);
    c = safeAdd(c, oldc);
    d = safeAdd(d, oldd);
  }

  const toHex = (n: number) => {
    let s = '';
    for (let i = 0; i < 4; i++) {
      s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
    }
    return s;
  };
  return toHex(a) + toHex(b) + toHex(c) + toHex(d);
}

/**
 * Parses pixels in HSV/YCbCr space to count skin color density.
 * Resizes the image to 64x64 to guarantee sub-millisecond execution times.
 */
export function analyzeSkinTone(imageUrl: string): Promise<number> {
  if (!imageUrl) return Promise.resolve(0);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finish(0);
          return;
        }
        
        const size = 64;
        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(img, 0, 0, size, size);
        
        const imgData = ctx.getImageData(0, 0, size, size);
        const data = imgData.data;
        let skinPixels = 0;
        const totalPixels = size * size;
        
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i+1];
          const b = data[i+2];
          
          // Convert to YCbCr color space
          const cb = 128 - (0.168736 * r) - (0.331264 * g) + (0.5 * b);
          const cr = 128 + (0.5 * r) - (0.418688 * g) - (0.081312 * b);
          
          // Peer-reviewed forensic skin bounds: Cb in [77, 127], Cr in [133, 173]
          if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) {
            skinPixels++;
          }
        }
        
        const percent = (skinPixels / totalPixels) * 100;
        finish(percent);
      } catch (err) {
        finish(0);
      }
    };
    img.onerror = () => {
      finish(0);
    };
    img.src = imageUrl;
  });
}

/**
 * Heuristically identifies screenshots based on naming conventions.
 */
export function checkIsScreenshot(fileName: string, relativePath?: string): boolean {
  const lowerName = fileName.toLowerCase();
  const lowerPath = relativePath ? relativePath.toLowerCase() : '';
  
  const hasScreenshotName = 
    lowerName.includes('screenshot') || 
    lowerName.includes('screen shot') ||
    lowerName.includes('screen_shot') ||
    lowerName.includes('capture') ||
    lowerName.includes('screen-shot') ||
    lowerName.startsWith('ss_') ||
    /ss\d+/.test(lowerName) ||
    /screenshot_\d+/.test(lowerName) ||
    lowerPath.includes('screenshot') ||
    lowerPath.includes('captured');
    
  return hasScreenshotName;
}

/**
 * Extracts GPS coordinates from JPEG EXIF metadata using the exifreader library.
 */
export function extractGPSFromExif(bytes: Uint8Array): { lat: number; lng: number } | null {
  try {
    const tags = ExifReader.load(bytes);
    if (tags && tags.GPSLatitude && tags.GPSLongitude) {
      const lat = tags.GPSLatitude.description;
      const lng = tags.GPSLongitude.description;
      if (typeof lat === 'number' && typeof lng === 'number') {
        return { lat, lng };
      }
      const latVal = Number(lat);
      const lngVal = Number(lng);
      if (!isNaN(latVal) && !isNaN(lngVal)) {
        return { lat: latVal, lng: lngVal };
      }
    }
  } catch (e) {
    // Exif data not found or unreadable
  }
  return null;
}
