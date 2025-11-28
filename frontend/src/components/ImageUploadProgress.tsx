"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface UploadingImage {
  name: string;
  progress: number;
}

interface ImageUploadProgressProps {
  uploads: UploadingImage[];
  onCancel?: (imageName: string) => void;
}

/**
 * ImageUploadProgress - Display upload progress for multiple simultaneous image uploads
 *
 * Features:
 * - Fixed position bottom-right corner
 * - Progress bar for each uploading image
 * - Displays filename and percentage
 * - Auto-hides when no uploads
 * - Responsive design
 */
export function ImageUploadProgress({
  uploads,
  onCancel,
}: ImageUploadProgressProps) {
  // Auto-hide when no uploads
  if (uploads.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-full max-w-sm"
      role="status"
      aria-live="polite"
      aria-label="Image upload progress"
    >
      <Card className="bg-[#27272A] border-gray-700 shadow-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-[#00D9FF] text-base flex items-center gap-2">
            <ImageIcon className="w-4 h-4" />
            Uploading Images
            <span className="text-xs text-gray-400 font-normal ml-auto">
              {uploads.length} {uploads.length === 1 ? "file" : "files"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 max-h-[60vh] overflow-y-auto">
          {uploads.map((upload, index) => (
            <div
              key={`${upload.name}-${index}`}
              className="space-y-1.5"
              role="progressbar"
              aria-valuenow={upload.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Uploading ${upload.name}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm text-gray-200 truncate"
                    title={upload.name}
                  >
                    {upload.name}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-gray-400 font-mono tabular-nums">
                    {Math.round(upload.progress)}%
                  </span>
                  {onCancel && upload.progress < 100 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-gray-400 hover:text-red-400 hover:bg-red-900/20"
                      onClick={() => onCancel(upload.name)}
                      aria-label={`Cancel uploading ${upload.name}`}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
              <Progress
                value={upload.progress}
                max={100}
                className="h-2"
                aria-hidden="true"
              />
              {upload.progress === 100 && (
                <p className="text-xs text-green-400">Complete</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
