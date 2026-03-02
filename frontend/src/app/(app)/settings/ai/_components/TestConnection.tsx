import { Button } from "@/components/ui/button";
import { Loader2, Play } from "lucide-react";

interface TestConnectionProps {
  testing: boolean;
  onTest: () => void;
}

export function TestConnection({ testing, onTest }: TestConnectionProps) {
  return (
    <div className="rounded-lg border border-border">
      <div className="px-4 py-3 border-b border-border bg-muted/50">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Play className="size-4" />
          Test Connection
        </h3>
        <p className="text-xs text-muted-foreground">
          Verify your AI provider is properly configured
        </p>
      </div>
      <div className="p-4">
        <Button variant="outline" onClick={onTest} disabled={testing}>
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          {testing ? "Testing..." : "Test Connection"}
        </Button>
      </div>
    </div>
  );
}
