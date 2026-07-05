import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorRecoveryProps {
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}

export function ErrorRecovery({ message, onRetry, compact }: ErrorRecoveryProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-[#93000a]/30 bg-[#93000a]/10 px-4 py-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-[#ffb4ab]" />
        <p className="text-xs text-[#ffb4ab]/80 flex-1">
          {message || "Something went wrong"}
        </p>
        {onRetry && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-[#ffb4ab] hover:text-[#ffb4ab] hover:bg-[#93000a]/20"
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
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#93000a]/30 bg-[#93000a]/5 p-8 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#93000a]/15">
        <AlertTriangle className="h-5 w-5 text-[#ffb4ab]" />
      </div>
      <p className="text-sm font-medium text-[#ffb4ab]">
        {message || "Failed to load data"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        This could be a temporary issue.
      </p>
      {onRetry && (
        <Button
          size="sm"
          variant="outline"
          className="mt-4 border-outline-variant text-xs"
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
    <div className={cn("flex items-center gap-2 px-3 py-2 rounded bg-[#93000a]/8 border border-[#93000a]/20", className)}>
      <span className="text-xs text-[#ffb4ab]/80 flex-1 truncate">{error}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-[#ffb4ab] hover:text-[#ffb4ab]/80 shrink-0 p-1"
          title="Retry"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
