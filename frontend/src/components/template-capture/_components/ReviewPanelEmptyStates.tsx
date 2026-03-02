import React from "react";
import {
  Loader2,
  RefreshCw,
  XCircle,
  Inbox,
  MousePointerClick,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface LoadingStateProps {
  visible: boolean;
}

export function LoadingState({ visible }: LoadingStateProps) {
  if (!visible) return null;
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
      <p className="text-muted-foreground">Loading candidates...</p>
    </div>
  );
}

interface ErrorStateProps {
  error: string;
  onRetry: () => void;
}

export function ErrorState({ error, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
      <div className="p-4 rounded-full bg-red-100 dark:bg-red-950">
        <XCircle className="h-10 w-10 text-red-500" />
      </div>
      <div>
        <p className="font-medium text-red-600 mb-1">
          Failed to load candidates
        </p>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
      <Button variant="outline" onClick={onRetry}>
        <RefreshCw className="h-4 w-4 mr-2" />
        Try Again
      </Button>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
      <div className="p-4 rounded-full bg-muted">
        <Inbox className="h-10 w-10 text-muted-foreground" />
      </div>
      <div>
        <p className="font-medium text-muted-foreground mb-1">
          No candidates found
        </p>
        <p className="text-sm text-muted-foreground max-w-md">
          Start a capture session to automatically detect UI elements. Go to the
          Capture tab and click on buttons and elements in your target
          application.
        </p>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <MousePointerClick className="h-4 w-4" />
        <span>Click elements during capture to generate templates</span>
      </div>
    </div>
  );
}
