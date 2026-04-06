import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('Results render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-red-700 bg-red-900/30 p-5 space-y-3">
          <p className="text-sm font-semibold text-red-300">Render Error (caught by boundary)</p>
          <pre className="text-xs text-red-200 whitespace-pre-wrap break-all">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="text-xs px-3 py-1.5 rounded bg-red-800 hover:bg-red-700 text-white transition-colors"
          >
            Dismiss
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
