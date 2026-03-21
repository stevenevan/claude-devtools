import React, { Component, type ErrorInfo, type ReactNode } from 'react';

import { createLogger } from '@shared/utils/logger';
import { AlertTriangle, RefreshCw } from 'lucide-react';

const logger = createLogger('Component:ErrorBoundary');

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  // eslint-disable-next-line sonarjs/function-return-type -- Error boundaries inherently return different content based on error state
  render(): ReactNode {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback } = this.props;

    if (hasError) {
      if (fallback) {
        return fallback;
      }

      return (
        <div className="bg-claude-dark-bg text-claude-dark-text flex h-screen flex-col items-center justify-center p-8">
          <div className="mb-6 flex items-center gap-3">
            <AlertTriangle className="size-10 text-red-500" />
            <h1 className="text-2xl font-semibold">Something went wrong</h1>
          </div>

          <p className="text-claude-dark-text-secondary mb-6 max-w-md text-center">
            An unexpected error occurred in the application. You can try reloading the page or
            resetting the error state.
          </p>

          {error && (
            <div className="border-claude-dark-border bg-claude-dark-surface mb-6 w-full max-w-2xl overflow-auto rounded-lg border p-4">
              <p className="mb-2 font-mono text-sm text-red-400">{error.message}</p>
              {errorInfo?.componentStack && (
                <details className="mt-2">
                  <summary className="text-claude-dark-text-secondary hover:text-claude-dark-text cursor-pointer text-xs">
                    Component Stack
                  </summary>
                  <pre className="text-claude-dark-text-secondary mt-2 text-xs whitespace-pre-wrap">
                    {errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>
          )}

          <div className="flex gap-4">
            <button
              onClick={this.handleReset}
              className="border-claude-dark-border bg-claude-dark-surface hover:bg-claude-dark-border flex items-center gap-2 rounded-lg border px-4 py-2 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={this.handleReload}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 transition-colors hover:bg-blue-700"
            >
              <RefreshCw className="size-4" />
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return children;
  }
}
