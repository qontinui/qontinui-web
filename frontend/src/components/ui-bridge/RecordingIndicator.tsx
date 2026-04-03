"use client";

/**
 * Floating Recording Indicator
 *
 * Shows a persistent red recording badge in the bottom-right corner
 * when a UI Bridge recording session is active. Provides a quick stop button.
 *
 * This component polls the SDK's WebSocket for recording status.
 * Mount it in the app layout so it's visible across all pages.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RecordingStatus {
  active: boolean;
  sessionId?: string;
  duration: number;
  interactionCount: number;
  captureCount: number;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

/**
 * Polls known SDK WebSocket ports for active recording sessions.
 * Shows a floating indicator when recording is active.
 */
export function RecordingIndicator() {
  const [status, setStatus] = useState<RecordingStatus | null>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll common SDK ports for recording status
  useEffect(() => {
    const ports = [9876, 9877, 9878];

    const checkPorts = async () => {
      for (const port of ports) {
        try {
          const ws = new WebSocket(`ws://localhost:${port}`);
          const result = await new Promise<RecordingStatus | null>(
            (resolve) => {
              const timeout = setTimeout(() => {
                ws.close();
                resolve(null);
              }, 2000);

              ws.onopen = () => {
                const reqId = `poll-${Date.now()}`;
                ws.onmessage = (event) => {
                  try {
                    const msg = JSON.parse(event.data);
                    if (
                      msg.type === "response" &&
                      msg.requestId === reqId &&
                      msg.payload?.success
                    ) {
                      clearTimeout(timeout);
                      ws.close();
                      resolve(msg.payload.data as RecordingStatus);
                    }
                  } catch {
                    // ignore parse errors
                  }
                };
                ws.send(
                  JSON.stringify({
                    id: reqId,
                    type: "recording:status",
                    timestamp: Date.now(),
                  })
                );
              };

              ws.onerror = () => {
                clearTimeout(timeout);
                resolve(null);
              };
            }
          );

          if (result?.active) {
            setStatus(result);
            setWsUrl(`ws://localhost:${port}`);
            return;
          }
        } catch {
          // Port not available
        }
      }
      setStatus(null);
      setWsUrl(null);
    };

    checkPorts();
    pollRef.current = setInterval(checkPorts, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleStop = useCallback(async () => {
    if (!wsUrl) return;
    try {
      const ws = new WebSocket(wsUrl);
      await new Promise<void>((resolve) => {
        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              id: `stop-${Date.now()}`,
              type: "recording:stop",
              timestamp: Date.now(),
            })
          );
          setTimeout(() => {
            ws.close();
            resolve();
          }, 1000);
        };
        ws.onerror = () => resolve();
      });
      setStatus(null);
    } catch {
      // ignore
    }
  }, [wsUrl]);

  if (!status?.active) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 bg-red-50 dark:bg-red-950 border border-red-300 dark:border-red-800 rounded-full px-4 py-2 shadow-lg animate-in fade-in slide-in-from-bottom-4">
      <span className="size-2.5 rounded-full bg-red-500 animate-pulse" />
      <span className="text-sm font-medium text-red-700 dark:text-red-300">
        Recording
      </span>
      <span className="text-xs text-red-500 dark:text-red-400 font-mono">
        {formatDuration(status.duration)}
      </span>
      <span className="text-xs text-red-500/70 dark:text-red-400/70">
        {status.interactionCount} actions
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-red-600 hover:text-red-800 hover:bg-red-100 dark:hover:bg-red-900"
        onClick={handleStop}
      >
        <Square className="size-3" />
      </Button>
    </div>
  );
}
