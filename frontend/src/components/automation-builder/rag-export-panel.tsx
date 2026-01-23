"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Download,
  Send,
  Info,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Monitor,
  Database,
  Brain,
} from "lucide-react";
import { toast } from "sonner";
import { ragExportService } from "@/services/service-factory";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import type {
  RAGExportRequest,
  RAGExportStatus,
  EmbeddingProgress,
} from "@/services/rag-export-service";

interface RAGExportPanelProps {
  projectId: string | null;
}

export function RAGExportPanel({ projectId }: RAGExportPanelProps) {
  const [exportStatus, setExportStatus] = useState<RAGExportStatus | null>(
    null
  );
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [embeddingProgress, setEmbeddingProgress] =
    useState<EmbeddingProgress | null>(null);
  const [lastExportResult, setLastExportResult] = useState<{
    success: boolean;
    message: string;
    elementCount?: number;
    exportSize?: number;
  } | null>(null);

  // Export options
  const [options, setOptions] = useState<RAGExportRequest>({
    include_ocr: true,
    include_screenshots: false,
    embedding_model: "all-MiniLM-L6-v2",
  });

  // Get active runner connections
  const { connections: activeConnections, isLoading: connectionsLoading } =
    useRealtimeConnections();

  // Selected runner for transfer
  const [selectedRunnerId, setSelectedRunnerId] = useState<string | null>(null);

  // Load export status when project changes
  useEffect(() => {
    if (projectId) {
      loadExportStatus();
    }
  }, [projectId]);

  const loadExportStatus = async () => {
    if (!projectId) return;

    setIsLoadingStatus(true);
    try {
      const status = await ragExportService.getExportStatus(projectId);
      setExportStatus(status);
    } catch (error) {
      console.error("Failed to load export status:", error);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  const handleDownloadExport = async () => {
    if (!projectId) {
      toast.error("No project selected");
      return;
    }

    setIsExporting(true);
    setExportProgress(10);

    try {
      setExportProgress(30);
      const blob = await ragExportService.downloadExport(projectId, options);

      setExportProgress(80);

      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exportStatus?.project_name || "project"}_rag_config.json`;
      a.click();
      URL.revokeObjectURL(url);

      setExportProgress(100);
      toast.success("RAG config exported successfully");

      setLastExportResult({
        success: true,
        message: "Export downloaded successfully",
        elementCount: exportStatus?.stats.element_count,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Export failed";
      toast.error(message);
      setLastExportResult({
        success: false,
        message,
      });
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const handleTransferToRunner = async () => {
    if (!projectId) {
      toast.error("No project selected");
      return;
    }

    if (!selectedRunnerId) {
      toast.error("Please select a runner");
      return;
    }

    const selectedRunner = activeConnections?.find(
      (c) => String(c.id) === selectedRunnerId
    );
    if (!selectedRunner) {
      toast.error("Selected runner not found");
      return;
    }

    // Default runner URL - in real implementation this would come from the connection
    const runnerUrl = "http://localhost:9876";

    setIsTransferring(true);
    setExportProgress(10);
    setEmbeddingProgress(null);

    try {
      setExportProgress(30);
      const result = await ragExportService.transferToRunner(
        projectId,
        runnerUrl,
        options
      );

      setExportProgress(100);

      if (result.success) {
        toast.success("RAG config transferred to runner successfully");
        setLastExportResult({
          success: true,
          message: `Transferred to ${selectedRunner.runner_name}`,
          elementCount: result.element_count,
          exportSize: result.export_size_bytes,
        });

        // Start polling for embedding progress
        setEmbeddingProgress({
          status: "in_progress",
          message: "Starting embedding generation...",
          percent: 0,
        });
        startPollingEmbeddingProgress(runnerUrl, projectId);
      } else {
        toast.error(result.message || "Transfer failed");
        setLastExportResult({
          success: false,
          message: result.message || "Transfer failed",
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Transfer failed";
      toast.error(message);
      setLastExportResult({
        success: false,
        message,
      });
    } finally {
      setIsTransferring(false);
      setExportProgress(0);
    }
  };

  // Poll for embedding progress
  const startPollingEmbeddingProgress = (
    runnerUrl: string,
    projectId: string
  ) => {
    const pollInterval = setInterval(async () => {
      try {
        const progress = await ragExportService.getEmbeddingProgress(
          runnerUrl,
          projectId
        );
        setEmbeddingProgress(progress);

        // Stop polling when complete or failed
        if (progress.status === "completed" || progress.status === "failed") {
          clearInterval(pollInterval);

          if (progress.status === "completed") {
            toast.success("Embeddings generated successfully");
          } else {
            toast.error(`Embedding generation failed: ${progress.message}`);
          }
        }
      } catch (error) {
        console.error("Failed to poll embedding progress:", error);
        // Don't stop polling on error - the runner might be temporarily unavailable
      }
    }, 2000); // Poll every 2 seconds

    // Cleanup on unmount or timeout after 10 minutes
    setTimeout(() => {
      clearInterval(pollInterval);
    }, 600000);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  if (!projectId) {
    return (
      <Card className="border-yellow-500/50 bg-yellow-950/20">
        <CardContent className="flex items-center gap-3 py-6">
          <AlertCircle className="w-5 h-5 text-yellow-500" />
          <div>
            <p className="font-medium text-yellow-400">No project selected</p>
            <p className="text-sm text-text-muted">
              Select a project to enable RAG export
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card className="bg-surface-canvas border-border-subtle">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Brain className="w-6 h-6 text-brand-primary" />
              <div>
                <CardTitle>RAG Export</CardTitle>
                <CardDescription>
                  Export project for semantic search and AI automation
                </CardDescription>
              </div>
            </div>
            {exportStatus && (
              <Badge
                variant="outline"
                className="border-brand-primary/50 text-brand-primary"
              >
                v{exportStatus.metadata.version}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingStatus ? (
            <div className="flex items-center gap-2 text-text-muted">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading project stats...
            </div>
          ) : exportStatus ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-surface-canvas rounded-lg p-3 border border-border-default">
                <p className="text-2xl font-bold text-white">
                  {exportStatus.stats.element_count}
                </p>
                <p className="text-sm text-text-muted">Elements</p>
              </div>
              <div className="bg-surface-canvas rounded-lg p-3 border border-border-default">
                <p className="text-2xl font-bold text-white">
                  {exportStatus.stats.state_count}
                </p>
                <p className="text-sm text-text-muted">States</p>
              </div>
              <div className="bg-surface-canvas rounded-lg p-3 border border-border-default">
                <p className="text-2xl font-bold text-white">
                  {exportStatus.stats.workflow_count}
                </p>
                <p className="text-sm text-text-muted">Workflows</p>
              </div>
              <div className="bg-surface-canvas rounded-lg p-3 border border-border-default">
                <p className="text-2xl font-bold text-white">
                  {exportStatus.stats.transition_count}
                </p>
                <p className="text-sm text-text-muted">Transitions</p>
              </div>
            </div>
          ) : (
            <p className="text-text-muted">Unable to load project stats</p>
          )}
        </CardContent>
      </Card>

      {/* Export Options */}
      <Card className="bg-surface-canvas border-border-subtle">
        <CardHeader>
          <CardTitle className="text-lg">Export Options</CardTitle>
          <CardDescription>
            Configure what to include in the RAG export
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Include OCR Text</Label>
              <p className="text-sm text-text-muted">
                Include extracted text from elements for text search
              </p>
            </div>
            <Switch
              checked={options.include_ocr}
              onCheckedChange={(checked) =>
                setOptions((prev) => ({ ...prev, include_ocr: checked }))
              }
              data-ui-id="automation-rag-ocr-toggle"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Include Screenshots</Label>
              <p className="text-sm text-text-muted">
                Include full screenshot references (increases file size)
              </p>
            </div>
            <Switch
              checked={options.include_screenshots}
              onCheckedChange={(checked) =>
                setOptions((prev) => ({
                  ...prev,
                  include_screenshots: checked,
                }))
              }
              data-ui-id="automation-rag-screenshots-toggle"
            />
          </div>

          <Separator className="bg-border-default" />

          <div className="space-y-2">
            <Label>Embedding Model</Label>
            <Select
              value={options.embedding_model}
              onValueChange={(value) =>
                setOptions((prev) => ({ ...prev, embedding_model: value }))
              }
            >
              <SelectTrigger className="bg-surface-canvas border-border-default" data-ui-id="automation-rag-model-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all-MiniLM-L6-v2">
                  all-MiniLM-L6-v2 (Fast, 384-dim)
                </SelectItem>
                <SelectItem value="all-mpnet-base-v2">
                  all-mpnet-base-v2 (Balanced, 768-dim)
                </SelectItem>
                <SelectItem value="multi-qa-MiniLM-L6-cos-v1">
                  multi-qa-MiniLM-L6-cos-v1 (QA optimized)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-text-muted">
              Model used for text embeddings in the runner
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Transfer to Runner */}
      <Card className="bg-surface-canvas border-border-subtle">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Monitor className="w-5 h-5 text-brand-primary" />
            <div>
              <CardTitle className="text-lg">Transfer to Runner</CardTitle>
              <CardDescription>
                Send RAG config directly to a connected desktop runner
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {connectionsLoading ? (
            <div className="flex items-center gap-2 text-text-muted">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking for connected runners...
            </div>
          ) : activeConnections && activeConnections.length > 0 ? (
            <>
              <div className="space-y-2">
                <Label>Select Runner</Label>
                <Select
                  value={selectedRunnerId || undefined}
                  onValueChange={setSelectedRunnerId}
                >
                  <SelectTrigger className="bg-surface-canvas border-border-default" data-ui-id="automation-rag-runner-select">
                    <SelectValue placeholder="Choose a runner..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeConnections.map((conn) => (
                      <SelectItem key={conn.id} value={String(conn.id)}>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full" />
                          {conn.runner_name}
                          {conn.project_name && (
                            <span className="text-text-muted">
                              ({conn.project_name})
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleTransferToRunner}
                disabled={isTransferring || !selectedRunnerId}
                className="w-full bg-gradient-to-r from-brand-primary to-brand-secondary hover:opacity-90 text-white"
                data-ui-id="automation-rag-transfer-btn"
              >
                {isTransferring ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Transferring...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Transfer to Runner
                  </>
                )}
              </Button>
            </>
          ) : (
            <div className="bg-surface-canvas rounded-lg p-4 border border-border-default">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5" />
                <div>
                  <p className="font-medium text-yellow-400">
                    No runners connected
                  </p>
                  <p className="text-sm text-text-muted mt-1">
                    Download and connect the Qontinui Runner to transfer configs
                    directly.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 border-border-default"
                    onClick={() => (window.location.href = "/connect-runner")}
                    data-ui-id="automation-rag-connect-btn"
                  >
                    <Monitor className="w-4 h-4 mr-2" />
                    Connect Runner
                  </Button>
                </div>
              </div>
            </div>
          )}

          {(isExporting || isTransferring) && exportProgress > 0 && (
            <div className="space-y-2">
              <Progress value={exportProgress} className="h-2" />
              <p className="text-sm text-text-muted text-center">
                {isTransferring ? "Transferring" : "Exporting"}...{" "}
                {exportProgress}%
              </p>
            </div>
          )}

          {/* Embedding Progress */}
          {embeddingProgress && (
            <div className="bg-surface-canvas rounded-lg p-4 border border-border-default space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4 text-brand-primary" />
                  <span className="font-medium text-white">
                    Generating Embeddings
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className={
                    embeddingProgress.status === "completed"
                      ? "border-green-500/50 text-green-400"
                      : embeddingProgress.status === "failed"
                        ? "border-red-500/50 text-red-400"
                        : "border-brand-primary/50 text-brand-primary"
                  }
                >
                  {embeddingProgress.status}
                </Badge>
              </div>

              {embeddingProgress.status === "in_progress" && (
                <>
                  <Progress
                    value={embeddingProgress.percent || 0}
                    className="h-2"
                  />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-muted">
                      {embeddingProgress.message}
                    </span>
                    <span className="text-text-muted">
                      {embeddingProgress.percent || 0}%
                    </span>
                  </div>
                  {embeddingProgress.elements_processed !== undefined &&
                    embeddingProgress.total_elements !== undefined && (
                      <p className="text-xs text-text-muted">
                        {embeddingProgress.elements_processed} /{" "}
                        {embeddingProgress.total_elements} elements
                      </p>
                    )}
                </>
              )}

              {embeddingProgress.status === "completed" && (
                <div className="flex items-center gap-2 text-green-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-sm">{embeddingProgress.message}</span>
                </div>
              )}

              {embeddingProgress.status === "failed" && (
                <div className="flex items-center gap-2 text-red-400">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm">{embeddingProgress.message}</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Download Export */}
      <Card className="bg-surface-canvas border-border-subtle">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-brand-primary" />
            <div>
              <CardTitle className="text-lg">Download Export</CardTitle>
              <CardDescription>
                Download RAG config as JSON file for manual import
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleDownloadExport}
            disabled={isExporting}
            variant="outline"
            className="w-full border-border-default"
            data-ui-id="automation-rag-download-btn"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Download RAG Config
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Last Export Result */}
      {lastExportResult && (
        <Card
          className={`border ${
            lastExportResult.success
              ? "bg-green-950/20 border-green-500/50"
              : "bg-red-950/20 border-red-500/50"
          }`}
        >
          <CardContent className="flex items-start gap-3 py-4">
            {lastExportResult.success ? (
              <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
            )}
            <div className="flex-1">
              <p
                className={`font-medium ${
                  lastExportResult.success ? "text-green-400" : "text-red-400"
                }`}
              >
                {lastExportResult.success
                  ? "Export Successful"
                  : "Export Failed"}
              </p>
              <p className="text-sm text-text-muted mt-1">
                {lastExportResult.message}
              </p>
              {lastExportResult.elementCount !== undefined && (
                <p className="text-sm text-text-muted mt-1">
                  {lastExportResult.elementCount} elements
                  {lastExportResult.exportSize &&
                    ` | ${formatBytes(lastExportResult.exportSize)}`}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Banner */}
      <Card className="border-blue-500/30 bg-blue-950/20">
        <CardContent className="flex items-start gap-3 py-4">
          <Info className="w-5 h-5 text-blue-400 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-blue-300">About RAG Export</p>
            <p className="text-sm text-blue-200/70 mt-1">
              RAG (Retrieval-Augmented Generation) export creates a
              configuration optimized for AI-powered automation. Elements are
              structured for vector database indexing, enabling semantic search
              to find UI components using natural language queries like
              &quot;login button&quot; or &quot;submit form&quot;.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
