/**
 * ProjectExportDialog Component
 *
 * Exports the entire project configuration as a JSON file
 * that can be imported into qontinui-runner.
 *
 * After export, automatically sends the config to the runner for
 * RAG embedding generation if a runner is connected.
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Download,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Brain,
  Wrench,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useAutomation } from "@/contexts/automation-context";
import { ConfigExporter } from "@/lib/config-exporter";
import {
  ragSetupService,
  type RAGSetupProgress,
} from "@/services/rag-setup-service";
import { runnerClient } from "@/lib/runner-client";
import { validateProject } from "@/lib/project-validator";
import { type MonitorValidationError } from "@/lib/monitor-validation";
import {
  MissingMonitorsDialog,
  type MonitorUpdate,
} from "@/components/export/MissingMonitorsDialog";
import {
  cleanAllReferences,
  type CleanupResult,
} from "@/services/project-optimization/reference-cleaner";
import { workflowRepository, transitionRepository } from "@/lib/repositories";
import type { Screenshot } from "@/types/Screenshot";

export interface ProjectExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectExportDialog({
  open,
  onOpenChange,
}: ProjectExportDialogProps) {
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
  const [ragStatus, setRagStatus] = useState<
    "idle" | "checking" | "processing" | "completed" | "failed" | "skipped"
  >("idle");
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

  /**
   * Start polling for RAG setup progress
   */
  const startRagProgressPolling = useCallback((projectId: string) => {
    // Clear any existing polling
    if (ragPollingRef.current) {
      clearInterval(ragPollingRef.current);
    }

    ragPollingRef.current = setInterval(async () => {
      try {
        const progress = await ragSetupService.getRAGSetupProgress(projectId);
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
        // Don't stop polling on transient errors
      }
    }, 1500); // Poll every 1.5 seconds
  }, []);

  /**
   * Trigger RAG processing on the runner
   */
  const triggerRagProcessing = useCallback(
    async (config: Parameters<typeof ragSetupService.startRAGSetup>[1]) => {
      // Use actual project UUID for proper backend sync
      // Fall back to sanitized name only if no projectId exists
      const ragProjectId =
        projectId ||
        (config.metadata.name || "project")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .substring(0, 50);

      setRagStatus("checking");

      try {
        // Check if runner is connected
        const isConnected = await ragSetupService.isRunnerConnected();

        if (!isConnected) {
          setRagStatus("skipped");
          toast.info("RAG processing skipped", {
            description:
              "No runner connected. Start qontinui-runner to enable RAG.",
          });
          return;
        }

        // Check RAG availability
        const availability = await ragSetupService.checkRAGAvailability();

        if (!availability.available) {
          setRagStatus("skipped");
          toast.info("RAG processing skipped", {
            description: availability.reason || "RAG not available on runner",
          });
          return;
        }

        // Start RAG setup
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
          // Load the config into the executor using the storage path
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

          // Start polling for RAG progress
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

  /**
   * Handle applying monitor updates from the MissingMonitorsDialog
   */
  const handleApplyMonitorUpdates = useCallback(
    (updates: MonitorUpdate[]) => {
      // Group updates by state
      const updatesByState = new Map<string, MonitorUpdate[]>();
      updates.forEach((update) => {
        const existing = updatesByState.get(update.stateId) || [];
        updatesByState.set(update.stateId, [...existing, update]);
      });

      // Apply updates to each state
      updatesByState.forEach((stateUpdates, stateId) => {
        const state = states.find((s) => s.id === stateId);
        if (!state) return;

        const updatedState = { ...state };

        // Apply updates to each element type
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

      // Re-validate after updates using consolidated validator
      const validationResult = validateProject({
        workflows,
        states,
        transitions,
        images,
      });

      if (validationResult.monitorErrors.length === 0) {
        toast.success("All elements now have monitors assigned");
        // Automatically trigger export after fixing
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

  /**
   * Handle fixing broken references in workflows and transitions
   */
  const handleFixIssues = useCallback(async () => {
    setIsFixing(true);
    setCleanupResult(null);

    try {
      const {
        workflows: cleanedWorkflows,
        transitions: cleanedTransitions,
        result,
      } = cleanAllReferences(workflows, transitions);

      // Update all cleaned workflows - both context state AND directly persist to IndexedDB
      for (const workflow of cleanedWorkflows) {
        const originalWorkflow = workflows.find((w) => w.id === workflow.id);
        if (
          originalWorkflow &&
          JSON.stringify(originalWorkflow.connections) !==
            JSON.stringify(workflow.connections)
        ) {
          // Update context state (for immediate UI update)
          await updateWorkflow(workflow);

          // Also persist directly to IndexedDB via repository (guaranteed persistence)
          // This bypasses the debounced subscription which may not fire reliably
          await workflowRepository.update({ ...workflow, projectName });
        }
      }

      // Update all cleaned transitions - both context state AND directly persist to IndexedDB
      for (const transition of cleanedTransitions) {
        const originalTransition = transitions.find(
          (t) => t.id === transition.id
        );
        if (
          originalTransition &&
          JSON.stringify(originalTransition.workflows) !==
            JSON.stringify(transition.workflows)
        ) {
          // Update context state (for immediate UI update)
          await updateTransition(transition);

          // Also persist directly to IndexedDB via repository (guaranteed persistence)
          await transitionRepository.update({ ...transition, projectName });
        }
      }

      // Store the result to display in the dialog
      setCleanupResult(result);

      // Clear validation errors since we fixed them
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
      // First, run consolidated validation (same as Verify button)
      const validationResult = validateProject({
        workflows,
        states,
        transitions,
        images,
      });

      // Check for monitor validation errors specifically (need separate dialog for fixing)
      if (validationResult.monitorErrors.length > 0) {
        setMonitorValidationErrors(validationResult.monitorErrors);
        setShowMonitorDialog(true);
        toast.error("Monitor validation failed", {
          description: `${validationResult.monitorErrors.length} element(s) need monitor assignments`,
        });
        return;
      }

      // Check for other errors (excluding monitor errors)
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

        // Export full configuration
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
            projectId: projectId || undefined, // Include project ID for test run reporting
          },
          settings,
          screenshots as unknown as Screenshot[] // Type cast needed: context uses different Screenshot type than ConfigExporter
        );

        // Show warnings if any (don't block export)
        const warnings = validationResult.issues.filter(
          (i) => i.severity === "warning"
        );
        if (warnings.length > 0) {
          setValidationErrors(warnings.map((w) => w.message));
          toast.warning("Export completed with warnings", {
            description: `${warnings.length} warning(s) found`,
          });
        }

        // Download the configuration
        const filename = `${(exportName || projectName).replace(/[^a-zA-Z0-9-_]/g, "_")}_config.json`;
        exporter.downloadConfiguration(config, filename);

        toast.success("Project exported successfully", {
          description: `Saved as ${filename}`,
        });

        // Trigger RAG processing and load to runner (only if loadToRunner is true)
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px] bg-surface-canvas border-border-subtle">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-brand-primary" />
              Export & Load to Runner
            </DialogTitle>
            <DialogDescription>
              Export the project configuration and load it into the
              qontinui-runner for automation execution.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Project Name */}
            <div className="space-y-2">
              <Label htmlFor="exportName">Project Name</Label>
              <Input
                id="exportName"
                value={exportName}
                onChange={(e) => setExportName(e.target.value)}
                placeholder="Enter project name"
                className="bg-surface-canvas border-border-default"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description for this export..."
                className="bg-surface-canvas border-border-default min-h-[80px]"
              />
            </div>

            {/* Export Summary */}
            <div className="bg-surface-canvas rounded-lg p-4 space-y-2">
              <h4 className="text-sm font-medium text-text-muted">
                Export Summary
              </h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between text-text-muted">
                  <span>Workflows:</span>
                  <span className="text-white">{workflows.length}</span>
                </div>
                <div className="flex justify-between text-text-muted">
                  <span>States:</span>
                  <span className="text-white">{states.length}</span>
                </div>
                <div className="flex justify-between text-text-muted">
                  <span>Transitions:</span>
                  <span className="text-white">{transitions.length}</span>
                </div>
                <div className="flex justify-between text-text-muted">
                  <span>Images:</span>
                  <span className="text-white">{images.length}</span>
                </div>
                <div className="flex justify-between text-text-muted">
                  <span>Screenshots:</span>
                  <span className="text-white">{screenshots.length}</span>
                </div>
                <div className="flex justify-between text-text-muted">
                  <span>Categories:</span>
                  <span className="text-white">{categories.length}</span>
                </div>
              </div>
            </div>

            {/* Validation Errors */}
            {validationErrors.length > 0 && (
              <div className="bg-yellow-950/30 border border-yellow-800 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-yellow-500">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">
                      Validation Warnings
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFixIssues}
                    disabled={isFixing}
                    className="border-yellow-700 text-yellow-500 hover:bg-yellow-950/50"
                  >
                    {isFixing ? (
                      <>
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        Fixing...
                      </>
                    ) : (
                      <>
                        <Wrench className="w-3 h-3 mr-1" />
                        Fix Issues
                      </>
                    )}
                  </Button>
                </div>
                <ul className="text-sm text-yellow-400 space-y-1 list-disc list-inside">
                  {validationErrors.slice(0, 5).map((error, i) => (
                    <li key={i}>{error}</li>
                  ))}
                  {validationErrors.length > 5 && (
                    <li>...and {validationErrors.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}

            {/* Cleanup Report */}
            {cleanupResult && (
              <div className="bg-green-950/30 border border-green-700 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 text-green-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    Issues Fixed Successfully
                  </span>
                </div>

                {cleanupResult.workflowConnectionsCleaned +
                  cleanupResult.transitionWorkflowsCleaned >
                0 ? (
                  <div className="space-y-2">
                    <div className="text-sm text-green-300">
                      <span className="font-medium">Summary:</span>
                      <ul className="mt-1 ml-4 list-disc list-inside text-green-400/90">
                        {cleanupResult.workflowConnectionsCleaned > 0 && (
                          <li>
                            Removed {cleanupResult.workflowConnectionsCleaned}{" "}
                            orphaned workflow connection
                            {cleanupResult.workflowConnectionsCleaned !== 1
                              ? "s"
                              : ""}
                          </li>
                        )}
                        {cleanupResult.transitionWorkflowsCleaned > 0 && (
                          <li>
                            Removed {cleanupResult.transitionWorkflowsCleaned}{" "}
                            orphaned transition workflow reference
                            {cleanupResult.transitionWorkflowsCleaned !== 1
                              ? "s"
                              : ""}
                          </li>
                        )}
                      </ul>
                    </div>

                    {cleanupResult.details.length > 0 && (
                      <div className="text-xs text-green-400/70 mt-2">
                        <span className="font-medium">Details:</span>
                        <ul className="mt-1 ml-4 space-y-0.5 max-h-32 overflow-y-auto">
                          {cleanupResult.details
                            .slice(0, 10)
                            .map((detail, i) => (
                              <li key={i}>
                                {detail.type === "workflow-connection"
                                  ? `Workflow "${detail.sourceName || detail.sourceId}": ${detail.reason}`
                                  : `Transition "${detail.sourceId}": ${detail.reason}`}
                              </li>
                            ))}
                          {cleanupResult.details.length > 10 && (
                            <li className="text-green-400/50">
                              ...and {cleanupResult.details.length - 10} more
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-green-400/90">
                    No issues were found. All references are valid.
                  </p>
                )}
              </div>
            )}

            {/* RAG Processing Status */}
            {ragStatus !== "idle" && (
              <div
                className={`rounded-lg p-4 space-y-3 border ${
                  ragStatus === "completed"
                    ? "bg-green-950/30 border-green-700"
                    : ragStatus === "failed"
                      ? "bg-red-950/30 border-red-700"
                      : ragStatus === "skipped"
                        ? "bg-surface-canvas border-border-default"
                        : "bg-brand-primary/10 border-brand-primary/30"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Brain
                      className={`w-4 h-4 ${
                        ragStatus === "completed"
                          ? "text-green-400"
                          : ragStatus === "failed"
                            ? "text-red-400"
                            : ragStatus === "skipped"
                              ? "text-text-muted"
                              : "text-brand-primary"
                      }`}
                    />
                    <span className="font-medium text-white text-sm">
                      RAG Processing
                    </span>
                  </div>
                  {ragStatus === "checking" && (
                    <span className="text-xs text-text-muted">
                      Checking runner...
                    </span>
                  )}
                  {ragStatus === "processing" && (
                    <Loader2 className="w-4 h-4 animate-spin text-brand-primary" />
                  )}
                  {ragStatus === "completed" && (
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                  )}
                  {ragStatus === "failed" && (
                    <AlertCircle className="w-4 h-4 text-red-400" />
                  )}
                  {ragStatus === "skipped" && (
                    <span className="text-xs text-text-muted">Skipped</span>
                  )}
                </div>

                {/* Progress bar for processing */}
                {ragStatus === "processing" && ragProgress && (
                  <div className="space-y-2">
                    <Progress
                      value={ragProgress.percent || 0}
                      className="h-2"
                    />
                    <div className="flex justify-between text-xs text-text-muted">
                      <span>
                        {ragProgress.currentElement || "Processing elements..."}
                      </span>
                      <span>
                        {ragProgress.elementsProcessed}/
                        {ragProgress.totalElements}
                      </span>
                    </div>
                  </div>
                )}

                {/* Completion message */}
                {ragStatus === "completed" && ragProgress && (
                  <p className="text-sm text-green-400">
                    {ragProgress.elementsProcessed} elements processed. RAG
                    search is now available in the runner.
                  </p>
                )}

                {/* Skipped message */}
                {ragStatus === "skipped" && (
                  <p className="text-sm text-text-muted">
                    RAG processing was skipped. Start qontinui-runner to enable
                    semantic search.
                  </p>
                )}

                {/* Error message */}
                {ragStatus === "failed" && ragError && (
                  <p className="text-sm text-red-400">{ragError}</p>
                )}
              </div>
            )}

            {/* Config Loading Status */}
            {(configLoaded || configLoadError) && (
              <div
                className={`rounded-lg p-4 space-y-3 border ${
                  configLoaded
                    ? "bg-green-950/30 border-green-700"
                    : "bg-yellow-950/30 border-yellow-700"
                }`}
              >
                <div className="flex items-center gap-2">
                  {configLoaded ? (
                    <>
                      <Upload className="w-4 h-4 text-green-400" />
                      <span className="font-medium text-green-400 text-sm">
                        Config Loaded to Runner
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 text-yellow-400" />
                      <span className="font-medium text-yellow-400 text-sm">
                        Config Not Loaded
                      </span>
                    </>
                  )}
                </div>
                {configLoaded ? (
                  <p className="text-sm text-green-400/90">
                    Configuration is loaded into the runner and ready for
                    automation execution.
                  </p>
                ) : (
                  <p className="text-sm text-yellow-400/90">
                    {configLoadError ||
                      "Config was exported but could not be loaded into the runner."}
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border-default"
              disabled={ragStatus === "processing" || ragStatus === "checking"}
            >
              {ragStatus === "completed" ||
              ragStatus === "failed" ||
              ragStatus === "skipped"
                ? "Close"
                : "Cancel"}
            </Button>
            {ragStatus === "idle" && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleExport(false)}
                  disabled={isExporting || !exportName.trim()}
                  className="border-border-default hover:bg-surface-raised"
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      Export Only
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => handleExport(true)}
                  disabled={isExporting || !exportName.trim()}
                  className="bg-brand-primary hover:bg-brand-primary/80 text-black"
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Export & Load
                    </>
                  )}
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Missing Monitors Dialog */}
      <MissingMonitorsDialog
        open={showMonitorDialog}
        onOpenChange={setShowMonitorDialog}
        errors={monitorValidationErrors}
        onApply={handleApplyMonitorUpdates}
      />
    </>
  );
}
