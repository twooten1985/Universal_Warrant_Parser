/**
 * Quiet boundary so Conversation View failures show retry UI instead of a blank white page.
 * Does not clear parsed case data — only remounts the viewer.
 */
import React, { Component, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

type Props = {
  children: ReactNode;
  /** Optional label for logs / UI */
  label?: string;
};

type State = {
  hasError: boolean;
  message: string;
  retryKey: number;
};

export class ConversationErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '', retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      message: error?.message || 'Unknown render error',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ConversationErrorBoundary]', this.props.label || 'Conversation View', error, info?.componentStack);
  }

  handleRetry = () => {
    this.setState(prev => ({
      hasError: false,
      message: '',
      retryKey: prev.retryKey + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[420px] flex flex-col items-center justify-center gap-3 p-8 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-center">
          <AlertTriangle className="h-10 w-10 text-amber-500" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
            Conversation failed to load
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
            Your case data is still loaded. Retry the conversation view without re-importing.
          </p>
          {this.state.message && (
            <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 max-w-lg break-words">
              {this.state.message}
            </p>
          )}
          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-1 px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white"
          >
            Retry
          </button>
        </div>
      );
    }

    return (
      <React.Fragment key={this.state.retryKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}
