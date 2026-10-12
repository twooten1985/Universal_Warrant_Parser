import { spawn, type ChildProcess } from 'child_process';
import { createRequire } from 'module';

/**
 * Fallback preview frames for videos Chromium can't decode. ffmpeg writes JPEGs to stdout only:
 * no temp files, no logs to disk (stderr kept in memory), -nostdin for file inputs. Originals are read-only.
 */
let ffmpegPath: string | null = null;
function getFfmpeg(): string | null {
  if (ffmpegPath !== null) return ffmpegPath || null;
  try {
    const req = createRequire(typeof __filename !== 'undefined' ? __filename : process.cwd() + '/index.js');
    const p: string = req('ffmpeg-static');
    ffmpegPath = p ? p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1') : '';
  } catch { ffmpegPath = ''; }
  return ffmpegPath || null;
}

const MAX_PROCS = 2;
let running = 0;
const waiters: Array<() => void> = [];
const acquire = () => new Promise<void>(r => { if (running < MAX_PROCS) { running++; r(); } else waiters.push(() => { running++; r(); }); });
const release = () => { running--; waiters.shift()?.(); };

export interface FrameJob { kill: () => void; killed: boolean; procs: Set<ChildProcess>; }
export const newJob = (): FrameJob => {
  const job: FrameJob = { killed: false, procs: new Set(), kill: () => { job.killed = true; job.procs.forEach(p => { try { p.kill('SIGKILL'); } catch { /* gone */ } }); } };
  return job;
};

async function run(job: FrameJob, args: string[], input?: Buffer): Promise<{ out: Buffer; err: string }> {
  const bin = getFfmpeg();
  if (!bin) throw new Error('ffmpeg not available');
  await acquire();
  try {
    if (job.killed) throw new Error('cancelled');
    return await new Promise((resolve, reject) => {
      const p = spawn(bin, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true });
      job.procs.add(p);
      const out: Buffer[] = []; let err = '';
      const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* */ } }, 20000);
      p.stdout!.on('data', d => out.push(d));
      p.stderr!.on('data', d => { if (err.length < 20000) err += d.toString(); });
      p.on('error', e => { clearTimeout(timer); job.procs.delete(p); reject(e); });
      p.on('close', () => { clearTimeout(timer); job.procs.delete(p); job.killed ? reject(new Error('cancelled')) : resolve({ out: Buffer.concat(out), err }); });
      if (input) { p.stdin!.on('error', () => { /* ffmpeg may close early */ }); p.stdin!.end(input); }
    });
  } finally { release(); }
}

function parseDuration(stderr: string): number {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

function splitJpegs(buf: Buffer): Buffer[] {
  const frames: Buffer[] = [];
  let start = -1;
  for (let i = 0; i < buf.length - 2; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      if (start >= 0) frames.push(buf.subarray(start, i));
      start = i;
    }
  }
  if (start >= 0) frames.push(buf.subarray(start));
  return frames;
}

const OUT = ['-vf', 'scale=320:-2', '-q:v', '8', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'];

/** count=1 -> poster at ~10%; otherwise evenly spaced frames. Input is a file path (fast seek) or bytes (stdin). */
export async function extractFrames(job: FrameJob, input: { path?: string; bytes?: Buffer }, count: number): Promise<{ duration: number; frames: Buffer[] }> {
  const n = Math.max(1, Math.min(20, Math.floor(count) || 10));
  const src = input.path ? ['-i', input.path] : ['-i', 'pipe:0'];
  const pre = input.path ? ['-nostdin', '-hide_banner'] : ['-hide_banner'];
  const probe = await run(job, [...pre, ...src], input.bytes);
  const duration = parseDuration(probe.err);
  const times = n === 1 ? [duration * 0.1] : Array.from({ length: n }, (_, i) => duration * (i + 0.5) / n);
  if (input.path) {
    const frames: Buffer[] = [];
    for (const t of times) {
      const r = await run(job, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', input.path, '-frames:v', '1', ...OUT]);
      const f = splitJpegs(r.out)[0];
      if (f) frames.push(f);
    }
    return { duration, frames };
  }
  // Bytes over stdin can't fast-seek: one pass with an fps filter.
  const fps = duration > 0 ? (n / duration) : 1;
  const vf = n === 1 && duration > 0 ? `select='gte(t\\,${(duration * 0.1).toFixed(3)})',scale=320:-2` : `fps=${fps.toFixed(6)},scale=320:-2`;
  const r = await run(job, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vf', vf, '-frames:v', String(n), '-q:v', '8', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'], input.bytes);
  return { duration, frames: splitJpegs(r.out) };
}
