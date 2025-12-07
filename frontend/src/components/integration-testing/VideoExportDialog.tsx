// components/integration-testing/VideoExportDialog.tsx

"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Download, Video, Settings, CheckCircle, XCircle } from "lucide-react";

export interface VideoExportOptions {
  frameDuration: number;
  quality: "480p" | "720p" | "1080p";
  includeOverlays: boolean;
  includeTimeline: boolean;
  includeText: boolean;
  smoothTransitions: boolean;
}

interface VideoExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (options: VideoExportOptions) => void;
  isExporting: boolean;
  exportProgress: number;
  exportStatus: "idle" | "processing" | "completed" | "failed";
  videoUrl?: string;
  errorMessage?: string;
}

export function VideoExportDialog({
  open,
  onOpenChange,
  onExport,
  isExporting,
  exportProgress,
  exportStatus,
  videoUrl,
  errorMessage,
}: VideoExportDialogProps) {
  const [options, setOptions] = useState<VideoExportOptions>({
    frameDuration: 1.5,
    quality: "720p",
    includeOverlays: true,
    includeTimeline: true,
    includeText: true,
    smoothTransitions: true,
  });

  const handleExport = () => {
    onExport(options);
  };

  const handleDownload = () => {
    if (videoUrl) {
      window.open(videoUrl, "_blank");
    }
  };

  const handleClose = () => {
    if (!isExporting) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="h-5 w-5" />
            Export Execution Video
          </DialogTitle>
          <DialogDescription>
            Generate an MP4 video from the execution playback with overlays and
            visualizations.
          </DialogDescription>
        </DialogHeader>

        {exportStatus === "idle" && (
          <div className="space-y-6 py-4">
            {/* Frame Duration */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="frameDuration">Frame Duration</Label>
                <span className="text-sm text-gray-500">
                  {options.frameDuration.toFixed(1)}s per action
                </span>
              </div>
              <Slider
                id="frameDuration"
                min={0.5}
                max={5}
                step={0.1}
                value={[options.frameDuration]}
                onValueChange={([value]) =>
                  setOptions({ ...options, frameDuration: value ?? 1.5 })
                }
                disabled={isExporting}
              />
              <p className="text-xs text-gray-500">
                How long each action frame should be displayed in the video
              </p>
            </div>

            {/* Video Quality */}
            <div className="space-y-3">
              <Label htmlFor="quality">Video Quality</Label>
              <Select
                value={options.quality}
                onValueChange={(value: "480p" | "720p" | "1080p") =>
                  setOptions({ ...options, quality: value })
                }
                disabled={isExporting}
              >
                <SelectTrigger id="quality">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="480p">
                    480p (Low - Smaller file)
                  </SelectItem>
                  <SelectItem value="720p">
                    720p (Medium - Recommended)
                  </SelectItem>
                  <SelectItem value="1080p">
                    1080p (High - Larger file)
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Higher quality results in larger file sizes
              </p>
            </div>

            {/* Options */}
            <div className="space-y-4">
              <Label className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Video Features
              </Label>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="includeOverlays" className="font-normal">
                      Include Action Overlays
                    </Label>
                    <p className="text-xs text-gray-500">
                      Draw boxes, click ripples, and match indicators
                    </p>
                  </div>
                  <Switch
                    id="includeOverlays"
                    checked={options.includeOverlays}
                    onCheckedChange={(checked) =>
                      setOptions({ ...options, includeOverlays: checked })
                    }
                    disabled={isExporting}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="includeText" className="font-normal">
                      Include Text Overlays
                    </Label>
                    <p className="text-xs text-gray-500">
                      Show action type, states, and duration
                    </p>
                  </div>
                  <Switch
                    id="includeText"
                    checked={options.includeText}
                    onCheckedChange={(checked) =>
                      setOptions({ ...options, includeText: checked })
                    }
                    disabled={isExporting}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="includeTimeline" className="font-normal">
                      Include Timeline Bar
                    </Label>
                    <p className="text-xs text-gray-500">
                      Show progress bar at the bottom
                    </p>
                  </div>
                  <Switch
                    id="includeTimeline"
                    checked={options.includeTimeline}
                    onCheckedChange={(checked) =>
                      setOptions({ ...options, includeTimeline: checked })
                    }
                    disabled={isExporting}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="smoothTransitions" className="font-normal">
                      Smooth Transitions
                    </Label>
                    <p className="text-xs text-gray-500">
                      Fade between frames for smoother playback
                    </p>
                  </div>
                  <Switch
                    id="smoothTransitions"
                    checked={options.smoothTransitions}
                    onCheckedChange={(checked) =>
                      setOptions({ ...options, smoothTransitions: checked })
                    }
                    disabled={isExporting}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {exportStatus === "processing" && (
          <div className="space-y-4 py-8">
            <div className="text-center">
              <Video className="h-12 w-12 mx-auto mb-4 text-blue-500 animate-pulse" />
              <h3 className="text-lg font-semibold mb-2">Generating Video</h3>
              <p className="text-sm text-gray-500 mb-4">
                This may take a few moments...
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Progress</span>
                <span>{Math.round(exportProgress * 100)}%</span>
              </div>
              <Progress value={exportProgress * 100} className="h-2" />
            </div>
          </div>
        )}

        {exportStatus === "completed" && (
          <div className="space-y-4 py-8 text-center">
            <CheckCircle className="h-16 w-16 mx-auto text-green-500" />
            <div>
              <h3 className="text-lg font-semibold mb-2">Video Ready!</h3>
              <p className="text-sm text-gray-500">
                Your execution video has been generated successfully.
              </p>
            </div>
          </div>
        )}

        {exportStatus === "failed" && (
          <div className="space-y-4 py-8 text-center">
            <XCircle className="h-16 w-16 mx-auto text-red-500" />
            <div>
              <h3 className="text-lg font-semibold mb-2">Export Failed</h3>
              <p className="text-sm text-gray-500 mb-2">
                There was an error generating the video.
              </p>
              {errorMessage && (
                <p className="text-xs text-red-600 bg-red-50 p-2 rounded">
                  {errorMessage}
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {exportStatus === "idle" && (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={isExporting}
              >
                Cancel
              </Button>
              <Button onClick={handleExport} disabled={isExporting}>
                <Video className="h-4 w-4 mr-2" />
                Generate Video
              </Button>
            </>
          )}

          {exportStatus === "processing" && (
            <Button variant="outline" disabled>
              Processing...
            </Button>
          )}

          {exportStatus === "completed" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download Video
              </Button>
            </>
          )}

          {exportStatus === "failed" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={handleExport}>Try Again</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
