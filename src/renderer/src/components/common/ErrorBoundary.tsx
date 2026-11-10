// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React from 'react';

// Catches a render-time crash below this boundary and shows a recoverable panel
// instead of a blank window (React unmounts the whole tree on an uncaught render
// error). Inline styles so the fallback renders even if the failure is CSS/theme.

interface Props {
  readonly children: React.ReactNode;
  /** Changing this clears a caught error (new request, tab switch), so the boundary auto-recovers. */
  readonly resetKey?: unknown;
  /** Custom fallback; defaults to the full-screen panel. */
  readonly fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  readonly state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Keep the underlying bug visible in the devtools console.
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
        // Theme tokens with hard-coded fallbacks: matches the theme, still renders if the stylesheet failed to load.
        background: 'var(--bg-app, #0b0f14)', color: 'var(--text-primary, #e5e7eb)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Something went wrong</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted, #9ca3af)', maxWidth: 520, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {error.message || String(error)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={this.reset}
            style={{ padding: '6px 14px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border, #374151)', background: 'transparent', color: 'var(--text-primary, #e5e7eb)', cursor: 'pointer' }}
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '6px 14px', fontSize: 13, borderRadius: 8, border: 'none', background: 'var(--ts-blue-600, #2563eb)', color: '#fff', cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
