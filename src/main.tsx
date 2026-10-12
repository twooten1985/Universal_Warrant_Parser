import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx';
import { reportClientError } from './lib/clientLog.ts';
import './index.css';

const rootEl = document.getElementById('root')!;

function showFatal(message: string, detail?: string) {
  reportClientError(message, detail, 'window');
  const pageIsBlank = rootEl.childElementCount === 0;
  if (!pageIsBlank) {
    if (document.getElementById('uwrp-error-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'uwrp-error-banner';
    bar.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:90;background:#451a1a;color:#fecaca;border:1px solid #7f1d1d;border-radius:10px;padding:12px 14px;font-family:Segoe UI,sans-serif;font-size:13px';
    bar.textContent = `Something went wrong: ${message}. It was written to uwrp-errors.log.`;
    document.body.appendChild(bar);
    return;
  }
  rootEl.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#e2e8f0;font-family:Segoe UI,sans-serif;padding:24px">
      <div style="max-width:560px">
        <p style="letter-spacing:.08em;font-size:12px;color:#fbbf24;font-weight:700">WARRANT RETURN PARSER</p>
        <h1 style="font-size:22px">This screen hit an error</h1>
        <p style="color:#cbd5e1;line-height:1.5">The page stopped instead of staying white. Details were written to the local error log (uwrp-errors.log, next to the case database).</p>
        <pre style="white-space:pre-wrap;background:#020617;border:1px solid #334155;border-radius:8px;padding:12px;color:#fecaca">${String(message).replace(/[<>&]/g, '')}</pre>
        <button id="uwrp-reload" style="background:#4f46e5;color:white;border:0;border-radius:8px;padding:10px 14px;font-weight:700;cursor:pointer">Reload window</button>
      </div>
    </div>`;
  document.getElementById('uwrp-reload')?.addEventListener('click', () => window.location.reload());
}

window.addEventListener('error', (event) => {
  if (event.target && event.target !== window) return;
  showFatal(event.message || 'Unhandled error', event.error?.stack || '');
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = reason?.message || String(reason || 'Unhandled promise rejection');
  showFatal(message, reason?.stack || message);
});

createRoot(rootEl).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
