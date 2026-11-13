import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorScreen } from '@/components/common/StatusScreens';

interface State {
  error: Error | null;
}

/** Last line of defence for errors outside the router (route errors use errorComponent). */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return <ErrorScreen onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}
