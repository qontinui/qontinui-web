"use client";

/**
 * Floating Recording Indicator
 *
 * Shows a persistent red recording badge in the bottom-right corner
 * when a UI Bridge recording session is active. Provides a quick stop button.
 *
 * WHO SERVES THE RECORDING SOCKET. The `recording:status` / `recording:stop`
 * messages are handled by the UI Bridge SDK's own server
 * (`@qontinui/ui-bridge` `server/websocket-handler.ts`, run by its
 * `StandaloneServer` inside the SDK-enabled APP's process, on the app's own
 * port, any path) — NOT by the runner. The runner's only WebSocket routes are
 * `/ws/events` and `/ui-bridge/ws`, and neither handles `recording:*`; a
 * socket to the runner's own port could never report a recording.
 *
 * So the indicator asks the ACTIVE runner — only one proven to be on this
 * machine — which SDK app it is connected to (`GET /ui-bridge/sdk/connections`,
 * whose app URLs the runner records as its own loopback addresses), and opens
 * the recording socket to that app ONLY when the URL is a loopback address.
 * Proven-local runner + loopback app URL = an app on this machine. Anything
 * else (a runner on another machine, locality unknown, no connected app, an
 * app URL that is not loopback) opens nothing: the recording state is
 * UNKNOWN and nothing is shown.
 */

import { useState, useCallback, useRef } from "react";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  routeOfTarget,
  runnerRequest,
  useRunnerPoll,
  useRunnerTarget,
} from "@/lib/runner";

interface RecordingStatus {
  active: boolean;
  sessionId?: string;
  duration: number;
  interactionCount: number;
  captureCount: number;
}

interface SdkConnection {
  url?: string;
  isActive?: boolean;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

/** How often the recording status is polled. */
const RECORDING_POLL_INTERVAL_MS = 5000;
/** Budget for the runner's connection list and for the socket probe. */
const PROBE_TIMEOUT_MS = 2000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The recording WebSocket URL of an SDK app at `appUrl` — ONLY when it is an
 * http(s) loopback address (the app is on the machine of the runner that
 * reported it); otherwise null.
 */
export function recordingSocketUrlFor(appUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
  const scheme = url.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${url.host}`;
}

/** Ask the recording socket at `socketUrl` for the session status. */
function probeRecordingStatus(
  socketUrl: string
): Promise<RecordingStatus | null> {
  return new Promise<RecordingStatus | null>((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(socketUrl);
    } catch {
      resolve(null);
      return;
    }
    const timeout = setTimeout(() => {
      ws.close();
      resolve(null);
    }, PROBE_TIMEOUT_MS);

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
  });
}

/**
 * Polls the recording socket of the SDK app the active (proven-local) runner
 * is connected to, and shows a floating indicator while a recording is
 * active. See the module comment for why the socket is the APP's.
 */
export function RecordingIndicator() {
  const target = useRunnerTarget();
  const isLocal = routeOfTarget(target).kind === "loopback";
  const [status, setStatus] = useState<RecordingStatus | null>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;

  // A different runner (or none proven local): forget the old one's state.
  const [shownFor, setShownFor] = useState(isLocal ? target : null);
  if ((isLocal ? target : null) !== shownFor) {
    setShownFor(isLocal ? target : null);
    setStatus(null);
    setWsUrl(null);
  }

  const checkStatus = useCallback(async () => {
    let socketUrl: string | null = null;
    try {
      const res = await runnerRequest(target, "/ui-bridge/sdk/connections", {
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      if (res.ok) {
        const body = await res.json();
        const conns: SdkConnection[] = Array.isArray(body?.data)
          ? body.data
          : Array.isArray(body)
            ? body
            : [];
        const active = conns.find((c) => c.isActive && c.url);
        socketUrl = active?.url ? recordingSocketUrlFor(active.url) : null;
      }
    } catch {
      socketUrl = null;
    }
    const result = socketUrl ? await probeRecordingStatus(socketUrl) : null;
    // The runner changed while this tick ran: its answer is not ours.
    if (targetRef.current !== target) return;
    if (result?.active) {
      setStatus(result);
      setWsUrl(socketUrl);
    } else {
      setStatus(null);
      setWsUrl(null);
    }
  }, [target]);

  useRunnerPoll(target, {
    enabled: isLocal,
    requestedMs: RECORDING_POLL_INTERVAL_MS,
    immediate: true,
    tick: checkStatus,
  });

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
