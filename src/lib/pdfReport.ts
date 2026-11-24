/**
 * A real PDF of the case report. Links are PDF annotations.
 * Images are downscaled JPEGs. Evidence files are only read.
 */
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { prepareCaseReport, type AssembleReportArgs, type CaseReportCard } from './caseReportHtml';
import { jpegPoster } from './ffmpegFrames';

const URL_RE = /https?:\/\/[^\s<>"']+/g;

export async function writePdfReport(args: {
  destPath: string;
  report: AssembleReportArgs;
  onProgress?: (done: number, total: number, detail: string) => void;
}): Promise<{ pdfPath: string; images: number; placeholders: number }> {
  const destPath = args.destPath;
  if (!destPath.toLowerCase().endsWith('.pdf')) throw new Error('The PDF report path must end in .pdf.');
  const prepared = prepareCaseReport({ ...args.report, embedMedia: false, linkLocalMedia: false });
  const options = prepared.options;
  const input = prepared.input;
  const showMessages = options.includeMessages !== false && options.includeTimeline !== false;
  const showTimeline = options.includeTimeline !== false;
  const showMedia = options.includeMedia !== false;
  const cards = input.cards.filter(card => {
    if (card.category === 'message') return showMessages;
    if (card.category === 'media' || card.media) return showMedia || showTimeline;
    return showTimeline;
  });
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: { Title: `${input.caseId || 'Case'} report` } });
  const done = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', reject);
  });
  doc.pipe(fs.createWriteStream(destPath));
  doc.font('Helvetica');
  doc.fontSize(18).text(input.caseId || 'Case report', { destination: 'top' });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#333');
  const header = [
    ['Agency', input.agency || ''],
    ['Examiner', input.examiner || ''],
    ['Subject', input.subject || ''],
    ['Provider', input.providerName || ''],
  ];
  for (const [label, value] of header) {
    if (value) doc.text(`${label}: ${value}`);
  }
  doc.moveDown(0.6);
  doc.fontSize(13).fillColor('#111').text('Contents');
  doc.moveDown(0.2);
  doc.fontSize(11);
  const toc: Array<[string, string]> = [['top', 'Top']];
  if (options.includeAccount !== false && input.accounts.length) toc.push(['sec-account', 'Account info']);
  if (showMessages) toc.push(['sec-messages', 'Messages']);
  if (showTimeline) toc.push(['sec-timeline', 'Timeline']);
  if (showMedia) toc.push(['sec-media', 'Media']);
  if (options.includeLocations !== false) toc.push(['sec-locations', 'Locations']);
  for (const [id, label] of toc) {
    doc.fillColor('#1d4ed8').text(label, { goTo: id, underline: true });
    doc.fillColor('#111');
  }
  let images = 0;
  let placeholders = 0;
  const usedDest = new Set<string>(['top']);
  const section = (id: string, title: string) => {
    doc.addPage();
    doc.fontSize(16).fillColor('#111').text(title, { destination: id });
    usedDest.add(id);
    doc.moveDown(0.4);
    doc.fontSize(10);
  };
  const writeRich = (value: string) => {
    const text = value || '';
    const urls = text.match(URL_RE) || [];
    if (!urls.length) {
      doc.fillColor('#111').text(text);
      return;
    }
    const parts = text.split(URL_RE);
    for (let i = 0; i < parts.length; i++) {
      const url = urls[i];
      const moreAfterPart = !!url;
      if (parts[i]) doc.fillColor('#111').text(parts[i], { continued: moreAfterPart });
      if (url) {
        const more = i < parts.length - 1 && !!parts[i + 1];
        doc.fillColor('#1d4ed8').text(url, { link: url, underline: true, continued: more });
      }
    }
  };
  const writeCard = async (card: CaseReportCard, index: number, total: number) => {
    args.onProgress?.(index + 1, total, card.media?.name || card.id);
    doc.moveDown(0.4);
    const heading = usedDest.has(card.id) ? {} : { destination: card.id };
    if (!usedDest.has(card.id)) usedDest.add(card.id);
    doc.fontSize(11).fillColor('#111').text(card.sender || card.content || card.id, heading);
    if (card.timestamp && card.timestamp !== 'unknown') doc.fontSize(9).fillColor('#444').text(card.timestamp);
    doc.fontSize(10).fillColor('#111');
    writeRich(card.content || '');
    if (card.notes) doc.fillColor('#444').text(`Notes: ${card.notes}`);
    if (card.ipAddress) doc.fillColor('#111').text(`IP ${card.ipAddress}`);
    if (card.sourceFile) {
      doc.fillColor('#1d4ed8').text(card.sourceFile, { goTo: card.media ? card.id : 'sec-sources', underline: true });
    }
    for (const chip of card.tagChips || []) {
      doc.fillColor('#1d4ed8').text(chip.name, { goTo: card.id, underline: true, continued: true });
      doc.fillColor('#111').text(' ', { continued: false });
    }
    if (card.media && showMedia) {
      const poster = card.media.sourcePath ? await jpegPoster(card.media.sourcePath, !!options.blurImages) : null;
      if (poster) {
        doc.image(poster, { fit: [220, 140] });
        images += 1;
      } else {
        const y = doc.y;
        doc.rect(doc.x, y, 220, 64).stroke('#94a3b8');
        doc.text(card.media.kind === 'video' ? `Video: ${card.media.name}` : card.media.name, doc.x + 8, y + 8, { width: 204 });
        doc.text(card.media.sha256 || 'hash not computed', doc.x + 8, y + 28, { width: 204 });
        doc.y = y + 72;
        placeholders += 1;
      }
      if (card.media.href && card.media.href.startsWith('files/')) {
        doc.fillColor('#1d4ed8').text(card.media.href, { goTo: card.id, underline: true });
      }
    }
    doc.fillColor('#111');
  };
  if (options.includeAccount !== false && input.accounts.length) {
    section('sec-account', 'Account info');
    for (const account of input.accounts) {
      doc.text([account.displayName || account.username || account.userId || 'Account', account.email || '', account.userId || ''].filter(Boolean).join(' · '));
    }
  }
  const messages = cards.filter(card => card.category === 'message');
  const timeline = cards.filter(card => card.category !== 'message' && card.category !== 'media');
  const media = cards.filter(card => card.category === 'media' || !!card.media);
  if (showMessages) {
    section('sec-messages', 'Messages');
    for (let i = 0; i < messages.length; i++) await writeCard(messages[i], i, messages.length);
    if (!messages.length) doc.text('No messages in this report.');
  }
  if (showTimeline) {
    section('sec-timeline', 'Timeline');
    for (let i = 0; i < timeline.length; i++) await writeCard(timeline[i], i, timeline.length);
    if (!timeline.length) doc.text('No timeline records in this report.');
  }
  if (showMedia) {
    section('sec-media', 'Media');
    const list = media.length ? media : [];
    for (let i = 0; i < list.length; i++) await writeCard(list[i], i, list.length);
    if (!list.length) doc.text('No media in this report.');
  }
  if (options.includeLocations !== false) {
    section('sec-locations', 'Locations');
    for (const point of input.locations) {
      const label = `${point.label} (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`;
      if (point.cardId) doc.fillColor('#1d4ed8').text(label, { goTo: point.cardId, underline: true });
      else doc.fillColor('#111').text(label);
    }
    if (!input.locations.length) doc.fillColor('#111').text('No locations in this report.');
  }
  doc.end();
  await done;
  return { pdfPath: destPath, images, placeholders };
}
