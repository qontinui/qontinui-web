// components/integration-testing/VideoExportButton.tsx

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Video } from "lucide-react";
import { VideoExportDialog, VideoExportOptions } from "./VideoExportDialog";
import {
  exportExecutionVideo,
  getVideoExportStatus,
} from "@/lib/api/integration-testing";
import type { MockExecutionResponse } from "@/types/integration-testing";
import { toast } from "sonner";

interface VideoExportButtonProps {
  executionResult: MockExecutionResponse;
  className?: string;
}

export function VideoExportButton({
  executionResult,
  className,
}: VideoExportButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState<
    "idle" | "processing" | "completed" | "failed"
  >("idle");
  const [videoUrl, setVideoUrl] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();

  const handleOpenDialog = () => {
    // Reset state when opening dialog
    setExportStatus("idle");
    setExportProgress(0);
    setVideoUrl(undefined);
    setErrorMessage(undefined);
    setDialogOpen(true);
  };

  const handleExport = async (options: VideoExportOptions) => {
    try {
      setIsExporting(true);
      setExportStatus("processing");
      setExportProgress(0);

      // Start video export
      const response = await exportExecutionVideo(executionResult, options);

      // Poll for status
      const pollInterval = setInterval(async () => {
        try {
          const status = await getVideoExportStatus(response.video_id);

          setExportProgress(status.progress);

          if (status.status === "completed") {
            clearInterval(pollInterval);
            setExportStatus("completed");
            setVideoUrl(status.video_url);
            setIsExporting(false);

            toast.success(
              "Your execution video has been generated successfully."
            );
          } else if (status.status === "failed") {
            clearInterval(pollInterval);
            setExportStatus("failed");
            setErrorMessage(status.error || "Unknown error occurred");
            setIsExporting(false);

            toast.error(status.error || "Failed to generate video");
          }
        } catch (error) {
          console.error("Error polling video status:", error);
          clearInterval(pollInterval);
          setExportStatus("failed");
          setErrorMessage("Failed to check video status");
          setIsExporting(false);
        }
      }, 1000); // Poll every second

      // Cleanup on unmount or timeout
      setTimeout(
        () => {
          clearInterval(pollInterval);
          if (exportStatus === "processing") {
            setExportStatus("failed");
            setErrorMessage("Video generation timeout");
            setIsExporting(false);
          }
        },
        5 * 60 * 1000
      ); // 5 minute timeout
    } catch (error) {
      console.error("Error exporting video:", error);
      setExportStatus("failed");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to start video export"
      );
      setIsExporting(false);

      toast.error(
        error instanceof Error ? error.message : "Failed to start video export"
      );
    }
  };

  return (
    <>
      <Button
        onClick={handleOpenDialog}
        variant="outline"
        className={className}
      >
        <Video className="h-4 w-4 mr-2" />
        Export Video
      </Button>

      <VideoExportDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onExport={handleExport}
        isExporting={isExporting}
        exportProgress={exportProgress}
        exportStatus={exportStatus}
        videoUrl={videoUrl}
        errorMessage={errorMessage}
      />
    </>
  );
}
