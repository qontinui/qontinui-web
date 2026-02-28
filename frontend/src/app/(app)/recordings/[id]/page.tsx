"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Play, Trash2 } from "lucide-react";
import { recordingService } from "@/services/service-factory";
import { ProcessingMonitor } from "@/components/recordings/ProcessingMonitor";
import { StateStructureReview } from "@/components/recordings/StateStructureReview";
import {
  RecordingStatusLabels,
  getConfidenceLevel,
  getConfidenceColor,
} from "@/types/recording";
import type { Recording } from "@/types/recording";
import { formatDistanceToNow } from "date-fns";

export default function RecordingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const recordingId = params.id as string;

  const [recording, setRecording] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");

  const loadRecording = useCallback(async () => {
    try {
      setLoading(true);
      const data = await recordingService.getRecording(recordingId);
      setRecording(data);

      if (data.status === "processing" || data.status === "validating") {
        setActiveTab("processing");
      } else if (data.status === "completed") {
        setActiveTab("review");
      }
    } catch (error: unknown) {
      console.error("Failed to load recording:", error);
      toast.error("Failed to load recording");
    } finally {
      setLoading(false);
    }
  }, [recordingId]);

  useEffect(() => {
    loadRecording();
  }, [loadRecording]);

  const handleStartProcessing = async () => {
    if (!recording) return;

    try {
      await recordingService.startProcessing(recordingId);
      toast.success("Processing started");
      setActiveTab("processing");
      loadRecording();
    } catch (error: unknown) {
      console.error("Failed to start processing:", error);
      toast.error("Failed to start processing");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this recording?")) {
      return;
    }

    try {
      await recordingService.deleteRecording(recordingId);
      toast.success("Recording deleted");
      router.push("/recordings");
    } catch (error: unknown) {
      console.error("Failed to delete recording:", error);
      toast.error("Failed to delete recording");
    }
  };

  const handleProcessingComplete = () => {
    toast.success("Processing completed!");
    setActiveTab("review");
    loadRecording();
  };

  const handleProcessingError = (error: string) => {
    toast.error(`Processing failed: ${error}`);
    loadRecording();
  };

  if (loading || !recording) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-semibold text-foreground truncate">
            {recording.name}
          </h1>
          <Badge
            className={
              recording.status === "completed"
                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                : recording.status === "failed"
                  ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100"
                  : recording.status === "processing" ||
                      recording.status === "validating"
                    ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100"
                    : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100"
            }
          >
            {RecordingStatusLabels[recording.status]}
          </Badge>
          {recording.confidence && (
            <Badge
              className={getConfidenceColor(
                getConfidenceLevel(recording.confidence)
              )}
            >
              {Math.round(recording.confidence * 100)}% Confidence
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-muted-foreground mr-2">
            Created{" "}
            {formatDistanceToNow(new Date(recording.created_at), {
              addSuffix: true,
            })}
          </span>
          {recording.status === "uploaded" && (
            <Button size="sm" onClick={handleStartProcessing}>
              <Play className="mr-2 h-4 w-4" />
              Start Processing
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            className="text-red-600"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        {recording.description && (
          <p className="text-sm text-muted-foreground mb-4">
            {recording.description}
          </p>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger
              value="processing"
              disabled={
                recording.status !== "processing" &&
                recording.status !== "validating" &&
                recording.status !== "completed" &&
                recording.status !== "failed"
              }
            >
              Processing
            </TabsTrigger>
            <TabsTrigger
              value="review"
              disabled={recording.status !== "completed"}
            >
              Review Structure
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Frames
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">
                    {recording.stats.total_frames}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Interactions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">
                    {recording.stats.total_interactions}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Duration
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">
                    {recording.stats.duration_seconds}s
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Frame Rate
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">
                    {recording.stats.frame_rate} fps
                  </p>
                </CardContent>
              </Card>
            </div>

            {recording.status === "completed" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Discovered States
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-green-600">
                      {recording.stats.discovered_states}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Discovered Transitions
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-blue-600">
                      {recording.stats.discovered_transitions}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Workflows Generated
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-purple-600">
                      {recording.stats.discovered_workflows}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {recording.tags.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Tags</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2 flex-wrap">
                    {recording.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {(recording.validation_errors.length > 0 ||
              recording.validation_warnings.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle>Validation Issues</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {recording.validation_errors.length > 0 && (
                    <div>
                      <h4 className="font-medium text-red-600 mb-2">Errors</h4>
                      <ul className="space-y-1">
                        {recording.validation_errors.map((error, idx) => (
                          <li key={idx} className="text-sm text-red-600">
                            &bull; {error}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {recording.validation_warnings.length > 0 && (
                    <div>
                      <h4 className="font-medium text-yellow-600 mb-2">
                        Warnings
                      </h4>
                      <ul className="space-y-1">
                        {recording.validation_warnings.map((warning, idx) => (
                          <li key={idx} className="text-sm text-yellow-600">
                            &bull; {warning}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="processing" className="pt-6">
            <ProcessingMonitor
              recordingId={recordingId}
              onComplete={handleProcessingComplete}
              onError={handleProcessingError}
            />
          </TabsContent>

          <TabsContent value="review" className="pt-6">
            <div className="min-h-[600px]">
              <StateStructureReview recordingId={recordingId} />
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
