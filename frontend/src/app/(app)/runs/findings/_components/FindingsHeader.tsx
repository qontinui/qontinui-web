import { Button } from "@/components/ui/button";
import { RefreshCw, Wrench, Trash2, Loader2 } from "lucide-react";

interface FindingsHeaderProps {
  autoFixEnabled: boolean;
  isFixing: boolean;
  hasFindings: boolean;
  onToggleAutoFix: () => void;
  onFixAll: () => void;
  onClearAll: () => void;
  onRefresh: () => void;
}

export function FindingsHeader({
  autoFixEnabled,
  isFixing,
  hasFindings,
  onToggleAutoFix,
  onFixAll,
  onClearAll,
  onRefresh,
}: FindingsHeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
      <h1 className="text-lg font-semibold">Findings</h1>
      <div className="flex items-center gap-2">
        <Button
          variant={autoFixEnabled ? "default" : "outline"}
          size="sm"
          onClick={onToggleAutoFix}
          className={
            autoFixEnabled ? "bg-green-600 hover:bg-green-700" : "border-border"
          }
        >
          <Wrench className="size-4 mr-1" />
          Auto-Fix {autoFixEnabled ? "On" : "Off"}
        </Button>
        {hasFindings && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onFixAll}
              disabled={isFixing}
            >
              {isFixing ? (
                <Loader2 className="size-4 animate-spin mr-1" />
              ) : (
                <Wrench className="size-4 mr-1" />
              )}
              Fix All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onClearAll}
              className="text-red-400 border-red-500/30"
            >
              <Trash2 className="size-4 mr-1" />
              Clear All
            </Button>
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          className="border-border"
        >
          <RefreshCw className="size-4 mr-2" />
          Refresh
        </Button>
      </div>
    </header>
  );
}
