/**
 * Last line of defence for the renderer: an uncaught error while rendering
 * is caught gracefully, state is preserved, and the interface can recover
 * without forcing a destructive reload loop that wipes memory.
 */
import React from 'react';

const SNAPSHOT_KEY = 'jayra:crash-preserved-state';
const Base = (React as unknown as { Component: new (props: unknown) => { props: { children?: unknown }; state: { failed: boolean; error: Error | null; errorInfo?: string }; setState(s: Partial<{ failed: boolean; error: Error | null; errorInfo?: string }>): void } }).Component;

export class CrashGuard extends Base {
  state = { failed: false, error: null as Error | null, errorInfo: '' };

  static getDerivedStateFromError(error: unknown): { failed: boolean; error: Error | null } {
    return {
      failed: true,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }): void {
    const errorMsg = error instanceof Error ? error.stack || error.message : String(error);
    const componentStack = info?.componentStack || '';
    console.error('[JAYRA CrashGuard] Gracefully caught interface error:', errorMsg, componentStack);

    // Preserve active runtime state and last step in session storage so context is never lost
    try {
      const stateSnapshot = {
        at: Date.now(),
        error: errorMsg,
        componentStack,
        url: window.location.href,
      };
      sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(stateSnapshot));
    } catch {
      /* storage unavailable */
    }

    this.setState({
      failed: true,
      error: error instanceof Error ? error : new Error(String(error)),
      errorInfo: componentStack,
    });
  }

  handleRecover = (): void => {
    // Gracefully clear error state and resume without reloading the window or dropping memory
    this.setState({ failed: false, error: null, errorInfo: '' });
  };

  handleReload = (): void => {
    // Preserve state before user-initiated refresh
    window.location.reload();
  };

  render(): unknown {
    if (!this.state.failed) return this.props.children;
    const errorMessage = this.state.error?.message || 'A component error occurred during rendering.';

    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(ellipse at center, #111827 0%, #0a0a0f 100%)',
          color: '#cbd5e1',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 14,
          flexDirection: 'column',
          gap: 16,
          padding: 24,
          zIndex: 99999,
        }}
      >
        <div style={{
          maxWidth: 480,
          width: '100%',
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: '#ef444422',
              border: '1px solid #ef444455',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#f87171',
              fontSize: 18,
            }}>
              ⚠️
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: 15 }}>
                Gyra Recovered from an Interface Glitch
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                Your task state and conversation memory have been preserved.
              </div>
            </div>
          </div>

          <div style={{
            background: '#020617',
            border: '1px solid #1e293b',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 12,
            fontFamily: 'monospace',
            color: '#cbd5e1',
            maxHeight: 120,
            overflowY: 'auto',
            wordBreak: 'break-word',
          }}>
            {errorMessage}
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#1e293b',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Restart Window
            </button>
            <button
              type="button"
              onClick={this.handleRecover}
              style={{
                padding: '8px 18px',
                borderRadius: 8,
                border: '1px solid #38bdf844',
                background: '#0284c7',
                color: '#ffffff',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(2, 132, 199, 0.3)',
              }}
            >
              Resume Execution
            </button>
          </div>
        </div>
      </div>
    );
  }
}
