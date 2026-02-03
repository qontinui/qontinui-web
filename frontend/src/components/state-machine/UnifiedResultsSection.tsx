/**
 * Unified Results Section
 *
 * Displays state discovery results from any source (Playwright, UI Bridge, etc.)
 * using the unified StateMachineViewer component.
 */

"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  CheckCircle2,
  Clock,
  Loader2,
  Layers,
  Trash2,
  RefreshCw,
  Download,
  ChevronRight,
} from "lucide-react";
import {
  StateDiscoveryResult,
  StateDiscoveryResultSummary,
  DiscoverySourceType,
  SOURCE_TYPE_LABELS,
  SOURCE_TYPE_COLORS,
} from "@/types/state-machine";
import { StateMachineViewer } from "./StateMachineViewer";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface UnifiedResultsSectionProps {
  results: StateDiscoveryResultSummary[];
  isLoading: boolean;
  error: string | null;
  selectedResult: StateDiscoveryResult | null;
  isLoadingDetail: boolean;
  onSelectResult: (resultId: string) => void;
  onClearSelection: () => void;
  onDeleteResult: (resultId: string) => Promise<void>;
  onRefresh: () => void;
  projectId: string;
}

export function UnifiedResultsSection({
  results,
  isLoading,
  error,
  selectedResult,
  isLoadingDetail: _isLoadingDetail,
  onSelectResult,
  onClearSelection,
  onDeleteResult,
  onRefresh,
  projectId,
}: UnifiedResultsSectionProps) {
  const [sourceFilter, setSourceFilter] = useState<DiscoverySourceType | "all">(
    "all"
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const filteredResults =
    sourceFilter === "all"
      ? results
      : results.filter((r) => r.sourceType === sourceFilter);

  const handleDelete = async (resultId: string) => {
    setDeletingId(resultId);
    try {
      await onDeleteResult(resultId);
    } finally {
      setDeletingId(null);
    }
  };

  const handleExport = async () => {
    if (!selectedResult) return;

    setIsExporting(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/projects/${projectId}/state-discovery-results/${selectedResult.id}/export`,
        { credentials: "include" }
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();

      // Download as JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedResult.name.replace(/[^a-z0-9]/gi, "_")}_state_machine.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export:", err);
    } finally {
      setIsExporting(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardContent className="pt-6">
          <div className="text-center text-red-400">
            <p className="mb-4">{error}</p>
            <Button variant="outline" onClick={onRefresh}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (results.length === 0) {
    return (
      <Card className="flex-1 flex items-center justify-center min-h-[400px]">
        <div className="text-center text-text-muted">
          <Layers className="h-16 w-16 mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium mb-2">No State Machines Found</h3>
          <p className="text-sm max-w-md">
            Run a state discovery from any source (Web Extraction, UI Bridge,
            Recording, etc.) to see unified state machine results here.
          </p>
        </div>
      </Card>
    );
  }

  // If a result is selected, show the viewer
  if (selectedResult) {
    return (
      <div className="flex flex-col gap-4 flex-1 min-h-0">
        {/* Back button and actions */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={onClearSelection}
            className="text-text-muted hover:text-text-primary"
          >
            <ChevronRight className="h-4 w-4 rotate-180 mr-1" />
            Back to Results
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={isExporting}
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Download className="h-4 w-4 mr-1" />
              )}
              Export
            </Button>
          </div>
        </div>

        {/* State Machine Viewer */}
        <div className="flex-1 min-h-0">
          <StateMachineViewer result={selectedResult} />
        </div>
      </div>
    );
  }

  // Results list view
  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* Header with filter and refresh */}
      <Card className="p-4 bg-surface-raised/60 border-border-subtle">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Layers className="h-5 w-5 text-text-muted" />
            <span className="text-sm font-medium">State Discovery Results</span>
            <Badge variant="outline">{results.length}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={sourceFilter}
              onValueChange={(v) =>
                setSourceFilter(v as DiscoverySourceType | "all")
              }
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="playwright">Web Extraction</SelectItem>
                <SelectItem value="ui_bridge">UI Bridge</SelectItem>
                <SelectItem value="recording">Recording</SelectItem>
                <SelectItem value="vision">Vision</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Results Grid */}
      <ScrollArea className="flex-1">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
          {filteredResults.map((result) => (
            <ResultCard
              key={result.id}
              result={result}
              isDeleting={deletingId === result.id}
              isLoadingDetail={false}
              onSelect={() => onSelectResult(result.id)}
              onDelete={() => handleDelete(result.id)}
            />
          ))}
        </div>
      </ScrollArea>

      {filteredResults.length === 0 && sourceFilter !== "all" && (
        <div className="text-center text-text-muted py-8">
          No results found for {SOURCE_TYPE_LABELS[sourceFilter]}.
          <Button
            variant="link"
            onClick={() => setSourceFilter("all")}
            className="text-brand-primary"
          >
            Show all results
          </Button>
        </div>
      )}
    </div>
  );
}

interface ResultCardProps {
  result: StateDiscoveryResultSummary;
  isDeleting: boolean;
  isLoadingDetail: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function ResultCard({
  result,
  isDeleting,
  isLoadingDetail,
  onSelect,
  onDelete,
}: ResultCardProps) {
  return (
    <Card
      className={`
        cursor-pointer transition-all hover:border-brand-primary/50
        ${isLoadingDetail ? "border-brand-primary/50 bg-brand-primary/5" : ""}
      `}
      onClick={onSelect}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm font-medium truncate">
              {result.name}
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              {new Date(result.createdAt).toLocaleDateString()}{" "}
              {new Date(result.createdAt).toLocaleTimeString()}
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={`text-[10px] shrink-0 ${SOURCE_TYPE_COLORS[result.sourceType]}`}
          >
            {SOURCE_TYPE_LABELS[result.sourceType]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {result.description && (
          <p className="text-xs text-text-muted mb-3 line-clamp-2">
            {result.description}
          </p>
        )}
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <div className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            <span>{result.stateCount} states</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{result.transitionCount} transitions</span>
          </div>
        </div>
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-subtle">
          <span className="text-[10px] text-text-muted">
            {result.imageCount} images
          </span>
          <div
            className="flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-text-muted hover:text-red-500"
                  disabled={isDeleting}
                >
                  {isDeleting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete State Machine?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete &quot;{result.name}&quot; and
                    all its associated data. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onDelete}
                    className="bg-red-500 hover:bg-red-600"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default UnifiedResultsSection;
