import { useState } from "react";
import { toast } from "sonner";
import type {
  ExtractedPattern,
  Region,
  SnapshotScreenshot,
} from "@/types/direct-pattern-creation";

interface UsePatternExtractionArgs {
  screenshots: SnapshotScreenshot[];
  currentScreenshotIndex: number;
  selectedRegion: Region | null;
  setSelectedRegion: (region: Region | null) => void;
}

export function usePatternExtraction({
  screenshots,
  currentScreenshotIndex,
  selectedRegion,
  setSelectedRegion,
}: UsePatternExtractionArgs) {
  const [extractedPatterns, setExtractedPatterns] = useState<
    ExtractedPattern[]
  >([]);
  const [extracting, setExtracting] = useState(false);

  const handleExtractRegion = async () => {
    if (!selectedRegion || screenshots.length === 0) return;

    setExtracting(true);
    try {
      const currentScreenshot = screenshots[currentScreenshotIndex];
      if (!currentScreenshot) {
        throw new Error("No screenshot selected");
      }

      const img = new Image();
      img.crossOrigin = "anonymous";

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = currentScreenshot.url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = selectedRegion.width;
      canvas.height = selectedRegion.height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        throw new Error("Failed to get canvas context");
      }

      ctx.drawImage(
        img,
        selectedRegion.x,
        selectedRegion.y,
        selectedRegion.width,
        selectedRegion.height,
        0,
        0,
        selectedRegion.width,
        selectedRegion.height
      );

      const imageData = canvas.toDataURL("image/png");

      const pattern: ExtractedPattern = {
        id: `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: `Pattern_${extractedPatterns.length + 1}`,
        imageData,
        region: { ...selectedRegion },
        sourceScreenshotIndex: currentScreenshotIndex,
        sourceScreenshotUrl: currentScreenshot.url,
        sourceSnapshotId: currentScreenshot.snapshotRunId,
        states:
          currentScreenshot.active_states.length > 0
            ? currentScreenshot.active_states
            : ["default"],
        timestamp: new Date().toISOString(),
        monitors: currentScreenshot.monitors || [0],
      };

      setExtractedPatterns((prev) => [...prev, pattern]);
      setSelectedRegion(null);
      toast.success("Pattern extracted successfully");
    } catch (error) {
      console.error("Failed to extract pattern:", error);
      toast.error("Failed to extract pattern");
    } finally {
      setExtracting(false);
    }
  };

  const handleDeletePattern = (patternId: string) => {
    setExtractedPatterns((prev) => prev.filter((p) => p.id !== patternId));
    toast.success("Pattern deleted");
  };

  const handleUpdatePattern = (
    patternId: string,
    updates: Partial<ExtractedPattern>
  ) => {
    setExtractedPatterns((prev) =>
      prev.map((p) => (p.id === patternId ? { ...p, ...updates } : p))
    );
  };

  const existingRegions = extractedPatterns
    .filter((p) => p.sourceScreenshotIndex === currentScreenshotIndex)
    .map((p) => p.region);

  const clearPatterns = () => setExtractedPatterns([]);

  return {
    extractedPatterns,
    extracting,
    existingRegions,
    handleExtractRegion,
    handleDeletePattern,
    handleUpdatePattern,
    clearPatterns,
  };
}
