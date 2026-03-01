"use client";

import { Loader2, Network, RefreshCw, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SavedApiRequest } from "../page-analyzer-types";

interface ApiRequestTabProps {
  savedRequests: SavedApiRequest[];
  selectedRequestId: string;
  setSelectedRequestId: (id: string) => void;
  loadingRequests: boolean;
  isAnalyzing: boolean;
  onRefresh: () => void;
  onRun: () => void;
}

export function ApiRequestTab({
  savedRequests,
  selectedRequestId,
  setSelectedRequestId,
  loadingRequests,
  isAnalyzing,
  onRefresh,
  onRun,
}: ApiRequestTabProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">
          Select a saved API request from the runner library
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onRefresh}
          disabled={loadingRequests}
        >
          <RefreshCw
            className={cn("size-3", loadingRequests && "animate-spin")}
          />
        </Button>
      </div>

      {loadingRequests ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
          <Loader2 className="size-4 animate-spin" />
          Loading requests...
        </div>
      ) : savedRequests.length === 0 ? (
        <div className="text-center py-4">
          <Network className="size-8 mx-auto mb-2 text-muted-foreground opacity-40" />
          <p className="text-xs text-muted-foreground">
            No saved API requests found.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Create saved requests in the runner library first.
          </p>
        </div>
      ) : (
        <select
          value={selectedRequestId}
          onChange={(e) => setSelectedRequestId(e.target.value)}
          className="w-full px-3 py-2 bg-surface-canvas/50 border border-border-subtle rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
        >
          {savedRequests.map((req) => (
            <option key={req.id} value={req.id}>
              [{req.method}] {req.name}
            </option>
          ))}
        </select>
      )}

      <Button
        onClick={onRun}
        disabled={
          isAnalyzing || !selectedRequestId || savedRequests.length === 0
        }
        className="w-full gap-2"
        variant="warning"
        size="sm"
      >
        {isAnalyzing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Play className="size-3.5" />
        )}
        {isAnalyzing ? "Executing..." : "Run Request"}
      </Button>
    </div>
  );
}
