import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAutomation } from "@/contexts/automation-context";
import { ConfigExporter } from "@/lib/config-exporter";
import {
  ragSetupService,
  type RAGSetupProgress,
} from "@/services/rag-setup-service";
import { runnerClient } from "@/lib/runner-client";
import { validateProject } from "@/lib/project-validator";
import type { MonitorValidationError } from "@/lib/monitor-validation";
import type { MonitorUpdate } from "@/components/export/MissingMonitorsDialog";
import {
  cleanAllReferences,
  type CleanupResult,
} from "@/services/project-optimization/reference-cleaner";
import { workflowRepository, transitionRepository } from "@/lib/repositories";
import type { Screenshot } from "@/types/Screenshot";
import type {
  RagStatus,
  UseProjectExportReturn,
} from "../project-export-types";

export function useProjectExport(open: boolean): UseProjectExportReturn {
  const {
    projectId,
    projectName,
    images,
    workflows,
    states,
    transitions,
    categories,
    settings,
    screenshots,
    updateState,
    updateWorkflow,
    updateTransition,
  } = useAutomation();

  const [isExporting, setIsExporting] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [exportName, setExportName] = useState(projectName);
  const [description, setDescription] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(
    null
  );

  // Monitor validation state
  const [monitorValidationErrors, setMonitorValidationErrors] = useState<
    MonitorValidationError[]
  >([]);
  const [showMonitorDialog, setShowMonitorDialog] = useState(false);

  // RAG processing state
  const [ragStatus, setRagStatus] = useState<RagStatus>("idle");
  const [ragProgress, setRagProgress] = useState<RAGSetupProgress | null>(null);
  const [ragError, setRagError] = useState<string | null>(null);
  const ragPollingRef = useRef<NodeJS.Timeout | null>(null);

  // Config loading state (into executor)
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configLoadError, setConfigLoadError] = useState<string | null>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setExportName(projectName);
      setDescription("");
      setValidationErrors([]);
      setCleanupResult(null);
      setRagStatus("idle");
      setRagProgress(null);
      setRagError(null);
      setConfigLoaded(false);
      setConfigLoadError(null);
    }
  }, [open, projectName]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (ragPollingRef.current) {
        clearInterval(ragPollingRef.current);
      }
    };
  }, []);

  const startRagProgressPolling = useCallback((projId: string) => {
    if (ragPollingRef.current) {
      clearInterval(ragPollingRef.current);
    }

    ragPollingRef.current = setInterval(async () => {
      try {
        const progress = await ragSetupService.getRAGSetupProgress(projId);
        setRagProgress(progress);

        if (progress.status === "completed") {
          clearInterval(ragPollingRef.current!);
          ragPollingRef.current = null;
          setRagStatus("completed");
          toast.success("RAG embeddings generated", {
            description: `${progress.elementsProcessed} elements processed`,
          });
        } else if (progress.status === "failed") {
          clearInterval(ragPollingRef.current!);
          ragPollingRef.current = null;
          setRagStatus("failed");
          setRagError(progress.error || "RAG processing failed");
          toast.error("RAG processing failed", {
            description: progress.error || "Unknown error",
          });
        }
      } catch (error) {
        console.error("Failed to poll RAG progress:", error);
      }
    }, 1500);
  }, []);

  const triggerRagProcessing = useCallback(
    async (config: Parameters<typeof ragSetupService.startRAGSetup>[1]) => {
      const ragProjectId =
        projectId ||
        (config.metadata.name || "project")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .substring(0, 50);

      setRagStatus("checking");

      try {
        const isConnected = await ragSetupService.isRunnerConnected();

        if (!isConnected) {
          setRagStatus("skipped");
          toast.info("RAG processing skipped", {
            description:
              "No runner connected. Start qontinui-runner to enable RAG.",
          });
          return;
        }

        const availability = await ragSetupService.checkRAGAvailability();

        if (!availability.available) {
          setRagStatus("skipped");
          toast.info("RAG processing skipped", {
            description: availability.reason || "RAG not available on runner",
          });
          return;
        }

        setRagStatus("processing");
        setRagProgress({
          status: "in_progress",
          percent: 0,
          elementsProcessed: 0,
          totalElements: 0,
        });

        const result = await ragSetupService.startRAGSetup(
          ragProjectId,
          config
        );

        if (result.success) {
          if (result.storagePath) {
            try {
              const loadResult = await runnerClient.loadConfig(
                result.storagePath
              );
              if (loadResult.success) {
                setConfigLoaded(true);
                toast.success("Config loaded into runner", {
                  description: "Ready for automation execution",
                });
              } else {
                setConfigLoadError(loadResult.error || "Failed to load config");
                toast.warning("Config saved but not loaded", {
                  description:
                    loadResult.error || "Could not load into executor",
                });
              }
            } catch (loadError) {
              const errorMsg =
                loadError instanceof Error
                  ? loadError.message
                  : "Unknown error";
              setConfigLoadError(errorMsg);
              toast.warning("Config saved but not loaded", {
                description: errorMsg,
              });
            }
          }

          startRagProgressPolling(ragProjectId);
        } else {
          setRagStatus("failed");
          setRagError(result.message);
          toast.error("Failed to start RAG processing", {
            description: result.message,
          });
        }
      } catch (error) {
        console.error("RAG processing error:", error);
        setRagStatus("failed");
        setRagError(error instanceof Error ? error.message : "Unknown error");
        toast.error("RAG processing failed", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
    [projectId, startRagProgressPolling]
  );

  const handleApplyMonitorUpdates = useCallback(
    (updates: MonitorUpdate[]) => {
      const updatesByState = new Map<string, MonitorUpdate[]>();
      updates.forEach((update) => {
        const existing = updatesByState.get(update.stateId) || [];
        updatesByState.set(update.stateId, [...existing, update]);
      });

      updatesByState.forEach((stateUpdates, stateId) => {
        const state = states.find((s) => s.id === stateId);
        if (!state) return;

        const updatedState = { ...state };

        stateUpdates.forEach((update) => {
          switch (update.elementType) {
            case "image":
              if (updatedState.stateImages) {
                updatedState.stateImages = updatedState.stateImages.map(
                  (img) =>
                    img.id === update.elementId
                      ? { ...img, monitors: update.monitors }
                      : img
                );
              }
              break;
            case "region":
              if (updatedState.regions) {
                updatedState.regions = updatedState.regions.map((reg) =>
                  reg.id === update.elementId
                    ? { ...reg, monitors: update.monitors }
                    : reg
                );
              }
              break;
            case "location":
              if (updatedState.locations) {
                updatedState.locations = updatedState.locations.map((loc) =>
                  loc.id === update.elementId
                    ? { ...loc, monitors: update.monitors }
                    : loc
                );
              }
              break;
            case "string":
              if (updatedState.strings) {
                updatedState.strings = updatedState.strings.map((str) =>
                  str.id === update.elementId
                    ? { ...str, monitors: update.monitors }
                    : str
                );
              }
              break;
          }
        });

        updateState(updatedState);
      });

      const validationResult = validateProject({
        workflows,
        states,
        transitions,
        images,
      });

      if (validationResult.monitorErrors.length === 0) {
        toast.success("All elements now have monitors assigned");
        setTimeout(() => {
          handleExport();
        }, 100);
      } else {
        toast.warning(
          `${validationResult.monitorErrors.length} element(s) still need monitors`
        );
        setMonitorValidationErrors(validationResult.monitorErrors);
        setShowMonitorDialog(true);
      }
    },
    // Note: handleExport is intentionally excluded - it's called via setTimeout which uses the current closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [states, updateState, workflows, transitions, images]
  );

  const handleFixIssues = useCallback(async () => {
    setIsFixing(true);
    setCleanupResult(null);

    try {
      const {
        workflows: cleanedWorkflows,
        transitions: cleanedTransitions,
        result,
      } = cleanAllReferences(workflows, transitions);

      for (const workflow of cleanedWorkflows) {
        const originalWorkflow = workflows.find((w) => w.id === workflow.id);
        if (
          originalWorkflow &&
          JSON.stringify(originalWorkflow.connections) !==
            JSON.stringify(workflow.connections)
        ) {
          await updateWorkflow(workflow);
          await workflowRepository.update({ ...workflow, projectName });
        }
      }

      for (const transition of cleanedTransitions) {
        const originalTransition = transitions.find(
          (t) => t.id === transition.id
        );
        if (
          originalTransition &&
          JSON.stringify(originalTransition.workflows) !==
            JSON.stringify(transition.workflows)
        ) {
          await updateTransition(transition);
          await transitionRepository.update({ ...transition, projectName });
        }
      }

      setCleanupResult(result);
      setValidationErrors([]);
    } catch (error) {
      console.error("Failed to fix issues:", error);
      toast.error("Failed to fix issues", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsFixing(false);
    }
  }, [workflows, transitions, updateWorkflow, updateTransition, projectName]);

  const handleExport = useCallback(
    async (loadToRunner: boolean = true) => {
      const validationResult = validateProject({
        workflows,
        states,
        transitions,
        images,
      });

      if (validationResult.monitorErrors.length > 0) {
        setMonitorValidationErrors(validationResult.monitorErrors);
        setShowMonitorDialog(true);
        toast.error("Monitor validation failed", {
          description: `${validationResult.monitorErrors.length} element(s) need monitor assignments`,
        });
        return;
      }

      const nonMonitorErrors = validationResult.issues.filter(
        (i) => i.severity === "error" && i.category !== "monitor"
      );

      if (nonMonitorErrors.length > 0) {
        setValidationErrors(nonMonitorErrors.map((e) => e.message));
        toast.error("Validation failed", {
          description: `${nonMonitorErrors.length} error(s) must be fixed before export`,
        });
        return;
      }

      setIsExporting(true);
      setValidationErrors([]);
      setRagStatus("idle");
      setRagProgress(null);
      setRagError(null);

      try {
        const exporter = new ConfigExporter();

        const config = await exporter.exportConfiguration(
          images,
          workflows,
          states,
          transitions,
          categories,
          {
            name: exportName || projectName,
            description: description || undefined,
            created: new Date().toISOString(),
            projectId: projectId || undefined,
          },
          settings,
          screenshots as unknown as Screenshot[]
        );

        const warnings = validationResult.issues.filter(
          (i) => i.severity === "warning"
        );
        if (warnings.length > 0) {
          setValidationErrors(warnings.map((w) => w.message));
          toast.warning("Export completed with warnings", {
            description: `${warnings.length} warning(s) found`,
          });
        }

        const filename = `${(exportName || projectName).replace(/[^a-zA-Z0-9-_]/g, "_")}_config.json`;
        exporter.downloadConfiguration(config, filename);

        toast.success("Project exported successfully", {
          description: `Saved as ${filename}`,
        });

        if (loadToRunner) {
          triggerRagProcessing(config);
        }
      } catch (error) {
        console.error("Export failed:", error);
        toast.error("Export failed", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        setIsExporting(false);
      }
    },
    [
      exportName,
      description,
      projectName,
      projectId,
      images,
      workflows,
      states,
      transitions,
      categories,
      settings,
      screenshots,
      triggerRagProcessing,
    ]
  );

  return {
    isExporting,
    isFixing,
    exportName,
    description,
    validationErrors,
    cleanupResult,
    monitorValidationErrors,
    showMonitorDialog,
    ragStatus,
    ragProgress,
    ragError,
    configLoaded,
    configLoadError,
    setExportName,
    setDescription,
    setShowMonitorDialog,
    handleExport,
    handleFixIssues,
    handleApplyMonitorUpdates,
  };
}
