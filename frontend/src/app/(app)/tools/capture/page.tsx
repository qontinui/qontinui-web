"use client";

import { useState, useEffect, useRef } from "react";
import { useRunnerHealth, runnerApi } from "@/lib/runner-api";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Video,
  Play,
  Square,
  Loader2,
  Clock,
  Info,
  ChevronDown,
  ChevronRight,
  Activity,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

export default function CapturePage() {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const [isRecording, setIsRecording] = useState(false);
  const [fps, setFps] = useState(30);
  const [showSettings, setShowSettings] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [lastRecording, setLastRecording] = useState<{
    duration: number;
    events: number;
    sessionId: string;
  } | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(async () => {
        try {
          const status = await runnerApi.getInteractionRecordingStatus();
          setElapsedSeconds(Math.floor(status.duration));
          setEventCount(status.events_count);
          if (!status.is_recording) {
            setIsRecording(false);
          }
        } catch {
          // Fallback to local timer if status poll fails
          setElapsedSeconds((s) => s + 1);
        }
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const formatTimer = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const handleStart = async () => {
    try {
      const result = await runnerApi.startInteractionRecording(fps);
      setIsRecording(true);
      setElapsedSeconds(0);
      setEventCount(0);
      toast.success(`Recording started (session: ${result.session_id})`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start recording"
      );
    }
  };

  const handleStop = async () => {
    try {
      const result = await runnerApi.stopInteractionRecording();
      setIsRecording(false);
      setLastRecording({
        duration: Math.floor(result.duration),
        events: result.events_count,
        sessionId: result.status,
      });
      toast.success(
        `Recording stopped (${result.events_count} events, ${Math.floor(result.duration)}s)`
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to stop recording"
      );
      setIsRecording(false);
    }
  };

  if (healthLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden text-white">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Video className="size-5 text-red-500" />
          <h1 className="text-lg font-semibold text-foreground">Capture</h1>
          {isRecording && (
            <div className="flex items-center gap-2">
              <div className="size-2.5 rounded-full bg-red-500 animate-pulse" />
              <Badge variant="destructive" className="text-xs">
                Recording
              </Badge>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto space-y-6 w-full">
        {isOffline && (
          <RunnerPartialState message="Runner offline — this tool requires the runner for execution" />
        )}

        <p className="text-muted-foreground">
          Record user interactions for automation replay and state discovery.
        </p>

        {/* FPS Settings */}
        <Card className="bg-muted border-border">
          <CardHeader
            className="cursor-pointer"
            onClick={() => setShowSettings(!showSettings)}
          >
            <CardTitle className="text-base flex items-center gap-2">
              {showSettings ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              FPS Settings
            </CardTitle>
          </CardHeader>
          {showSettings && (
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Capture Rate</Label>
                  <span className="text-sm font-mono text-foreground">
                    {fps} FPS
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={60}
                  step={5}
                  value={fps}
                  onChange={(e) => setFps(parseInt(e.target.value))}
                  className="w-full h-2 bg-background rounded-lg appearance-none cursor-pointer accent-brand-primary"
                  disabled={isRecording}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>10 FPS</span>
                  <span>60 FPS</span>
                </div>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Recording Controls */}
        <Card className="bg-muted border-border">
          <CardContent className="py-8">
            <div className="flex flex-col items-center gap-6">
              {/* Timer */}
              {isRecording && (
                <div className="text-center">
                  <div className="text-5xl font-mono font-bold text-foreground">
                    {formatTimer(elapsedSeconds)}
                  </div>
                  <div className="flex items-center gap-4 mt-3">
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Activity className="size-4" />
                      {eventCount} events
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Zap className="size-4" />
                      {fps} FPS
                    </div>
                  </div>
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-3">
                {!isRecording ? (
                  <Button
                    onClick={handleStart}
                    className="bg-red-600 hover:bg-red-700 text-white px-8 py-6 text-lg"
                  >
                    <Play className="size-5 mr-2" />
                    Start Recording
                  </Button>
                ) : (
                  <Button
                    onClick={handleStop}
                    variant="outline"
                    className="border-red-500/50 text-red-400 hover:bg-red-950/50 px-8 py-6 text-lg"
                  >
                    <Square className="size-5 mr-2" />
                    Stop Recording
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Last Recording */}
        {lastRecording && (
          <Card className="bg-muted border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="size-4" />
                Last Recording
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Duration</span>
                  <div className="font-medium text-foreground">
                    {formatTimer(lastRecording.duration)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Events</span>
                  <div className="font-medium text-foreground">
                    {lastRecording.events}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Session ID</span>
                  <div className="font-mono text-xs text-foreground truncate">
                    {lastRecording.sessionId}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Info */}
        <Card className="bg-muted border-border">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Info className="size-5 text-blue-400 mt-0.5 shrink-0" />
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  <strong className="text-muted-foreground">Purpose:</strong>{" "}
                  Record mouse, keyboard, and screen interactions for automation
                  replay.
                </p>
                <p>
                  <strong className="text-muted-foreground">Output:</strong>{" "}
                  Recordings are saved to the runner&apos;s data directory.
                </p>
                <p>
                  <strong className="text-muted-foreground">Use cases:</strong>{" "}
                  Generate automation workflows from real interactions, discover
                  UI states, create test fixtures.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
