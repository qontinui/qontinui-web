/**
 * Vision Extraction Prompt Component
 *
 * Prompt component for vision extraction when no results available.
 * Allows user to select a screenshot and run vision extraction.
 */

"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, FileImage, Play } from "lucide-react";
import { toast } from "sonner";
import { runnerClient } from "@/lib/runner-client";
import { createLogger } from "@/lib/logger";
const logger = createLogger("VisionExtractionPrompt");

interface VisionExtractionPromptProps {
  isRunning: boolean;
  onRunExtraction: (screenshotBase64: string) => void;
  extractionId?: string;
  technique: string;
}

export function VisionExtractionPrompt({
  isRunning,
  onRunExtraction,
  extractionId,
  technique,
}: VisionExtractionPromptProps) {
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(
    null
  );
  const [loadingScreenshot, setLoadingScreenshot] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load screenshot from extraction
  const handleLoadScreenshot = async (screenshotId: string) => {
    if (!extractionId) return;
    setLoadingScreenshot(true);
    try {
      const result = await runnerClient.getExtractionScreenshot(
        extractionId,
        screenshotId
      );
      if (result.success && result.blob) {
        // Convert blob to base64
        const reader = new FileReader();
        reader.onloadend = () => {
          setSelectedScreenshot(reader.result as string);
        };
        reader.readAsDataURL(result.blob);
      } else {
        toast.error(result.error || "Failed to load screenshot");
      }
    } catch (error) {
      logger.error("Failed to load screenshot:", error);
      toast.error("Failed to load screenshot");
    } finally {
      setLoadingScreenshot(false);
    }
  };

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      setSelectedScreenshot(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="text-center">
        <h3 className="text-lg font-medium mb-2">Run {technique}</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Select a screenshot to analyze with {technique.toLowerCase()}. Vision
          extraction runs on your desktop via the Runner.
        </p>
      </div>

      {selectedScreenshot ? (
        <div className="flex flex-col items-center gap-4">
          <div className="border rounded-lg overflow-hidden max-w-[600px] max-h-[300px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selectedScreenshot}
              alt="Selected screenshot"
              className="object-contain w-full h-full"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setSelectedScreenshot(null)}
            >
              Clear
            </Button>
            <Button
              onClick={() => onRunExtraction(selectedScreenshot)}
              disabled={isRunning}
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Run {technique}
                </>
              )}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileUpload}
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={loadingScreenshot}
            >
              <FileImage className="mr-2 h-4 w-4" />
              Upload Screenshot
            </Button>
            {extractionId && (
              <Button
                variant="outline"
                onClick={() => handleLoadScreenshot("0")}
                disabled={loadingScreenshot}
              >
                {loadingScreenshot ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileImage className="mr-2 h-4 w-4" />
                )}
                Load from Extraction
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Upload an image or load from the current extraction
          </p>
        </div>
      )}
    </div>
  );
}
