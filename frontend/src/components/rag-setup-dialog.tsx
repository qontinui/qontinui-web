"use client";

import { useRunnerPoll, useRunnerTarget } from "@/lib/runner";
import { useNewWorkRefusal } from "@/contexts/active-runner-context";
import { useState, useEffect, useCallback } from "react";
import { createLogger } from "@/lib/logger";

const log = createLogger("RAGSetupDialog");
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Download,
  AlertCircle,
} from "lucide-react";
import {
  useRAGSetupService,
  type RAGSetupProgress,
  type RAGAvailability,
} from "@/services/rag-setup-service";
import type { QontinuiConfig } from "@/lib/export-schema";

type DialogState = "checking" | "initial" | "processing" | "complete" | "error";

interface RAGSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  config: QontinuiConfig;
  onSetupComplete?: (embeddings: RAGSetupProgress) => void;
  onSkip?: () => void;
  onDownload?: () => void;
}

export function RAGSetupDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  config,
  onSetupComplete,
  onSkip,
  onDownload,
}: RAGSetupDialogProps) {
  const ragSetupService = useRAGSetupService();
  const target = useRunnerTarget();
  // Starting RAG setup runs embedding / AI jobs — NEW work.
  const newWorkRefusal = useNewWorkRefusal();
  const [state, setState] = useState<DialogState>("checking");
  const [availability, setAvailability] = useState<RAGAvailability | null>(
    null
  );
  const [progress, setProgress] = useState<RAGSetupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Whether the setup-progress poll runs (only while the dialog is open).
  const [isPolling, setIsPolling] = useState(false);

  // Count StateImages that will be processed
  const elementCount =
    config.states?.reduce(
      (count, state) => count + (state.stateImages?.length || 0),
      0
    ) || 0;

  // Check RAG availability when dialog opens
  useEffect(() => {
    if (open) {
      checkAvailability();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const checkAvailability = async () => {
    setState("checking");
    try {
      log.debug("Checking runner connection...");
      const isConnected = await ragSetupService.isRunnerConnected();
      log.debug("Runner connected:", isConnected);

      if (!isConnected) {
        setAvailability({
          available: false,
          models: { clip: false, text: false, ocr: false },
          reason: "Runner is not connected",
        });
        setState("initial");
        return;
      }

      log.debug("Checking RAG availability...");
      const result = await ragSetupService.checkRAGAvailability();
      log.debug("Availability result:", result);
      setAvailability(result);
      setState("initial");
    } catch (err) {
      console.error("[RAG] Availability check failed:", err);
      // Even if availability check fails, allow user to try setup
      // The import endpoint may still work
      setAvailability({
        available: true, // Allow setup attempt even on check failure
        models: { clip: false, text: false, ocr: false },
        reason: "Availability check failed - setup may still work",
      });
      setState("initial");
    }
  };

  const startSetup = async () => {
    if (newWorkRefusal !== null) {
      setError(newWorkRefusal);
      setState("error");
      return;
    }
    log.debug("Starting setup for project:", projectId);
    setState("processing");
    setError(null);
    setProgress({
      status: "in_progress",
      percent: 0,
      elementsProcessed: 0,
      totalElements: elementCount,
    });

    try {
      log.debug(
        "Calling startRAGSetup, stateCount:",
        config.states?.length || 0
      );
      const result = await ragSetupService.startRAGSetup(projectId, config);
      log.debug("startRAGSetup result:", result);

      // Start polling for progress
      setIsPolling(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start RAG setup"
      );
      setState("error");
    }
  };

  // Setup progress poll: the cadence is re-evaluated every tick (never faster
  // than the relay cadence for a relayed or unresolved target), and a
  // RUNNER_NEEDS_LOCAL refusal stops it with its message shown.
  useRunnerPoll(target, {
    enabled: open && isPolling,
    requestedMs: 1000,
    tick: async () => {
      const currentProgress =
        await ragSetupService.getRAGSetupProgress(projectId);
      setProgress(currentProgress);

      if (currentProgress.status === "completed") {
        setIsPolling(false);
        setState("complete");
        onSetupComplete?.(currentProgress);
        return "stop";
      }
      if (currentProgress.status === "failed") {
        setIsPolling(false);
        setError(currentProgress.error || "RAG setup failed");
        setState("error");
        return "stop";
      }
      return undefined;
    },
    onNeedsLocal: (err) => {
      setIsPolling(false);
      setError(err.message);
      setState("error");
    },
    // Don't fail on other poll errors, just log them
    onError: (err) => console.warn("Progress poll failed:", err),
  });

  const cancelSetup = useCallback(async () => {
    setIsPolling(false);
    try {
      await ragSetupService.cancelRAGSetup(projectId);
    } catch {
      // Ignore cancel errors
    }
    setState("initial");
  }, [projectId, ragSetupService]);

  const handleSkip = () => {
    onSkip?.();
    onOpenChange(false);
  };

  const handleDownload = () => {
    onDownload?.();
    onOpenChange(false);
  };

  const handleClose = () => {
    if (state === "processing") {
      // Don't close while processing, require explicit cancel
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={state !== "processing"}
      >
        {state === "checking" && (
          <>
            <DialogHeader>
              <DialogTitle>Checking RAG Availability</DialogTitle>
              <DialogDescription>
                Checking if the runner has ML models available...
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          </>
        )}

        {state === "initial" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-500" />
                Setup RAG for Faster Element Finding
              </DialogTitle>
              <DialogDescription>
                Generate vector embeddings for your {elementCount} StateImage
                {elementCount !== 1 ? "s" : ""} to enable AI-powered element
                finding.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {availability && (
                <div className="rounded-lg border p-4 space-y-3">
                  <h4 className="text-sm font-medium">Model Availability</h4>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <ModelStatus
                      name="CLIP"
                      available={availability.models.clip}
                    />
                    <ModelStatus
                      name="Text"
                      available={availability.models.text}
                    />
                    <ModelStatus
                      name="OCR"
                      available={availability.models.ocr}
                    />
                  </div>
                  {!availability.available && availability.reason && (
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-yellow-500" />
                      {availability.reason}
                    </p>
                  )}
                </div>
              )}

              <div className="text-sm text-muted-foreground space-y-2">
                <p>RAG setup will:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Generate CLIP image embeddings for pattern matching</li>
                  <li>Extract OCR text from images</li>
                  <li>Create text embeddings from descriptions</li>
                  <li>Save everything to your local runner</li>
                </ul>
              </div>

              {newWorkRefusal && (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="rag-setup-refusal"
                >
                  {newWorkRefusal}
                </p>
              )}
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={handleSkip}
                className="w-full sm:w-auto"
              >
                Skip
              </Button>
              <Button
                variant="outline"
                onClick={handleDownload}
                className="w-full sm:w-auto"
              >
                <Download className="mr-2 h-4 w-4" />
                Just Download
              </Button>
              <Button
                onClick={startSetup}
                disabled={!availability?.available || newWorkRefusal !== null}
                title={newWorkRefusal ?? undefined}
                className="w-full sm:w-auto"
              >
                <Zap className="mr-2 h-4 w-4" />
                Setup RAG
              </Button>
            </DialogFooter>
          </>
        )}

        {state === "processing" && progress && (
          <>
            <DialogHeader>
              <DialogTitle>Setting Up RAG</DialogTitle>
              <DialogDescription>
                Processing {elementCount} StateImage
                {elementCount !== 1 ? "s" : ""} for &quot;{projectName}&quot;
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <Progress value={progress.percent} max={100} />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>
                  {progress.elementsProcessed} / {progress.totalElements}{" "}
                  elements
                </span>
                <span>{Math.round(progress.percent)}%</span>
              </div>
              {progress.currentElement && (
                <p className="text-sm text-muted-foreground">
                  Processing: {progress.currentElement}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="destructive" onClick={cancelSetup}>
                Cancel
              </Button>
            </DialogFooter>
          </>
        )}

        {state === "complete" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-5 w-5" />
                RAG Setup Complete
              </DialogTitle>
              <DialogDescription>
                Successfully processed{" "}
                {progress?.elementsProcessed || elementCount} StateImage
                {(progress?.elementsProcessed || elementCount) !== 1 ? "s" : ""}
                .
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 space-y-3">
              <div className="rounded-lg bg-green-50 dark:bg-green-950/30 p-4 text-sm">
                <p className="text-green-700 dark:text-green-300">
                  Your project configuration has been saved to the runner with
                  vector embeddings. RAG-powered finding is now available.
                </p>
              </div>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={handleDownload}
                className="w-full sm:w-auto"
              >
                <Download className="mr-2 h-4 w-4" />
                Download Config
              </Button>
              <Button
                onClick={() => onOpenChange(false)}
                className="w-full sm:w-auto"
              >
                Done
              </Button>
            </DialogFooter>
          </>
        )}

        {state === "error" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <XCircle className="h-5 w-5" />
                RAG Setup Failed
              </DialogTitle>
              <DialogDescription>{error}</DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <div className="rounded-lg bg-red-50 dark:bg-red-950/30 p-4 text-sm">
                <p className="text-red-700 dark:text-red-300">
                  The RAG setup process encountered an error. You can still
                  download the configuration without embeddings.
                </p>
              </div>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setState("initial")}
                className="w-full sm:w-auto"
              >
                Try Again
              </Button>
              <Button
                variant="outline"
                onClick={handleDownload}
                className="w-full sm:w-auto"
              >
                <Download className="mr-2 h-4 w-4" />
                Download Anyway
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ModelStatus({
  name,
  available,
}: {
  name: string;
  available: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {available ? (
        <CheckCircle2 className="h-4 w-4 text-green-500" />
      ) : (
        <XCircle className="h-4 w-4 text-text-muted" />
      )}
      <span className={available ? "text-foreground" : "text-muted-foreground"}>
        {name}
      </span>
    </div>
  );
}
