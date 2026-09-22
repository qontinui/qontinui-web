"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ragExportService } from "@/services/service-factory";
import type {
  RAGExportRequest,
  RAGExportStatus,
  EmbeddingProgress,
} from "@/services/rag-export-service";
import type { Runner } from "@qontinui/shared-types";
import {
  runnerLoopbackUrl,
  useRunnerPoll,
  useRunnerTarget,
} from "@/lib/runner";
import type { ExportResult, UseRagExportReturn } from "./types";

export function useRagExport(projectId: string | null): UseRagExportReturn {
  const target = useRunnerTarget();
  const [exportStatus, setExportStatus] = useState<RAGExportStatus | null>(
    null
  );
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [embeddingProgress, setEmbeddingProgress] =
    useState<EmbeddingProgress | null>(null);
  const [lastExportResult, setLastExportResult] = useState<ExportResult | null>(
    null
  );

  const [options, setOptions] = useState<RAGExportRequest>({
    include_ocr: true,
    include_screenshots: false,
    embedding_model: "all-MiniLM-L6-v2",
  });

  const [selectedRunnerId, setSelectedRunnerId] = useState<string | null>(null);
  // The embedding-progress poll in flight (null = not polling).
  const [embeddingPoll, setEmbeddingPoll] = useState<{
    runnerUrl: string;
    projectId: string;
    deadline: number;
  } | null>(null);

  useEffect(() => {
    if (projectId) {
      loadExportStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadExportStatus is defined below and depends on projectId
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

  const startPollingEmbeddingProgress = (
    runnerUrl: string,
    pollingProjectId: string
  ) => {
    // Give up after 10 minutes.
    setEmbeddingPoll({
      runnerUrl,
      projectId: pollingProjectId,
      deadline: Date.now() + 600000,
    });
  };

  // Embedding progress poll. The cadence is re-evaluated every tick (never
  // faster than the relay cadence for a relayed or unresolved target), and a
  // RUNNER_NEEDS_LOCAL refusal stops it with its message shown.
  useRunnerPoll(target, {
    enabled: embeddingPoll !== null,
    requestedMs: 2000,
    tick: async () => {
      if (embeddingPoll === null || Date.now() > embeddingPoll.deadline) {
        setEmbeddingPoll(null);
        return "stop";
      }
      const progress = await ragExportService.getEmbeddingProgress(
        embeddingPoll.runnerUrl,
        embeddingPoll.projectId
      );
      setEmbeddingProgress(progress);

      if (progress.status === "completed" || progress.status === "failed") {
        setEmbeddingPoll(null);
        if (progress.status === "completed") {
          toast.success("Embeddings generated successfully");
        } else {
          toast.error(`Embedding generation failed: ${progress.message}`);
        }
        return "stop";
      }
      return undefined;
    },
    onNeedsLocal: (error) => {
      setEmbeddingPoll(null);
      toast.error(error.message);
    },
    onError: (error) => {
      console.error("Failed to poll embedding progress:", error);
    },
  });

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

  const handleTransferToRunner = async (runners: Runner[]) => {
    if (!projectId) {
      toast.error("No project selected");
      return;
    }

    if (!selectedRunnerId) {
      toast.error("Please select a runner");
      return;
    }

    const selectedRunner = runners.find((r) => r.id === selectedRunnerId);
    if (!selectedRunner) {
      toast.error("Selected runner not found");
      return;
    }

    // The backend delivers the config by POSTing to `runner_url` itself, so
    // it must name the selected runner's own address. That exists only for
    // the active runner, and only when it is proven to be on this machine
    // (a loopback route) — a relayed runner has no address the backend
    // could post to, and a guessed default port may be another box's runner.
    if (target.kind === "runner" && target.runner.id !== selectedRunner.id) {
      const message = `Make ${selectedRunner.name} the active runner to transfer to it.`;
      toast.error(message);
      setLastExportResult({ success: false, message });
      return;
    }
    const runnerUrl = runnerLoopbackUrl(target, "");
    if (!runnerUrl) {
      const message =
        "Transfer to runner needs the runner on this machine — the selected runner is not reachable locally.";
      toast.error(message);
      setLastExportResult({ success: false, message });
      return;
    }

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
          message: `Transferred to ${selectedRunner.name}`,
          elementCount: result.element_count,
          exportSize: result.export_size_bytes,
        });

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

  return {
    exportStatus,
    isLoadingStatus,
    isExporting,
    isTransferring,
    exportProgress,
    embeddingProgress,
    lastExportResult,
    options,
    setOptions,
    selectedRunnerId,
    setSelectedRunnerId,
    handleDownloadExport,
    handleTransferToRunner,
  };
}
