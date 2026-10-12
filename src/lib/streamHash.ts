/**
 * MD5, SHA-1, and SHA-256 of a file's bytes. The read is streamed, so a
 * multi-gigabyte video is not loaded into one buffer.
 */
import crypto from 'crypto';
import fs from 'fs';

export interface FileDigests {
  md5: string;
  sha1: string;
  sha256: string;
}

export function hashBuffer(bytes: Buffer | Uint8Array): FileDigests {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return {
    md5: crypto.createHash('md5').update(data).digest('hex'),
    sha1: crypto.createHash('sha1').update(data).digest('hex'),
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
  };
}

export function hashFileStream(filePath: string): Promise<FileDigests> {
  return new Promise((resolve, reject) => {
    const md5 = crypto.createHash('md5');
    const sha1 = crypto.createHash('sha1');
    const sha256 = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => {
      md5.update(chunk);
      sha1.update(chunk);
      sha256.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      resolve({
        md5: md5.digest('hex'),
        sha1: sha1.digest('hex'),
        sha256: sha256.digest('hex'),
      });
    });
  });
}
