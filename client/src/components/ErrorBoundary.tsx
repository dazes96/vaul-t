import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * Catches render/runtime errors from anywhere in the tree so a single bad
 * component shows a recoverable panel instead of a blank white IDE. Your open
 * files and unsaved edits live in the store, which survives a boundary reset.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Emerald caught a render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', color: 'var(--fg)', height: '100%', overflow: 'auto' }}>
        <h2 style={{ color: 'var(--danger)' }}>Something in the UI crashed</h2>
        <p style={{ color: 'var(--fg-dim)' }}>
          The rest of Emerald kept running. Your open files and unsaved changes are preserved in memory.
          Try recovering; if it persists, reload the page.
        </p>
        <pre style={{
          background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 6,
          padding: 12, overflowX: 'auto', fontSize: 12, maxWidth: 800,
        }}>
          {this.state.error.message}
          {'\n\n'}
          {this.state.error.stack}
        </pre>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="primary" onClick={() => this.setState({ error: null })}>Recover</button>
          <button onClick={() => location.reload()}>Reload IDE</button>
        </div>
      </div>
    );
  }
}
