/**
 * Write a case HTML report to a folder on disk.
 * The renderer does not build the HTML or read media bytes.
 * Original evidence files are copied, never modified.
 */
import fs from 'fs';
import path from 'path';
import { assembleCaseReport, type AssembleReportArgs } from './caseReportHtml';

export interface HtmlReportResult {
  htmlPath: string;
  mediaDir: string;
  copied: number;
  missing: number;
}

function writeChunks(file: fs.WriteStream, text: string): Promise<void> {
  const size = 256 * 1024;
  let offset = 0;
  return new Promise((resolve, reject) => {
    const step = () => {
      if (offset >= text.length) {
        file.end(() => resolve());
        return;
      }
      const ok = file.write(text.slice(offset, offset + size));
      offset += size;
      if (ok) step();
      else file.once('drain', step);
    };
    file.on('error', reject);
    step();
  });
}

export async function writeHtmlReportFolder(args: {
  destDir: string;
  report: AssembleReportArgs;
  onProgress?: (done: number, total: number, detail: string) => void;
}): Promise<HtmlReportResult> {
  const destDir = path.resolve(args.destDir);
  if (!path.isAbsolute(destDir)) throw new Error('Choose a full folder path for the HTML report.');
  const mediaBytes = args.report.files.filter(file => file.isMedia).reduce((sum, file) => sum + (file.size || 0), 0);
  if (args.report.embedMedia && mediaBytes > 32 * 1024 * 1024) {
    throw new Error('Embedding this much media would build one huge HTML file and can close the window. Leave “Embed media as base64” off so media stays in a files folder.');
  }
  fs.mkdirSync(destDir, { recursive: true });
  const built = assembleCaseReport({ ...args.report, embedMedia: args.report.embedMedia && mediaBytes <= 32 * 1024 * 1024 });
  const htmlPath = path.join(destDir, 'report.html');
  const mediaDir = path.join(destDir, 'files');
  fs.mkdirSync(mediaDir, { recursive: true });
  args.onProgress?.(0, Math.max(1, built.attachments.length), 'Writing report.html');
  await writeChunks(fs.createWriteStream(htmlPath), built.html);
  let copied = 0;
  let missing = 0;
  for (let i = 0; i < built.attachments.length; i++) {
    const attachment = built.attachments[i];
    args.onProgress?.(i + 1, built.attachments.length, attachment.name || attachment.path);
    if (args.report.embedMedia) continue;
    const rel = attachment.path.replace(/\\/g, '/');
    if (!rel.startsWith('files/') || rel.includes('..')) continue;
    const target = path.join(destDir, rel);
    const source = attachment.sourcePath || '';
    if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
      missing += 1;
      continue;
    }
    if (path.resolve(source) === path.resolve(target)) {
      missing += 1;
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await fs.promises.copyFile(source, target);
    copied += 1;
  }
  return { htmlPath, mediaDir, copied, missing };
}
