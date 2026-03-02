import { useCallback } from "react";
import type { VisionExtractionConfig } from "@/types/extraction-unified";

export function useVisionConfig(
  config: VisionExtractionConfig,
  onConfigChange: (config: VisionExtractionConfig) => void
) {
  const updateConfig = useCallback(
    (updates: Partial<VisionExtractionConfig>) => {
      onConfigChange({ ...config, ...updates });
    },
    [config, onConfigChange]
  );

  const updateEdgeDetection = useCallback(
    (updates: Partial<VisionExtractionConfig["edgeDetection"]>) => {
      onConfigChange({
        ...config,
        edgeDetection: { ...config.edgeDetection, ...updates },
      });
    },
    [config, onConfigChange]
  );

  const updateSam3 = useCallback(
    (updates: Partial<VisionExtractionConfig["sam3"]>) => {
      onConfigChange({
        ...config,
        sam3: { ...config.sam3, ...updates },
      });
    },
    [config, onConfigChange]
  );

  const updateOcr = useCallback(
    (updates: Partial<VisionExtractionConfig["ocr"]>) => {
      onConfigChange({
        ...config,
        ocr: { ...config.ocr, ...updates },
      });
    },
    [config, onConfigChange]
  );

  const updateFusion = useCallback(
    (updates: Partial<VisionExtractionConfig["fusion"]>) => {
      onConfigChange({
        ...config,
        fusion: { ...config.fusion, ...updates },
      });
    },
    [config, onConfigChange]
  );

  return {
    updateConfig,
    updateEdgeDetection,
    updateSam3,
    updateOcr,
    updateFusion,
  };
}
