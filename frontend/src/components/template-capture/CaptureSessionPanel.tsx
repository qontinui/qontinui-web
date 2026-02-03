/**
 * CaptureSessionPanel Component
 *
 * Control panel for starting and stopping click capture sessions.
 *
 * Features:
 * - Start/stop capture with application name hint
 * - Live duration counter when recording
 * - Runner connection status indicator
 * - Error display
 */

import React, { useState, useEffect } from "react";
import {
  Play,
  Square,
  Circle,
  Wifi,
  WifiOff,
  AlertCircle,
  Loader2,
  Clock,
  MousePointerClick,
  Monitor,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useClickCapture } from "@/hooks/useClickCapture";
import { toast } from "sonner";

export interface CaptureSessionPanelProps {
  onCaptureComplete?: (sessionId: string, candidatesCount: number) => void;
  className?: string;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function CaptureSessionPanel({
  onCaptureComplete,
  className,
}: CaptureSessionPanelProps) {
  const { state, isRunnerConnected, start, stop } = useClickCapture();
  const [applicationName, setApplicationName] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  const handleStart = async () => {
    setIsStarting(true);
    try {
      await start(applicationName || undefined);
      toast.success("Capture started", {
        description: "Click on UI elements to capture templates",
      });
    } catch (err) {
      toast.error("Failed to start capture", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    try {
      const result = await stop();
      if (result && state.sessionId) {
        onCaptureComplete?.(state.sessionId, result.candidatesCount);
      }
    } catch (err) {
      toast.error("Failed to stop capture", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsStopping(false);
    }
  };

  // Show connection status changes
  useEffect(() => {
    if (!isRunnerConnected && state.isActive) {
      toast.warning("Runner disconnected", {
        description: "Capture session may be interrupted",
      });
    }
  }, [isRunnerConnected, state.isActive]);

  return (
    <Card className={cn("", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Click Capture</CardTitle>
            <CardDescription>
              Record clicks to automatically detect element boundaries
            </CardDescription>
          </div>
          {/* Connection Status */}
          <Badge
            variant={isRunnerConnected ? "secondary" : "destructive"}
            className="flex items-center gap-1.5"
          >
            {isRunnerConnected ? (
              <>
                <Wifi className="h-3 w-3" />
                Runner Connected
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3" />
                Runner Offline
              </>
            )}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Recording Status */}
        {state.isActive && (
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Circle className="h-5 w-5 text-red-500 fill-red-500" />
                  <Circle className="h-5 w-5 text-red-500 fill-red-500 absolute inset-0 animate-ping opacity-75" />
                </div>
                <div>
                  <p className="font-medium text-red-700 dark:text-red-400">Recording in Progress</p>
                  {state.applicationName && (
                    <p className="text-sm text-red-600 dark:text-red-500">{state.applicationName}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                  <MousePointerClick className="h-4 w-4" />
                  <span className="font-mono">{state.clickCount || 0} clicks</span>
                </div>
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                  <Clock className="h-4 w-4" />
                  <span className="font-mono text-lg">{formatDuration(state.duration)}</span>
                </div>
              </div>
            </div>

            {/* Recording Tips */}
            <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
              <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-blue-700 dark:text-blue-400">
                <p className="font-medium">Recording Tips:</p>
                <ul className="list-disc list-inside text-xs mt-1 space-y-0.5">
                  <li>Click in the center of buttons and UI elements</li>
                  <li>Avoid clicking on moving or animated elements</li>
                  <li>Click on distinct visual elements with clear boundaries</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {state.error && (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg">
            <AlertCircle className="h-4 w-4" />
            <p className="text-sm">{state.error}</p>
          </div>
        )}

        {/* Application Name Input (only when not recording) */}
        {!state.isActive && (
          <div className="space-y-2">
            <Label htmlFor="appName">Application Name (optional)</Label>
            <Input
              id="appName"
              placeholder="e.g., Civilization 6, Calculator, Chrome"
              value={applicationName}
              onChange={(e) => setApplicationName(e.target.value)}
              disabled={!isRunnerConnected}
            />
            <p className="text-xs text-muted-foreground">
              Helps optimize detection parameters for this application
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          {!state.isActive ? (
            <Button
              onClick={handleStart}
              disabled={!isRunnerConnected || isStarting}
              className="flex-1"
            >
              {isStarting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start Capture
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={handleStop}
              disabled={isStopping}
              variant="destructive"
              className="flex-1"
            >
              {isStopping ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Square className="h-4 w-4 mr-2" />
                  Stop & Process
                </>
              )}
            </Button>
          )}
        </div>

        {/* Instructions */}
        {!state.isActive && isRunnerConnected && (
          <div className="text-sm text-muted-foreground space-y-1">
            <p className="font-medium">How it works:</p>
            <ol className="list-decimal list-inside space-y-1 text-xs">
              <li>Click &quot;Start Capture&quot; to begin recording</li>
              <li>Click on buttons/elements in your target application</li>
              <li>Click &quot;Stop & Process&quot; when done</li>
              <li>Review detected templates in the grid below</li>
            </ol>
          </div>
        )}

        {/* Offline Instructions */}
        {!isRunnerConnected && (
          <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="flex items-start gap-3">
              <Monitor className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="space-y-2">
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  Runner Not Connected
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  The Qontinui Runner desktop app is required for click capture.
                </p>
                <div className="text-xs text-amber-600 dark:text-amber-500 space-y-1">
                  <p className="font-medium">To start the runner:</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Open a terminal in the <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">qontinui-runner</code> directory</li>
                    <li>Run <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">npm run tauri dev</code></li>
                    <li>Wait for the desktop app to launch</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
