/**
 * Build location fixtures and check the bounded readers.
 * Run: npx tsx scripts/verify-locations.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { readMediaLocation } from '../src/lib/mediaLocation';
import { dedupeTextHits, eventSeedsFromEvents, scanDelimitedFile, scanJsonFile, scanJsonText, scanTextFile } from '../src/lib/textLocations';
import { locationsToCsv, locationsToKml } from '../src/lib/locationExport';
import type { LocationRecord } from '../src/lib/locationRecord';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(root, 'fixtures', 'locations');
fs.mkdirSync(outDir, { recursive: true });

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

function near(actual: number | null | undefined, expected: number, tol = 0.0002): void {
  assert(actual != null && Math.abs(actual - expected) < tol, `expected ${expected} got ${actual}`);
}

function box(type: string, payload: Buffer): Buffer {
  const b = Buffer.alloc(8 + payload.length);
  b.writeUInt32BE(8 + payload.length, 0);
  b.write(type, 4, 4, 'latin1');
  payload.copy(b, 8);
  return b;
}

function buildGpsTiff(): Buffer {
  const make = 'Apple\0';
  const model = 'iPhone 13\0';
  const dt = '2020:01:02 03:04:05\0';
  const gpsDate = '2020:01:02\0';
  let dataPos = 74;
  const makeOff = dataPos; dataPos += make.length;
  const modelOff = dataPos; dataPos += model.length;
  const dtOff = dataPos; dataPos += dt.length;
  const gpsIfd = dataPos;
  dataPos += 2 + 8 * 12 + 4;
  const latOff = dataPos; dataPos += 24;
  const lngOff = dataPos; dataPos += 24;
  const altOff = dataPos; dataPos += 8;
  const timeOff = dataPos; dataPos += 24;
  const dateOff = dataPos; dataPos += gpsDate.length;
  const exifIfd = dataPos;
  dataPos += 2 + 12 + 4;
  const dtoOff = dataPos; dataPos += dt.length;
  const buf = Buffer.alloc(dataPos);
  buf.write('II', 0, 'ascii');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(8, 4);
  buf.writeUInt16LE(5, 8);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    buf.writeUInt16LE(tag, at);
    buf.writeUInt16LE(type, at + 2);
    buf.writeUInt32LE(count, at + 4);
    buf.writeUInt32LE(value, at + 8);
  };
  entry(10, 0x010f, 2, make.length, makeOff);
  entry(22, 0x0110, 2, model.length, modelOff);
  entry(34, 0x0132, 2, dt.length, dtOff);
  entry(46, 0x8769, 4, 1, exifIfd);
  entry(58, 0x8825, 4, 1, gpsIfd);
  buf.write(make, makeOff, 'ascii');
  buf.write(model, modelOff, 'ascii');
  buf.write(dt, dtOff, 'ascii');
  buf.writeUInt16LE(8, gpsIfd);
  let ge = gpsIfd + 2;
  entry(ge, 1, 2, 2, 0); buf.write('N', ge + 8, 'ascii'); ge += 12;
  entry(ge, 2, 5, 3, latOff); ge += 12;
  entry(ge, 3, 2, 2, 0); buf.write('W', ge + 8, 'ascii'); ge += 12;
  entry(ge, 4, 5, 3, lngOff); ge += 12;
  entry(ge, 5, 1, 1, 0); ge += 12;
  entry(ge, 6, 5, 1, altOff); ge += 12;
  entry(ge, 7, 5, 3, timeOff); ge += 12;
  entry(ge, 0x1d, 2, gpsDate.length, dateOff); ge += 12;
  buf.writeUInt32LE(0, ge);
  const rats = (off: number, pairs: Array<[number, number]>) => {
    pairs.forEach(([n, d], i) => {
      buf.writeUInt32LE(n, off + i * 8);
      buf.writeUInt32LE(d, off + i * 8 + 4);
    });
  };
  rats(latOff, [[37, 1], [46, 1], [2964, 100]]);
  rats(lngOff, [[122, 1], [25, 1], [984, 100]]);
  rats(altOff, [[25, 2]]);
  rats(timeOff, [[3, 1], [4, 1], [5, 1]]);
  buf.write(gpsDate, dateOff, 'ascii');
  buf.writeUInt16LE(1, exifIfd);
  entry(exifIfd + 2, 0x9003, 2, dt.length, dtoOff);
  buf.writeUInt32LE(0, exifIfd + 14);
  buf.write(dt, dtoOff, 'ascii');
  return buf;
}

function jpegWithApp1(payload: Buffer, label: Buffer): Buffer {
  const seg = Buffer.alloc(4 + label.length + payload.length);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  seg.writeUInt16BE(2 + label.length + payload.length, 2);
  label.copy(seg, 4);
  payload.copy(seg, 4 + label.length);
  const tiny = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==',
    'base64'
  );
  return Buffer.concat([tiny.subarray(0, 2), seg, tiny.subarray(2)]);
}

function pngWithExif(tiff: Buffer): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);
  ihdrData.writeUInt32BE(1, 4);
  ihdrData[8] = 8;
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(4 + body.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body), 4 + body.length);
    return out;
  };
  return Buffer.concat([sig, chunk('IHDR', ihdrData), chunk('eXIf', tiff), chunk('IEND', Buffer.alloc(0))]);
}

function webpWithExif(tiff: Buffer): Buffer {
  const pad = tiff.length % 2;
  const chunk = Buffer.alloc(8 + tiff.length + pad);
  chunk.write('EXIF', 0, 'ascii');
  chunk.writeUInt32LE(tiff.length, 4);
  tiff.copy(chunk, 8);
  const riff = Buffer.alloc(12 + chunk.length);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(4 + chunk.length, 4);
  riff.write('WEBP', 8, 'ascii');
  chunk.copy(riff, 12);
  return riff;
}

function heicWithExif(tiff: Buffer): Buffer {
  const exifPayload = Buffer.concat([Buffer.from([0, 0, 0, 6]), Buffer.from('Exif\0\0', 'ascii'), tiff]);
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('heic'), Buffer.alloc(4), Buffer.from('heic'), Buffer.from('mif1')]));
  const hdlrBody = Buffer.concat([Buffer.alloc(4), Buffer.from('pict'), Buffer.alloc(12), Buffer.from('\0')]);
  const hdlr = box('hdlr', Buffer.concat([Buffer.alloc(4), hdlrBody]));
  const infePayload = Buffer.alloc(4 + 2 + 2 + 4 + 5);
  infePayload[0] = 2;
  infePayload.writeUInt16BE(1, 4);
  infePayload.write('Exif', 8, 'ascii');
  infePayload.write('Exif', 12, 'ascii');
  const infe = box('infe', infePayload);
  const iinfBody = Buffer.alloc(6);
  iinfBody.writeUInt16BE(1, 4);
  const iinf = box('iinf', Buffer.concat([iinfBody, infe]));
  const ilocBody = Buffer.alloc(24);
  ilocBody[0] = 1;
  ilocBody[4] = 0x44;
  ilocBody[5] = 0x00;
  ilocBody.writeUInt16BE(1, 6);
  ilocBody.writeUInt16BE(1, 8);
  ilocBody.writeUInt16BE(0, 10);
  ilocBody.writeUInt16BE(0, 12);
  ilocBody.writeUInt16BE(1, 14);
  ilocBody.writeUInt32BE(0, 16);
  ilocBody.writeUInt32BE(exifPayload.length, 20);
  const iloc = box('iloc', ilocBody);
  const metaPayload = Buffer.concat([Buffer.alloc(4), hdlr, iinf, iloc]);
  const meta = box('meta', metaPayload);
  const mdat = box('mdat', exifPayload);
  const file = Buffer.concat([ftyp, meta, mdat]);
  const payloadAt = ftyp.length + meta.length + 8;
  const ilocAt = ftyp.length + 8 + 4 + hdlr.length + iinf.length + 8;
  file.writeUInt32BE(payloadAt, ilocAt + 16);
  return file;
}

function mvhd(iso: string): Buffer {
  const secs = Math.floor((Date.UTC(2020, 0, 2, 3, 4, 5) - Date.UTC(1904, 0, 1)) / 1000);
  const body = Buffer.alloc(100);
  body.writeUInt32BE(secs, 0);
  body.writeUInt32BE(secs, 4);
  body.writeUInt32BE(1000, 8);
  body.writeUInt32BE(5000, 12);
  const head = Buffer.alloc(4);
  return box('mvhd', Buffer.concat([head, body]));
}

function qtKeys(names: string[]): Buffer {
  const parts: Buffer[] = [];
  const head = Buffer.alloc(8);
  head.writeUInt32BE(names.length, 4);
  parts.push(head);
  for (const name of names) {
    const nb = Buffer.from(name, 'utf8');
    const entry = Buffer.alloc(8 + nb.length);
    entry.writeUInt32BE(8 + nb.length, 0);
    entry.write('mdta', 4, 'ascii');
    nb.copy(entry, 8);
    parts.push(entry);
  }
  return box('keys', Buffer.concat(parts));
}

function ilstText(index: number, text: string): Buffer {
  const value = Buffer.from(text, 'utf8');
  const data = Buffer.alloc(16 + value.length);
  data.writeUInt32BE(16 + value.length, 0);
  data.write('data', 4, 'ascii');
  data.writeUInt32BE(1, 8);
  value.copy(data, 16);
  const item = Buffer.alloc(8 + data.length);
  item.writeUInt32BE(item.length, 0);
  item.writeUInt32BE(index, 4);
  data.copy(item, 8);
  return item;
}

function appleMov(tiffUnused: string): Buffer {
  const xyz = box('\u00a9xyz', Buffer.from('+37.3317-122.0308+005.120/', 'latin1'));
  const udta = box('udta', xyz);
  const keys = qtKeys([
    'com.apple.quicktime.location.ISO6709',
    'com.apple.quicktime.make',
    'com.apple.quicktime.model',
    'com.apple.quicktime.creationdate',
  ]);
  const ilst = box('ilst', Buffer.concat([
    ilstText(1, '+37.3317-122.0308+005.120/'),
    ilstText(2, 'Apple'),
    ilstText(3, 'iPhone 13'),
    ilstText(4, '2020-01-02T03:04:05Z'),
  ]));
  const meta = box('meta', Buffer.concat([Buffer.alloc(4), keys, ilst]));
  const moov = box('moov', Buffer.concat([mvhd(''), udta, meta]));
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('qt  '), Buffer.alloc(4), Buffer.from('qt  ')]));
  const mdatSize = 64 * 1024;
  const mdat = Buffer.alloc(8 + mdatSize);
  mdat.writeUInt32BE(mdat.length, 0);
  mdat.write('mdat', 4, 'ascii');
  return Buffer.concat([ftyp, mdat, moov]);
}

function androidMp4(): Buffer {
  const xyz = box('xyz ', Buffer.from('+34.0522-118.2437+050.000/', 'ascii'));
  const make = box('\u00a9mak', Buffer.from('Google', 'ascii'));
  const model = box('\u00a9mod', Buffer.from('Pixel 6', 'ascii'));
  const udta = box('udta', Buffer.concat([xyz, make, model]));
  const moov = box('moov', Buffer.concat([mvhd(''), udta]));
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom'), Buffer.alloc(4), Buffer.from('isom'), Buffer.from('mp41')]));
  return Buffer.concat([ftyp, moov, Buffer.from('trailing-not-read')]);
}

const tiff = buildGpsTiff();
const files: Record<string, Buffer | string> = {
  'geotagged.jpg': jpegWithApp1(tiff, Buffer.from('Exif\0\0', 'ascii')),
  'xmp-only.jpg': jpegWithApp1(Buffer.from(`<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" exif:GPSLatitude="34,3.12N" exif:GPSLongitude="118,14.622W" exif:GPSAltitude="50/1" exif:DateTimeOriginal="2021-06-15T12:30:00" tiff:Make="XmpCam" tiff:Model="X1"/></rdf:RDF></x:xmpmeta>`, 'utf8'), Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1')),
  'photo.heic': heicWithExif(tiff),
  'photo.dng': tiff,
  'photo.tif': tiff,
  'photo.png': pngWithExif(tiff),
  'photo.webp': webpWithExif(tiff),
  'iphone.mov': appleMov(''),
  'android.mp4': androidMp4(),
  'IMG_0001.jpg.json': JSON.stringify({
    title: 'IMG_0001.jpg',
    photoTakenTime: { timestamp: '1609459200', formatted: 'Jan 1, 2021' },
    geoData: { latitude: 0.0, longitude: 0.0, altitude: 0.0 },
    geoDataExif: { latitude: 37.7749, longitude: -122.4194, altitude: 12.5 },
  }, null, 2),
  'location-history.json': JSON.stringify({
    locations: [
      { latitudeE7: 377749000, longitudeE7: -1224194000, accuracy: 12, timestamp: '1609459200000' },
      { latitudeE7: 0, longitudeE7: 0, accuracy: 5, timestamp: '1609459300000' },
      { latitudeE7: 340520000, longitudeE7: -1182437000, accuracy: 30, timestamp: '1609545600000' },
    ],
    geometry: { type: 'Point', coordinates: [-74.006, 40.7128, 8] },
  }),
  'cells.csv': 'timestamp,latitude,longitude,accuracy,device\n2021-01-01T00:00:00Z,40.7128,-74.0060,25,Pixel\n2021-01-02T00:00:00Z,0,0,5,junk\n',
};

for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, name), data);
}

function checkStill(name: string, lat: number, lng: number, source: string) {
  const full = path.join(outDir, name);
  const before = fs.statSync(full).mtimeMs;
  const loc = readMediaLocation(full);
  const after = fs.statSync(full).mtimeMs;
  assert(before === after, `${name} was modified`);
  assert(loc, `${name} returned null`);
  near(loc!.lat, lat, 0.002);
  near(loc!.lng, lng, 0.002);
  assert(loc!.coordSource === source, `${name} source ${loc!.coordSource} != ${source}`);
  const size = fs.statSync(full).size;
  assert(loc!.bytesRead < size || size < 4096, `${name} read ${loc!.bytesRead} of ${size}`);
  console.log(`ok ${name} ${loc!.lat?.toFixed(4)},${loc!.lng?.toFixed(4)} ${loc!.coordSource} device=${loc!.device} at=${loc!.capturedAt} bytes=${loc!.bytesRead}/${size}`);
  return loc!;
}

const jpeg = checkStill('geotagged.jpg', 37.7749, -122.4194, 'exif');
assert(jpeg.device && jpeg.device.includes('Apple') && jpeg.device.includes('iPhone'), `jpeg device ${jpeg.device}`);
assert(jpeg.capturedAt && jpeg.capturedAt.startsWith('2020-01-02T03:04:05'), `jpeg time ${jpeg.capturedAt}`);
near(jpeg.alt, 12.5, 0.01);

checkStill('photo.dng', 37.7749, -122.4194, 'exif');
checkStill('photo.tif', 37.7749, -122.4194, 'exif');
checkStill('photo.png', 37.7749, -122.4194, 'exif');
checkStill('photo.webp', 37.7749, -122.4194, 'exif');
checkStill('photo.heic', 37.7749, -122.4194, 'exif');

const xmp = checkStill('xmp-only.jpg', 34.052, -118.2437, 'xmp');
assert(xmp.device && xmp.device.includes('XmpCam'), `xmp device ${xmp.device}`);
near(xmp.alt, 50, 0.01);

const mov = checkStill('iphone.mov', 37.3317, -122.0308, 'quicktime-iso6709');
assert(mov.device && mov.device.includes('iPhone'), `mov device ${mov.device}`);
assert(mov.capturedAt && mov.capturedAt.startsWith('2020-01-02'), `mov time ${mov.capturedAt}`);
near(mov.alt, 5.12, 0.01);
assert(mov.bytesRead < 200_000, `mov read too much ${mov.bytesRead}`);

const mp4 = checkStill('android.mp4', 34.0522, -118.2437, 'android-xyz');
assert(mp4.device && mp4.device.includes('Pixel'), `mp4 device ${mp4.device}`);
near(mp4.alt, 50, 0.01);

const bigPath = path.join(os.tmpdir(), `uwrp-big-android-${process.pid}.mp4`);
const bigMdat = 8 * 1024 * 1024;
const android = fs.readFileSync(path.join(outDir, 'android.mp4'));
const ftypEnd = android.readUInt32BE(0);
const mdat = Buffer.alloc(8);
mdat.writeUInt32BE(8 + bigMdat, 0);
mdat.write('mdat', 4, 'ascii');
const fd = fs.openSync(bigPath, 'w');
fs.writeSync(fd, android.subarray(0, ftypEnd));
fs.writeSync(fd, mdat);
fs.writeSync(fd, Buffer.alloc(bigMdat, 0x11));
fs.writeSync(fd, android.subarray(ftypEnd));
fs.closeSync(fd);
const started = Date.now();
const big = readMediaLocation(bigPath);
const elapsed = Date.now() - started;
assert(big && big.coordSource === 'android-xyz', 'big mp4 missed location');
near(big!.lat, 34.0522, 0.002);
assert(big!.bytesRead < 2_000_000, `big mp4 read ${big!.bytesRead} bytes`);
assert(elapsed < 5000, `big mp4 took ${elapsed}ms`);
fs.unlinkSync(bigPath);
console.log(`ok big mp4 bytes=${big!.bytesRead} in ${elapsed}ms`);

const sidecar = scanJsonFile(path.join(outDir, 'IMG_0001.jpg.json'));
assert(sidecar.length === 1, `sidecar hits ${sidecar.length}`);
near(sidecar[0].lat, 37.7749);
near(sidecar[0].lng, -122.4194);
near(sidecar[0].alt, 12.5, 0.01);
assert(sidecar[0].capturedAt && sidecar[0].capturedAt.startsWith('2021-01-01'), `sidecar time ${sidecar[0].capturedAt}`);
assert(sidecar[0].recordPath.includes('geoDataExif'), sidecar[0].recordPath);
console.log('ok sidecar', sidecar[0].recordPath, sidecar[0].capturedAt);

const history = scanJsonFile(path.join(outDir, 'location-history.json'));
assert(history.length === 3, `history hits ${history.length} ${JSON.stringify(history)}`);
assert(history.some(h => Math.abs(h.lat - 37.7749) < 0.001 && h.accuracy === 12), 'missing e7 point');
assert(history.some(h => Math.abs(h.lat - 34.052) < 0.001), 'missing second e7');
assert(history.some(h => h.coordSource === 'geojson' && Math.abs(h.lat - 40.7128) < 0.001 && h.alt === 8), 'missing geojson');
assert(!history.some(h => Math.abs(h.lat) < 0.0001), 'kept 0,0');
console.log('ok history', history.length);

const csv = scanDelimitedFile(path.join(outDir, 'cells.csv'));
assert(csv.length === 1, `csv hits ${csv.length}`);
near(csv[0].lat, 40.7128);
near(csv[0].lng, -74.006);
assert(csv[0].accuracy === 25, `csv accuracy ${csv[0].accuracy}`);
assert(csv[0].recordPath === 'row:2', csv[0].recordPath);
console.log('ok csv', csv[0].recordPath);

const duped = dedupeTextHits(history, eventSeedsFromEvents([{
  sourceFile: 'location-history.json',
  timestamp: '2021-01-01T00:00:00.000Z',
  details: { latitude: 37.7749, longitude: -122.4194 },
}]), 'location-history.json', 'location-history.json');
assert(duped.length === history.length - 1, `dedupe left ${duped.length}`);
console.log('ok dedupe');

const chunked = scanJsonText('{"geoData":{"latitude":0,"longitude":0},"geoDataExif":{"latitude":1.5,"longitude":2.5}}');
assert(chunked.length === 1 && chunked[0].lat === 1.5, 'inline json');

const rows: LocationRecord[] = history.map(h => ({
  kind: 'location-record',
  lat: h.lat,
  lng: h.lng,
  alt: h.alt,
  accuracy: h.accuracy,
  capturedAt: h.capturedAt,
  fileName: 'location-history.json',
  recordPath: h.recordPath,
  coordSource: h.coordSource,
}));
const csvOut = locationsToCsv(rows);
const kml = locationsToKml(rows);
assert(csvOut.includes('latitude') && csvOut.includes('37.7749'), 'csv export');
assert(kml.includes('<coordinates>') && kml.includes('-122.4194'), 'kml export');
console.log('ok export');

const manyPath = path.join(os.tmpdir(), `uwrp-many-locations-${process.pid}.json`);
const manyFd = fs.openSync(manyPath, 'w');
fs.writeSync(manyFd, '{"locations":[');
for (let i = 0; i < 4000; i++) {
  const rec = `{"latitudeE7":${377000000 + i},"longitudeE7":${-1220000000 - i},"accuracy":${i % 50},"timestamp":"${1609459200000 + i * 1000}"}`;
  fs.writeSync(manyFd, i === 0 ? rec : `,${rec}`);
}
fs.writeSync(manyFd, ']}');
fs.closeSync(manyFd);
const heapBefore = process.memoryUsage().heapUsed;
const many = scanTextFile(manyPath);
const heapAfter = process.memoryUsage().heapUsed;
assert(many.length === 4000, `many hits ${many.length}`);
const growth = heapAfter - heapBefore;
assert(growth < 80 * 1024 * 1024, `json scan grew heap by ${growth}`);
fs.unlinkSync(manyPath);
console.log(`ok streamed json hits=${many.length} heapGrowth=${Math.round(growth / 1024)}KB`);

import Database from 'better-sqlite3';
import { migrate, loadCaseLocations, loadWorkspace, saveWorkspace } from '../src/lib/caseDatabase';
import { rescanCaseLocations } from '../src/lib/scanCaseLocations';

const dbPath = path.join(os.tmpdir(), `uwrp-loc-${process.pid}.sqlite`);
const db = new Database(dbPath);
migrate(db);
saveWorkspace(db, {
  id: 'case-loc',
  active_provider: 'google',
  signature: 'sig',
  files: [
    { name: 'geotagged.jpg', relativePath: 'geotagged.jpg', size: 634, isMedia: true, mediaType: 'image', sourcePath: path.join(outDir, 'geotagged.jpg') },
    { name: 'iphone.mov', relativePath: 'iphone.mov', size: 1000, isMedia: true, mediaType: 'video', sourcePath: path.join(outDir, 'iphone.mov') },
    { name: 'IMG_0001.jpg', relativePath: 'IMG_0001.jpg', size: 634, isMedia: true, mediaType: 'image', sourcePath: path.join(outDir, 'geotagged.jpg') },
    { name: 'IMG_0001.jpg.json', relativePath: 'IMG_0001.jpg.json', size: 200, isMedia: false, sourcePath: path.join(outDir, 'IMG_0001.jpg.json') },
    { name: 'location-history.json', relativePath: 'location-history.json', size: 200, isMedia: false, sourcePath: path.join(outDir, 'location-history.json') },
    { name: 'cells.csv', relativePath: 'cells.csv', size: 100, isMedia: false, sourcePath: path.join(outDir, 'cells.csv') },
    { name: 'photo.heic', relativePath: 'photo.heic', size: 500, isMedia: true, mediaType: 'image', sourcePath: path.join(outDir, 'photo.heic') },
  ],
  events: [{
    id: 'evt-1',
    timestamp: '2021-01-01T00:00:00.000Z',
    category: 'other',
    sender: 'acct',
    content: 'ping',
    sourceFile: 'location-history.json',
    details: { latitude: 37.7749, longitude: -122.4194 },
  }],
});
const scanned = rescanCaseLocations(db, 'case-loc');
assert(scanned.media.length >= 3, `media patches ${scanned.media.length}`);
const jpegPatch = scanned.media.find(m => m.name === 'geotagged.jpg');
assert(jpegPatch?.gps && Math.abs(jpegPatch.gps.lat - 37.7749) < 0.002, 'db jpeg');
assert(jpegPatch?.device && jpegPatch.device.includes('iPhone'), 'db device');
const loaded = loadWorkspace(db, 'case-loc');
assert(loaded && loaded.files.find(f => f.name === 'geotagged.jpg' && f.gps), 'reload gps');
const locs = loadCaseLocations(db, 'case-loc', 0, 100);
assert(locs.some(l => l.kind === 'sidecar' && Math.abs(l.lat - 37.7749) < 0.002), 'sidecar stored');
assert(locs.some(l => l.kind === 'location-record' && l.coordSource === 'csv'), 'csv stored');
assert(locs.some(l => l.coordSource === 'geojson'), 'geojson stored');
assert(!locs.some(l => Math.abs(l.lat) < 1e-6), 'stored a 0,0');
const dupes = locs.filter(l => l.fileName === 'location-history.json' && Math.abs(l.lat - 37.7749) < 0.002);
assert(dupes.length === 0, `event coord was not deduped (${dupes.length})`);
saveWorkspace(db, {
  id: 'case-loc',
  active_provider: 'google',
  signature: 'sig',
  locationRev: 0,
  files: [{ name: 'geotagged.jpg', relativePath: 'geotagged.jpg', size: 634, isMedia: true, mediaType: 'image', sourcePath: path.join(outDir, 'geotagged.jpg'), gps: null }],
});
const kept = loadWorkspace(db, 'case-loc');
const keptGps = kept?.files.find(f => f.name === 'geotagged.jpg') as { gps?: { lat: number } } | undefined;
assert(keptGps?.gps && Math.abs(keptGps.gps.lat - 37.7749) < 0.002, 'older save kept rescanned gps');
db.close();
fs.unlinkSync(dbPath);
console.log('ok case database rescan');
console.log('location fixtures verified');
