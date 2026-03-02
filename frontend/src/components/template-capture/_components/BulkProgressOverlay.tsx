import React from "react";
import { Loader2 } from "lucide-react";

interface BulkProgressOverlayProps {
  progress: { current: number; total: number } | null;
}

export function BulkProgressOverlay({ progress }: BulkProgressOverlayProps) {
  if (!progress) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="bg-card p-6 rounded-lg shadow-lg border text-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        <div>
          <p className="font-medium">Processing templates...</p>
          <p className="text-sm text-muted-foreground">
            {progress.current} of {progress.total}
          </p>
        </div>
        <div className="w-48 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{
              width: `${(progress.current / progress.total) * 100}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
