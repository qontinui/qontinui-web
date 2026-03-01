"use client";

import { Loader2, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface UIBridgeAnalysisTabProps {
  uiBridgeUrl: string;
  setUiBridgeUrl: (url: string) => void;
  uiBridgeTarget: "web" | "runner";
  setUiBridgeTarget: (target: "web" | "runner") => void;
  isAnalyzing: boolean;
  onRun: () => void;
}

export function UIBridgeAnalysisTab({
  uiBridgeUrl,
  setUiBridgeUrl,
  uiBridgeTarget,
  setUiBridgeTarget,
  isAnalyzing,
  onRun,
}: UIBridgeAnalysisTabProps) {
  return (
    <div className="space-y-3">
      {/* Target selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted whitespace-nowrap">
          Target:
        </span>
        <div className="flex gap-1 p-0.5 bg-muted rounded-md">
          <button
            type="button"
            onClick={() => setUiBridgeTarget("web")}
            className={cn(
              "px-2.5 py-1 text-xs rounded transition-colors",
              uiBridgeTarget === "web"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Web Frontend
          </button>
          <button
            type="button"
            onClick={() => setUiBridgeTarget("runner")}
            className={cn(
              "px-2.5 py-1 text-xs rounded transition-colors",
              uiBridgeTarget === "runner"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Runner Frontend
          </button>
        </div>
      </div>

      {/* URL display */}
      <div className="flex items-center gap-2">
        <Input
          value={uiBridgeUrl}
          onChange={(e) => setUiBridgeUrl(e.target.value)}
          placeholder="http://localhost:3001/api/ui-bridge"
          className="text-xs h-8 font-mono bg-surface-canvas/50"
        />
      </div>

      <p className="text-xs text-text-muted">
        Fetches a DOM snapshot via the UI Bridge SDK. Returns the element tree,
        element metadata, and page context.
      </p>

      <Button
        onClick={onRun}
        disabled={isAnalyzing || !uiBridgeUrl.trim()}
        className="w-full gap-2"
        variant="brand-primary"
        size="sm"
      >
        {isAnalyzing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ScanSearch className="size-3.5" />
        )}
        {isAnalyzing ? "Analyzing..." : "Fetch Snapshot"}
      </Button>
    </div>
  );
}
