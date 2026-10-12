import React from 'react';
import { reportClientError } from '../lib/clientLog';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * A render exception used to unmount the whole tree and leave a blank white
 * window. This boundary keeps a visible message and a reload action instead.
 */
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const detail = `${error.stack || error.message}\n\nComponent stack:\n${info.componentStack || ''}`;
    reportClientError(error.message || 'Render error', detail, 'react');
    console.error('Renderer error:', error, info);
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error.message || 'The page hit an unexpected error.';
    return (
      <div style={{
        minHeight: '100vh',
        margin: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f172a',
        color: '#e2e8f0',
        fontFamily: 'Segoe UI, sans-serif',
        padding: 24,
      }}>
        <div style={{ maxWidth: 560, width: '100%' }}>
          <p style={{ letterSpacing: '0.08em', fontSize: 12, color: '#fbbf24', fontWeight: 700, margin: 0 }}>
            WARRANT RETURN PARSER
          </p>
          <h1 style={{ fontSize: 22, margin: '8px 0 12px' }}>This screen hit an error</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: '#cbd5e1' }}>
            The window is still open. Nothing is running in the background. The details were written to the local error log.
          </p>
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: '#020617',
            border: '1px solid #334155',
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
            color: '#fecaca',
          }}>{message}</pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              type="button"
              onClick={this.reload}
              style={{
                background: '#4f46e5',
                color: 'white',
                border: 0,
                borderRadius: 8,
                padding: '10px 14px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Reload window
            </button>
          </div>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 16 }}>
            Use Help → Open Log Folder, or the Diagnostics button after reload, to read uwrp-errors.log. It is stored next to the case database.
          </p>
        </div>
      </div>
    );
  }
}
