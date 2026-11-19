/**
 * Download the official GnuPG Windows simple installer, check a pinned SHA-256,
 * and copy its bin directory into resources/gpg.
 *
 * The app spawns gpg.exe and gpgconf.exe from that folder. Those two programs
 * need the sibling DLLs and gpg-agent.exe, so the whole bin set is copied
 * except the installer's *.tmp duplicates. The binaries are not committed.
 *
 * Pinned build: gnupg-w32-2.4.8_20250514.exe
 * https://gnupg.org/ftp/gcrypt/binary/gnupg-w32-2.4.8_20250514.exe
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'https://gnupg.org/ftp/gcrypt/binary/gnupg-w32-2.4.8_20250514.exe';
const SHA256 = '2cd239a8301c59da3737f44566c8c6f9c1779a148af3561e77fb866a0a90de4e';
const dest = path.join(root, 'resources', 'gpg');

const NEEDED = ['gpg.exe', 'gpgconf.exe', 'gpg-agent.exe', 'libgpg-error-0.dll', 'libgcrypt-20.dll', 'libassuan-9.dll'];

function sevenZip() {
  try {
    const mod = require('7zip-bin');
    if (mod.path7za && fs.existsSync(mod.path7za)) return mod.path7za;
  } catch { /* optional until npm ci */ }
  const candidates = [
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files\\7-Zip\\7za.exe',
  ];
  for (const item of candidates) if (fs.existsSync(item)) return item;
  return '7z';
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf;
}

function extract(archive, outDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(sevenZip(), ['x', archive, `bin/*`, `-o${outDir}`, '-y'], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`7-Zip exited ${code}`)));
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-gpg-'));
const exe = path.join(tmp, 'gnupg-w32.exe');
const unpacked = path.join(tmp, 'unpacked');
fs.mkdirSync(unpacked, { recursive: true });
const bytes = await download(URL, exe);
const hash = createHash('sha256').update(bytes).digest('hex');
if (hash !== SHA256) {
  throw new Error(`GnuPG SHA-256 mismatch.\n expected ${SHA256}\n actual   ${hash}`);
}
await extract(exe, unpacked);
const bin = path.join(unpacked, 'bin');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const name of fs.readdirSync(bin)) {
  if (name.endsWith('.tmp')) continue;
  fs.copyFileSync(path.join(bin, name), path.join(dest, name));
}
const copied = fs.readdirSync(dest);
for (const name of NEEDED) {
  if (!copied.includes(name)) throw new Error(`resources/gpg is missing ${name}`);
}
console.log(`resources/gpg has ${copied.length} files from GnuPG 2.4.8 (${hash})`);
