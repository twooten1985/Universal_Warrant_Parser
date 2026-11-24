/**
 * HTML and PDF report jobs. Work runs in the server process.
 * The window only polls progress.
 */
import type { AssembleReportArgs } from './caseReportHtml';
import { writeHtmlReportFolder, type HtmlReportResult } from './htmlReportDisk';
import { writePdfReport } from './pdfReport';

export interface ReportJob {
  id: string;
  kind: 'html' | 'pdf';
  status: 'running' | 'done' | 'error';
  current: number;
  total: number;
  detail: string;
  error?: string;
  html?: HtmlReportResult;
  pdfPath?: string;
}

const jobs = new Map<string, ReportJob>();

function nextId(): string {
  return `rpt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getReportJob(id: string): ReportJob | null {
  return jobs.get(id) || null;
}

export function startHtmlReportJob(destDir: string, report: AssembleReportArgs, onError: (message: string, detail: string) => void): string {
  const id = nextId();
  const job: ReportJob = { id, kind: 'html', status: 'running', current: 0, total: 1, detail: 'Starting HTML report' };
  jobs.set(id, job);
  void writeHtmlReportFolder({
    destDir,
    report,
    onProgress: (done, total, detail) => {
      job.current = done;
      job.total = total;
      job.detail = detail;
    },
  }).then(result => {
    job.status = 'done';
    job.html = result;
    job.detail = result.htmlPath;
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    job.status = 'error';
    job.error = message;
    onError('HTML report failed', err instanceof Error ? err.stack || message : message);
  });
  return id;
}

export function startPdfReportJob(destPath: string, report: AssembleReportArgs, onError: (message: string, detail: string) => void): string {
  const id = nextId();
  const job: ReportJob = { id, kind: 'pdf', status: 'running', current: 0, total: 1, detail: 'Starting PDF report' };
  jobs.set(id, job);
  void writePdfReport({
    destPath,
    report,
    onProgress: (done, total, detail) => {
      job.current = done;
      job.total = total;
      job.detail = detail;
    },
  }).then(result => {
    job.status = 'done';
    job.pdfPath = result.pdfPath;
    job.detail = result.pdfPath;
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    job.status = 'error';
    job.error = message;
    onError('PDF report failed', err instanceof Error ? err.stack || message : message);
  });
  return id;
}
