"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAutomation } from "@/contexts/automation-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowLeft,
  Download,
  Camera,
  Loader2,
  Monitor,
  MousePointer,
  Keyboard,
} from "lucide-react";
import { VideoPlayer } from "@/components/capture-viewer/VideoPlayer";
import { InputEventsSidePanel } from "@/components/capture-viewer/InputEventsSidePanel";
import { EventTimeline } from "@/components/capture-viewer/EventTimeline";
import { SaveScreenshotDialog } from "@/components/captures/SaveScreenshotDialog";
import { captureService } from "@/services/service-factory";
import type { CaptureSession, InputEvent } from "@/types/capture";
import { formatDuration } from "@/types/capture";

export default function CaptureViewerPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = params.sessionId as string;

  const { projectId: contextProjectId } = useAutomation();
  const urlProjectId = searchParams?.get("project") ?? null;
  const projectId = contextProjectId || urlProjectId;

  const [session, setSession] = useState<CaptureSession | null>(null);
  const [events, setEvents] = useState<InputEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTimestamp, setCurrentTimestamp] = useState(0);
  const [, setIsPlaying] = useState(false);

  // Screenshot save dialog state
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [capturedFrame, setCapturedFrame] = useState<string | null>(null);
  const [capturingFrame, setCapturingFrame] = useState(false);

  useEffect(() => {
    loadCaptureSession();
  }, [sessionId]);

  const loadCaptureSession = async () => {
    try {
      setLoading(true);

      // Fetch session with events
      const sessionData = await captureService.getSession(sessionId);
      setSession(sessionData);

      // Fetch events separately for more control
      const eventData = await captureService.getSessionEvents(sessionId);
      setEvents(eventData);
    } catch (error: any) {
      console.error("Failed to load capture session:", error);
      toast.error("Failed to load capture session");
    } finally {
      setLoading(false);
    }
  };

  const handleTimestampChange = useCallback((timestamp: number) => {
    setCurrentTimestamp(timestamp);
  }, []);

  const handleEventClick = useCallback((timestamp: number) => {
    setCurrentTimestamp(timestamp);
  }, []);

  const handleSeek = useCallback((timestamp: number) => {
    setCurrentTimestamp(timestamp);
  }, []);

  const handleCaptureFrame = useCallback(async () => {
    if (!session) return;

    try {
      setCapturingFrame(true);
      const timestampMs = Math.round(currentTimestamp * 1000);
      const frameBase64 = await captureService.extractFrameBase64(
        sessionId,
        timestampMs
      );
      setCapturedFrame(frameBase64);
      setShowSaveDialog(true);
    } catch (error: any) {
      console.error("Failed to capture frame:", error);
      toast.error("Failed to capture frame");
    } finally {
      setCapturingFrame(false);
    }
  }, [session, sessionId, currentTimestamp]);

  const handleSaveScreenshot = useCallback(
    async (name: string, description?: string, tags?: string[]) => {
      if (!capturedFrame || !projectId) return;

      try {
        await captureService.saveScreenshotToProject(projectId, {
          name,
          description,
          tags,
          imageData: capturedFrame,
        });
        toast.success("Screenshot saved to project");
        setShowSaveDialog(false);
        setCapturedFrame(null);
      } catch (error: any) {
        console.error("Failed to save screenshot:", error);
        toast.error("Failed to save screenshot");
      }
    },
    [capturedFrame, projectId]
  );

  const handleDownloadEvents = useCallback(() => {
    if (!events.length) return;

    const dataStr = JSON.stringify(events, null, 2);
    const dataUri =
      "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);

    const exportFileDefaultName = `capture-events-${sessionId}.json`;

    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", dataUri);
    linkElement.setAttribute("download", exportFileDefaultName);
    linkElement.click();

    toast.success("Events exported");
  }, [events, sessionId]);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold mb-2">Session not found</h2>
          <p className="text-muted-foreground mb-4">
            The capture session could not be loaded.
          </p>
          <Button onClick={() => router.push("/captures")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Captures
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => router.push("/captures")}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Captures
        </Button>

        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold">{session.name}</h1>
              <Badge
                className={
                  session.isComplete
                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                    : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100"
                }
              >
                {session.isComplete ? "Complete" : "In Progress"}
              </Badge>
            </div>
            {session.notes && (
              <p className="text-muted-foreground mb-2">{session.notes}</p>
            )}
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Monitor className="h-4 w-4" />
                {session.videoWidth}x{session.videoHeight}
              </span>
              <span>{formatDuration(session.duration)}</span>
              <span>{session.stats.totalEvents} events</span>
              <span className="flex items-center gap-1">
                <MousePointer className="h-4 w-4" />
                {session.stats.mouseClicks} clicks
              </span>
              <span className="flex items-center gap-1">
                <Keyboard className="h-4 w-4" />
                {session.stats.keyPresses} keys
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleCaptureFrame}
              disabled={capturingFrame}
            >
              {capturingFrame ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Camera className="mr-2 h-4 w-4" />
              )}
              Capture Frame
            </Button>
            <Button variant="outline" onClick={handleDownloadEvents}>
              <Download className="mr-2 h-4 w-4" />
              Export Events
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Video Player and Timeline */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4">
            <VideoPlayer
              videoUrl={captureService.getVideoUrl(sessionId)}
              currentTimestamp={currentTimestamp}
              onTimestampChange={handleTimestampChange}
              onPlayingChange={setIsPlaying}
            />
          </Card>

          <Card className="p-4">
            <EventTimeline
              events={events}
              duration={session.duration}
              currentTime={currentTimestamp}
              onSeek={handleSeek}
            />
          </Card>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold">{session.stats.mouseClicks}</p>
              <p className="text-xs text-muted-foreground">Clicks</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold">{session.stats.keyPresses}</p>
              <p className="text-xs text-muted-foreground">Key Presses</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold">{session.stats.scrolls}</p>
              <p className="text-xs text-muted-foreground">Scrolls</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold">
                {session.stats.dragOperations}
              </p>
              <p className="text-xs text-muted-foreground">Drags</p>
            </Card>
          </div>
        </div>

        {/* Right: Input Events Side Panel */}
        <div className="lg:col-span-1">
          <InputEventsSidePanel
            events={events}
            currentTimestamp={currentTimestamp}
            onEventClick={handleEventClick}
          />
        </div>
      </div>

      {/* Save Screenshot Dialog */}
      <SaveScreenshotDialog
        open={showSaveDialog}
        onOpenChange={setShowSaveDialog}
        imageData={capturedFrame}
        onSave={handleSaveScreenshot}
        defaultName={`Frame at ${formatDuration(currentTimestamp)}`}
      />
    </div>
  );
}
