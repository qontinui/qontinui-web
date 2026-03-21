"use client";

import { useEffect, useState, useRef } from "react";
import { createLogger } from "@/lib/logger";

const log = createLogger("RunnerMonitor");
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Monitor,
  RefreshCw,
} from "lucide-react";
import {
  RunnerWebSocket,
  SessionStartEvent,
  ScreenshotEvent,
  LogEvent,
} from "@/lib/runner-websocket";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";
import Image from "next/image";

interface RunnerMonitorProps {
  projectId?: string;
}

interface SessionInfo extends SessionStartEvent {
  status: "running" | "completed" | "failed" | "disconnected";
  error_message?: string;
}

export function RunnerMonitor({ projectId: _projectId }: RunnerMonitorProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [currentSession, setCurrentSession] = useState<SessionInfo | null>(
    null
  );
  const [screenshots, setScreenshots] = useState<ScreenshotEvent[]>([]);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [selectedScreenshot, setSelectedScreenshot] =
    useState<ScreenshotEvent | null>(null);
  const wsRef = useRef<RunnerWebSocket | null>(null);

  useEffect(() => {
    initializeWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.disconnect();
      }
    };
  }, []);

  const initializeWebSocket = async () => {
    try {
      // Connect to the runner status WebSocket to receive real-time session events
      const wsUrl = await apiClient.getRunnerStatusWebSocketUrl();
      log.debug("Connecting to status WebSocket");

      // Create a simple WebSocket connection for status updates
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        log.debug("Status WebSocket connected");
        setIsConnected(true);
        toast.success("Connected to runner status");
      };

      ws.onclose = () => {
        log.debug("Status WebSocket disconnected");
        setIsConnected(false);
      };

      ws.onerror = (error) => {
        log.debug("WebSocket error:", error);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          log.debug("Received message:", message.type);

          switch (message.type) {
            case "initial_state":
              log.debug("Initial state received");
              break;

            case "session_start":
              setCurrentSession({
                session_id: message.session_id,
                project_id: message.project_id,
                runner_version: message.runner_version,
                runner_os: message.runner_os,
                runner_hostname: message.runner_hostname,
                timestamp: message.timestamp,
                status: "running",
              });
              setScreenshots([]);
              setLogs([]);
              setSelectedScreenshot(null);
              toast.success(
                `Session started: ${message.session_id?.slice(0, 8) || "unknown"}...`
              );
              break;

            case "session_end":
              setCurrentSession((prev) =>
                prev
                  ? {
                      ...prev,
                      status: message.status,
                      error_message: message.error_message,
                    }
                  : null
              );
              toast.info(`Session ended: ${message.status}`);
              break;

            case "log":
              setLogs((prev) => [
                ...prev,
                {
                  log_id: message.log_id,
                  session_id: message.session_id,
                  level: message.level,
                  message: message.message,
                  log_data: message.log_data,
                  sequence_number: message.sequence_number,
                  timestamp: message.timestamp,
                },
              ]);
              break;

            case "screenshot":
              setScreenshots((prev) => [...prev, message]);
              setSelectedScreenshot(message);
              break;

            case "runner_connected":
            case "runner_disconnected":
            case "runner_name_updated":
              log.debug("Runner status:", message.type);
              break;

            default:
              log.debug("Unknown message type:", message.type);
          }
        } catch (error) {
          console.error("[RunnerMonitor] Failed to parse message:", error);
        }
      };

      // Store WebSocket in ref for cleanup
      wsRef.current = {
        connect: () => {},
        disconnect: () => ws.close(),
        isConnected: () => ws.readyState === WebSocket.OPEN,
        send: () => {},
      } as unknown as RunnerWebSocket;
    } catch (error) {
      console.error("Failed to initialize WebSocket:", error);
      toast.error("Failed to connect to runner");
    }
  };

  const handleReconnect = () => {
    if (wsRef.current) {
      wsRef.current.disconnect();
    }
    initializeWebSocket();
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case "running":
        return "default";
      case "completed":
        return "success";
      case "failed":
        return "destructive";
      case "disconnected":
        return "secondary";
      default:
        return "outline";
    }
  };

  const getLogIcon = (level: string) => {
    switch (level) {
      case "error":
      case "critical":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "warning":
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case "info":
        return <CheckCircle2 className="h-4 w-4 text-blue-500" />;
      default:
        return <Activity className="h-4 w-4 text-gray-500" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Connection Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              <CardTitle>Runner Connection</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={isConnected ? "success" : "secondary"}>
                {isConnected ? "Connected" : "Disconnected"}
              </Badge>
              <Button size="sm" variant="outline" onClick={handleReconnect}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Current Session Info */}
      {currentSession && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Current Session</CardTitle>
                <CardDescription className="mt-1">
                  {currentSession.session_id}
                </CardDescription>
              </div>
              <Badge variant={getStatusColor(currentSession.status)}>
                {currentSession.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Project ID:</span>
                <p className="font-medium">{currentSession.project_id}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Runner Version:</span>
                <p className="font-medium">
                  {currentSession.runner_version || "N/A"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">OS:</span>
                <p className="font-medium">
                  {currentSession.runner_os || "N/A"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Hostname:</span>
                <p className="font-medium">
                  {currentSession.runner_hostname || "N/A"}
                </p>
              </div>
            </div>
            {currentSession.error_message && (
              <div className="mt-4 p-3 bg-destructive/10 border border-destructive rounded-md">
                <p className="text-sm text-destructive">
                  {currentSession.error_message}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Main Content - Screenshots and Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Screenshots Panel */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Screenshots</span>
              <Badge variant="outline">{screenshots.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            {selectedScreenshot ? (
              <div className="space-y-4">
                <div className="relative aspect-video bg-muted rounded-md overflow-hidden">
                  <Image
                    src={selectedScreenshot.presigned_url}
                    alt={selectedScreenshot.name}
                    fill
                    sizes="(max-width: 768px) 100vw, 50vw"
                    className="object-contain"
                  />
                </div>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name:</span>
                    <p className="font-medium">{selectedScreenshot.name}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Size:</span>
                    <p className="font-medium">
                      {selectedScreenshot.width} × {selectedScreenshot.height}
                    </p>
                  </div>
                  {selectedScreenshot.automation_metadata?.state_name && (
                    <div>
                      <span className="text-muted-foreground">State:</span>
                      <p className="font-medium">
                        {selectedScreenshot.automation_metadata.state_name}
                      </p>
                    </div>
                  )}
                  {selectedScreenshot.automation_metadata?.action_type && (
                    <div>
                      <span className="text-muted-foreground">Action:</span>
                      <p className="font-medium">
                        {selectedScreenshot.automation_metadata.action_type}
                      </p>
                    </div>
                  )}
                  {selectedScreenshot.automation_metadata
                    ?.execution_time_ms && (
                    <div>
                      <span className="text-muted-foreground">
                        Execution Time:
                      </span>
                      <p className="font-medium">
                        {
                          selectedScreenshot.automation_metadata
                            .execution_time_ms
                        }
                        ms
                      </p>
                    </div>
                  )}
                </div>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Recent Screenshots
                  </p>
                  <ScrollArea className="h-32">
                    <div className="flex gap-2">
                      {screenshots
                        .slice()
                        .reverse()
                        .map((screenshot, idx) => (
                          <button
                            key={screenshot.screenshot_id}
                            onClick={() => setSelectedScreenshot(screenshot)}
                            className={`relative w-24 h-16 rounded border-2 overflow-hidden flex-shrink-0 ${
                              selectedScreenshot?.screenshot_id ===
                              screenshot.screenshot_id
                                ? "border-primary"
                                : "border-border"
                            }`}
                          >
                            <Image
                              src={screenshot.presigned_url}
                              alt={`Screenshot ${screenshots.length - idx}`}
                              fill
                              sizes="96px"
                              className="object-cover"
                            />
                          </button>
                        ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                {screenshots.length === 0
                  ? "No screenshots yet"
                  : "Select a screenshot"}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Logs Panel */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Logs</span>
              <Badge variant="outline">{logs.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            <ScrollArea className="h-[500px]">
              {logs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No logs yet
                </div>
              ) : (
                <div className="space-y-2">
                  {logs.map((log) => (
                    <div
                      key={log.log_id}
                      className="flex gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        {getLogIcon(log.level)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">
                            {log.level}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-sm break-words">{log.message}</p>
                        {log.log_data &&
                          Object.keys(log.log_data).length > 0 && (
                            <pre className="text-xs text-muted-foreground mt-1 overflow-x-auto">
                              {JSON.stringify(log.log_data, null, 2)}
                            </pre>
                          )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
