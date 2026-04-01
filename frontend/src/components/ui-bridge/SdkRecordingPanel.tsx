"use client";

/**
 * SDK Recording Panel
 *
 * Recording panel for UI Bridge-connected apps using the embedded SDK.
 * Records user interactions via WebSocket, processes through the pipeline,
 * and displays discovered states, transitions, and generated playbooks.
 */

import { useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Circle,
  Square,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Workflow,
  FileText,
  Copy,
} from "lucide-react";
import type {
  RecordingPipelineResult,
  PipelineDiscoveryResult,
} from "@/hooks/useUIBridgeRecording";
import { RecordingStateGraph } from "./RecordingStateGraph";

interface SdkRecordingPanelProps {
  /** WebSocket URL of the UI Bridge SDK */
  wsUrl: string;
  /** API base URL for the pipeline backend */
  apiBaseUrl: string;
  /** Application name (for playbook triggers) */
  appName?: string;
  /** Application URL (for playbook triggers) */
  appUrl?: string;
  /** Start SDK recording */
  onStartRecording: (wsUrl: string) => Promise<{ success: boolean; error?: string }>;
  /** Stop SDK recording */
  onStopRecording: (wsUrl: string) => Promise<{
    success: boolean;
    result?: RecordingPipelineResult;
    error?: string;
  }>;
  /** Process recording through pipeline */
  onProcessRecording: (
    apiBaseUrl: string,
    options?: {
      generatePlaybook?: boolean;
      appName?: string;
      appUrl?: string;
    }
  ) => Promise<{ success: boolean; result?: PipelineDiscoveryResult; error?: string }>;
  /** Whether currently recording */
  isRecording: boolean;
  /** Whether starting */
  isStarting: boolean;
  /** Whether stopping */
  isStopping: boolean;
  /** Whether processing pipeline */
  isProcessing: boolean;
  /** SDK recording result (available after stop) */
  sdkResult: RecordingPipelineResult | null;
  /** Pipeline result (available after processing) */
  pipelineResult: PipelineDiscoveryResult | null;
  /** Error message */
  error: string | null;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function SdkRecordingPanel({
  wsUrl,
  apiBaseUrl,
  appName,
  appUrl,
  onStartRecording,
  onStopRecording,
  onProcessRecording,
  isRecording,
  isStarting,
  isStopping,
  isProcessing,
  sdkResult,
  pipelineResult,
  error,
}: SdkRecordingPanelProps) {
  const generatePlaybook = true;
  const [copiedPlaybook, setCopiedPlaybook] = useState(false);

  const handleStart = useCallback(async () => {
    await onStartRecording(wsUrl);
  }, [onStartRecording, wsUrl]);

  const handleStop = useCallback(async () => {
    await onStopRecording(wsUrl);
  }, [onStopRecording, wsUrl]);

  const handleProcess = useCallback(async () => {
    await onProcessRecording(apiBaseUrl, {
      generatePlaybook,
      appName,
      appUrl,
    });
  }, [onProcessRecording, apiBaseUrl, generatePlaybook, appName, appUrl]);

  const handleCopyPlaybook = useCallback(() => {
    if (pipelineResult?.playbookContent) {
      navigator.clipboard.writeText(pipelineResult.playbookContent);
      setCopiedPlaybook(true);
      setTimeout(() => setCopiedPlaybook(false), 2000);
    }
  }, [pipelineResult?.playbookContent]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Workflow className="w-4 h-4" />
          State Machine Recording
        </CardTitle>
        <CardDescription className="text-xs">
          Record interactions to automatically discover states and transitions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Recording Controls */}
        <div className="flex items-center gap-2">
          {!isRecording ? (
            <Button
              size="sm"
              variant="default"
              onClick={handleStart}
              disabled={isStarting || isStopping}
              className="gap-1.5"
            >
              {isStarting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Circle className="w-3.5 h-3.5 fill-red-500 text-red-500" />
              )}
              {isStarting ? "Starting..." : "Record"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleStop}
              disabled={isStopping}
              className="gap-1.5"
            >
              {isStopping ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              {isStopping ? "Stopping..." : "Stop"}
            </Button>
          )}

          {isRecording && (
            <Badge variant="outline" className="text-red-500 border-red-300 animate-pulse">
              Recording...
            </Badge>
          )}
        </div>

        {/* Error */}
        {error && (
          <Alert variant="destructive" className="py-2">
            <AlertCircle className="h-3.5 w-3.5" />
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        {/* Recording Result Summary */}
        {sdkResult && !isRecording && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="text-xs font-medium">Recording Captured</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="text-center">
                  <div className="font-mono text-sm">{sdkResult.interactionCount}</div>
                  <div className="text-muted-foreground">Interactions</div>
                </div>
                <div className="text-center">
                  <div className="font-mono text-sm">{sdkResult.captureCount}</div>
                  <div className="text-muted-foreground">Captures</div>
                </div>
                <div className="text-center">
                  <div className="font-mono text-sm">{sdkResult.variables.length}</div>
                  <div className="text-muted-foreground">Variables</div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Duration: {formatDuration(sdkResult.duration)}
              </div>

              {/* Variables Preview */}
              {sdkResult.variables.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium">Extracted Variables</div>
                  {sdkResult.variables.map((v, i) => (
                    <div key={i} className="text-xs flex items-center gap-2 pl-2">
                      <Badge variant="secondary" className="text-[10px] px-1">
                        {v.inputType}
                      </Badge>
                      <span className="font-mono">{v.suggestedParamName}</span>
                      <span className="text-muted-foreground truncate">
                        = &quot;{v.enteredValue}&quot;
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Process Button */}
              {!pipelineResult && (
                <Button
                  size="sm"
                  onClick={handleProcess}
                  disabled={isProcessing}
                  className="w-full gap-1.5"
                >
                  {isProcessing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Workflow className="w-3.5 h-3.5" />
                  )}
                  {isProcessing
                    ? "Discovering states..."
                    : "Discover State Machine"}
                </Button>
              )}
            </div>
          </>
        )}

        {/* Pipeline Result */}
        {pipelineResult && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-green-600">
                <CheckCircle2 className="w-3.5 h-3.5" />
                State Machine Discovered
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="font-mono text-sm">
                    {pipelineResult.stateCount}
                  </span>{" "}
                  states
                  {pipelineResult.modalStateCount > 0 && (
                    <span className="text-muted-foreground">
                      {" "}({pipelineResult.modalStateCount} modal)
                    </span>
                  )}
                </div>
                <div>
                  <span className="font-mono text-sm">
                    {pipelineResult.transitionCount}
                  </span>{" "}
                  transitions
                </div>
              </div>

              {/* State Machine Graph */}
              {pipelineResult.states.filter((s) => !s.isGlobal).length > 0 &&
                pipelineResult.transitions.length > 0 && (
                <RecordingStateGraph result={pipelineResult} height={220} />
              )}

              {/* States List */}
              <ScrollArea className="max-h-32">
                <div className="space-y-1">
                  {pipelineResult.states
                    .filter((s) => !s.isGlobal)
                    .map((state) => (
                      <div
                        key={state.id}
                        className="text-xs flex items-center justify-between px-2 py-1 rounded bg-muted/50"
                      >
                        <span className="truncate">
                          {state.name}
                          {state.isBlocking && (
                            <Badge variant="outline" className="ml-1 text-[10px] px-1">
                              modal
                            </Badge>
                          )}
                        </span>
                        <span className="text-muted-foreground font-mono">
                          {Math.round(state.confidence * 100)}%
                        </span>
                      </div>
                    ))}
                </div>
              </ScrollArea>

              {/* Playbook */}
              {pipelineResult.playbookContent && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      Generated Playbook
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={handleCopyPlaybook}
                    >
                      {copiedPlaybook ? (
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                      ) : (
                        <Copy className="w-3 h-3 mr-1" />
                      )}
                      {copiedPlaybook ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <ScrollArea className="max-h-48">
                    <pre className="text-[10px] font-mono bg-muted p-2 rounded whitespace-pre-wrap">
                      {pipelineResult.playbookContent}
                    </pre>
                  </ScrollArea>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
