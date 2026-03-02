import React from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Progress } from "../../ui/progress";
import { OperationProgress } from "../_hooks/useBulkOperations";

interface BulkProgressIndicatorProps {
  progress: OperationProgress;
}

export function BulkProgressIndicator({
  progress,
}: BulkProgressIndicatorProps) {
  return (
    <div className="fixed bottom-20 right-4 z-50 w-80 bg-card border rounded-lg shadow-lg p-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-medium">{progress.operation}</span>
          {progress.status === "running" && (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
          {progress.status === "success" && (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          )}
          {progress.status === "error" && (
            <XCircle className="h-4 w-4 text-destructive" />
          )}
        </div>
        <Progress value={(progress.current / progress.total) * 100} />
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {progress.current} / {progress.total}
          </span>
          {progress.message && <span>{progress.message}</span>}
        </div>
      </div>
    </div>
  );
}
