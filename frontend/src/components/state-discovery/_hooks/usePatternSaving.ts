import { useState } from "react";
import { toast } from "sonner";
import type {
  ExtractedPattern,
  PatternSaveResult,
} from "@/types/direct-pattern-creation";
import { useAutomation } from "@/contexts/automation-context";

interface UsePatternSavingArgs {
  extractedPatterns: ExtractedPattern[];
  clearPatterns: () => void;
  clearSnapshots: () => void;
}

export function usePatternSaving({
  extractedPatterns,
  clearPatterns,
  clearSnapshots,
}: UsePatternSavingArgs) {
  const { addImage } = useAutomation();
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);

  const handleSavePatterns = async () => {
    if (extractedPatterns.length === 0) return;

    setSaving(true);
    setSaveProgress(0);

    try {
      const errors: Array<{ patternId: string; error: string }> = [];
      let savedCount = 0;

      for (let i = 0; i < extractedPatterns.length; i++) {
        const pattern = extractedPatterns[i];
        if (!pattern) continue;

        try {
          const imageAsset = {
            id: `image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: pattern.name,
            url: pattern.imageData,
            size: Math.ceil(
              (pattern.imageData.split(",")[1]?.length || 0) * 0.75
            ),
            createdAt: new Date(),
            usageCount: 0,
            usage: [],
            source: "image_extraction" as const,
            monitors: pattern.monitors || [0],
          };

          addImage(imageAsset);
          savedCount++;
        } catch (error) {
          console.error(`Failed to save pattern ${pattern.id}:`, error);
          errors.push({
            patternId: pattern.id,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }

        setSaveProgress(Math.round(((i + 1) / extractedPatterns.length) * 100));
      }

      const result: PatternSaveResult = {
        success: errors.length === 0,
        savedPatterns: savedCount,
        errors,
      };

      if (result.success) {
        toast.success(
          `Successfully saved ${savedCount} pattern(s) to image library`
        );
        clearPatterns();
        clearSnapshots();
      } else {
        toast.warning(
          `Saved ${savedCount}/${extractedPatterns.length} patterns. ${errors.length} failed.`
        );
      }
    } catch (error) {
      console.error("Failed to save patterns:", error);
      toast.error("Failed to save patterns");
    } finally {
      setSaving(false);
      setSaveProgress(0);
    }
  };

  return {
    saving,
    saveProgress,
    handleSavePatterns,
  };
}
