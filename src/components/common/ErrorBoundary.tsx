import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * App-wide error boundary. A render/runtime error in any screen used to unmount
 * the whole tree and leave a blank white page with the message only in the
 * console (PLT-3). This catches it and shows a recoverable screen with a reload
 * button, so one broken screen never takes the whole app down.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the detail in the console for debugging; never surface stack traces
    // to the user.
    console.error('Unhandled UI error:', error, info?.componentStack);
  }

  handleReload = () => {
    // Clearing the flag lets the user retry without a full reload; if the error
    // is persistent the reload button below does a hard refresh.
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white border border-slate-300 rounded-lg shadow-sm p-6 text-center space-y-4">
          <div className="text-2xl font-extrabold text-slate-900">Something went wrong</div>
          <p className="text-sm text-slate-600">
            This screen hit an unexpected error. Your data is safe — nothing was lost.
            Try again, or reload the app.
          </p>
          {this.state.error?.message && (
            <p className="text-xs font-mono text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 break-words">
              {this.state.error.message}
            </p>
          )}
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="px-4 py-2 rounded-md bg-slate-100 hover:bg-slate-200 border border-slate-300 text-sm font-bold text-slate-800 transition-colors cursor-pointer"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition-colors cursor-pointer"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
