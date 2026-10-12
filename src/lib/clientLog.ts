/** Report a renderer error to the local log the server writes beside the database. */
export function reportClientError(message: string, detail?: string, source = 'renderer'): void {
  const payload = JSON.stringify({
    message: String(message || 'Unknown error'),
    detail: detail ? String(detail).slice(0, 20000) : '',
    source,
  });
  try {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon('/api/client-log', blob)) return;
    }
  } catch {
    /* fall through to fetch */
  }
  try {
    void fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* logging must never throw */
  }
}
