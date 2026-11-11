import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Used in the console message. */
  name: string;
  children: ReactNode;
}

/**
 * If anything inside crashes, it disappears quietly instead of taking the rest
 * of the dashboard down with it. The error is logged to the browser console.
 */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}] crashed and was hidden. The rest of the dashboard keeps running.`, error, info.componentStack);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
