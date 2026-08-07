import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="glass-panel w-full max-w-xl p-8 text-center sm:p-12">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertTriangle className="h-7 w-7" aria-hidden="true" />
            </div>
            <p className="page-kicker">Workspace interruption</p>
            <h2 className="page-title mt-2 text-2xl">
              Something needs a refresh
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              We couldn&apos;t complete this view. Your account data is safe;
              reload the page and try the action again.
            </p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => window.history.back()}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[0.7rem] border border-border bg-surface-container px-4 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
              >
                <ArrowLeft className="h-4 w-4" />
                Go back
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[0.7rem] bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <RotateCcw className="h-4 w-4" />
                Reload workspace
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
