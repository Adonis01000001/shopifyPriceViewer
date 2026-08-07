import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorRecoveryProps {
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}

export function ErrorRecovery({
  message,
  onRetry,
  compact,
}: ErrorRecoveryProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
        <p className="flex-1 text-xs text-destructive/80">
          {message || "Something went wrong"}
        </p>
        {onRetry && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-destructive hover:bg-destructive/15 hover:text-destructive"
            onClick={onRetry}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-destructive/25 bg-destructive/5 p-8 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/15">
        <AlertTriangle className="h-5 w-5 text-destructive" />
      </div>
      <p className="text-sm font-semibold text-destructive">
        {message || "Failed to load data"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        This could be a temporary issue.
      </p>
      {onRetry && (
        <Button
          size="sm"
          variant="outline"
          className="mt-4 border-input text-xs"
          onClick={onRetry}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Try Again
        </Button>
      )}
    </div>
  );
}

import { cn } from "@/lib/utils";

interface RetryCellProps {
  error: string;
  onRetry?: () => void;
  className?: string;
}

export function RetryCell({ error, onRetry, className }: RetryCellProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2",
        className
      )}
    >
      <span className="flex-1 truncate text-xs text-destructive/80">
        {error}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive/80"
          title="Retry"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
