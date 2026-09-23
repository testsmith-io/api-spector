// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React from 'react';

// A render-time crash anywhere below this boundary is caught here and shown as a
// recoverable panel instead of a blank white window (React unmounts the whole
// tree on an uncaught render error). Inline styles are used deliberately so the
// fallback still renders even if the failure is CSS/theme-related.

interface Props {
  children: React.ReactNode;
  /** When this value changes, a caught error is cleared (e.g. on a new request
   *  or tab switch) so a scoped boundary auto-recovers without a full reload. */
  resetKey?: unknown;
  /** Custom fallback; defaults to the full-screen panel. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Keep the underlying bug diagnosable (visible in the devtools console).
    console.error('[renderer] uncaught error:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private reset = (): void => this.setState({ error: null });

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 16, height: '100vh', padding: 24, textAlign: 'center',
        background: '#0b0f14', color: '#e5e7eb',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Something went wrong</div>
        <div style={{ fontSize: 12, color: '#9ca3af', maxWidth: 520, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {error.message || String(error)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={this.reset}
            style={{ padding: '6px 14px', fontSize: 13, borderRadius: 8, border: '1px solid #374151', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' }}
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '6px 14px', fontSize: 13, borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
