/**
 * Synthetic Apple iCloud return: messages, HTML mail, photos, and a backup folder.
 * No case data. Run: npx tsx scripts/verify-apple-icloud.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { parseAppleFile, htmlToText } from '../src/lib/appleParsers';
import { listAppleReturn } from '../src/lib/appleListing';
import { classifyReturnName } from '../src/lib/ingestReturn';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const account = '100000001';
const messages = parseAppleFile('messages.csv', [
  'From,To,Text,Date,Service',
  'synthetic.sender@example.test,synthetic.recipient@example.test,synthetic apple message,2026-06-15 12:00:00 GMT,iMessage',
].join('\n'), `${account}-MESSAGESINICLOUD-1/${account}/messages.csv`);
assert(messages.events.length === 1, 'one iMessage row');
assert(messages.events[0].content === 'synthetic apple message', 'message text is kept');
assert(messages.events[0].sender.includes('synthetic.sender'), 'message sender is kept');
assert(messages.provider === 'apple', 'messages are an Apple parse');

const mail = parseAppleFile('note.eml', [
  'From: synthetic.sender@example.test',
  'To: synthetic.recipient@example.test',
  'Subject: synthetic subject',
  'Date: Tue, 15 Jun 2026 12:00:00 +0000',
  'MIME-Version: 1.0',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<html><body><p>synthetic <b>html mail</b></p><script>alert(1)</script></body></html>',
].join('\n'), `${account}-MAIL-1/${account}/note.eml`);
assert(mail.events[0].details?.isEmail === true, 'mail is an email');
assert(String(mail.events[0].details?.htmlBody || '').includes('<b>html mail</b>'), 'html mail is kept');
assert(htmlToText(String(mail.events[0].details?.htmlBody)).includes('html mail'), 'html mail has a text view');
assert(!htmlToText('<script>alert(1)</script><p>visible</p>').includes('alert'), 'script text is dropped from the text view');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uwrp-apple-'));
const stem = path.join(root, `${account}-CLOUDPHOTOLIBRARY-1`);
const photos = path.join(stem, account, 'photos');
fs.mkdirSync(photos, { recursive: true });
fs.writeFileSync(path.join(photos, 'synthetic.heic'), Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]));
fs.writeFileSync(path.join(photos, 'synthetic.mov'), Buffer.from('synthetic-video'));
const backup = path.join(root, `${account}-BACKUP-1`, account, 'backup');
fs.mkdirSync(backup, { recursive: true });
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Device Name</key><string>Synthetic Phone</string><key>Last Backup Date</key><date>2026-06-15T12:00:00Z</date></dict></plist>`;
fs.writeFileSync(path.join(backup, 'Manifest.plist'), plist);
fs.writeFileSync(path.join(backup, 'Info'), plist);

const listed = listAppleReturn(root, '');
const names = listed.map(entry => entry.name).sort();
assert(names.includes('synthetic.heic') && names.includes('synthetic.mov'), 'photos are listed');
assert(listed.find(entry => entry.name === 'synthetic.heic')?.mediaType === 'image', 'heic is an image');
assert(listed.find(entry => entry.name === 'synthetic.mov')?.mediaType === 'video', 'mov is a video');
assert(names.includes('Manifest.plist') && names.includes('Info'), 'manifest and extensionless plist are listed');
assert(classifyReturnName('synthetic.heic').mediaType === 'image', 'heic name is media');
assert(classifyReturnName('extensionless', fs.readFileSync(path.join(photos, 'synthetic.heic'))).isMedia === true, 'an extensionless heic header is still media');

const require = createRequire(import.meta.url);
const backupApi = require('../electron/apple/backup.cjs');
const read = backupApi.readPlist(path.join(backup, 'Info'));
assert(read && (read['Device Name'] === 'Synthetic Phone' || read.DeviceName === 'Synthetic Phone' || JSON.stringify(read).includes('Synthetic Phone')), 'an extensionless plist is readable');
const found = backupApi.findBackupDirs(root);
assert(found.some((dir: string) => dir.replace(/\\/g, '/').endsWith('/backup')), 'the backup folder is found from Manifest.plist');

console.log('apple icloud checks passed');
