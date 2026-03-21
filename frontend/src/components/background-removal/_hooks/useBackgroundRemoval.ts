import { useState, useCallback } from "react";
import { toast } from "sonner";
import {
  BackgroundRemovalConfig,
  BackgroundRemovalResult,
  DEFAULT_BACKGROUND_REMOVAL_CONFIG,
  BACKGROUND_REMOVAL_PRESETS,
  PresetName,
} from "@/types/backgroundRemoval";
import { useAutomation } from "@/contexts/automation-context";
import { createLogger } from "@/lib/logger";

const log = createLogger("useBackgroundRemoval");

export function useBackgroundRemoval() {
  const [selectedScreenshotIds, setSelectedScreenshotIds] = useState<string[]>(
    []
  );
  const [selectedScreenshotIndex, setSelectedScreenshotIndex] = useState(0);
  const [config, setConfig] = useState<BackgroundRemovalConfig>(
    DEFAULT_BACKGROUND_REMOVAL_CONFIG
  );
  const [result, setResult] = useState<BackgroundRemovalResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<PresetName>("balanced");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { screenshots: projectScreenshots } = useAutomation();

  // Get selected screenshots from project screenshots
  const selectedScreenshots = projectScreenshots.filter((s) =>
    selectedScreenshotIds.includes(s.id)
  );

  const selectedScreenshot = selectedScreenshots[selectedScreenshotIndex];

  // Handle screenshot selection
  const handleScreenshotsSelected = useCallback((screenshotIds: string[]) => {
    setSelectedScreenshotIds(screenshotIds);
    setSelectedScreenshotIndex(0);
    setResult(null); // Clear previous results when selection changes
    toast.success(`Selected ${screenshotIds.length} screenshot(s)`);
  }, []);

  // Handle preset selection
  const handlePresetChange = useCallback((preset: PresetName) => {
    setActivePreset(preset);
    setConfig(BACKGROUND_REMOVAL_PRESETS[preset]);
    toast.info(`Applied preset: ${preset}`);
  }, []);

  // Handle background removal
  const handleRemoveBackground = useCallback(async () => {
    if (selectedScreenshots.length < 2) {
      toast.error("Please select at least 2 screenshots");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      log.debug("Selected screenshots:", selectedScreenshots.length);

      // Prepare request
      const requestBody = {
        screenshots: selectedScreenshots.map((s) => s.url),
        config: {
          use_temporal_variance: config.useTemporalVariance,
          use_edge_density: config.useEdgeDensity,
          use_uniformity: config.useUniformity,
          variance_threshold: config.varianceThreshold,
          min_screenshots_for_variance: config.minScreenshotsForVariance,
          edge_density_threshold: config.edgeDensityThreshold,
          edge_kernel_size: config.edgeKernelSize,
          uniformity_threshold: config.uniformityThreshold,
          uniformity_region_size: config.uniformityRegionSize,
          apply_morphology: config.applyMorphology,
          morphology_kernel_size: config.morphologyKernelSize,
          min_foreground_region_size: config.minForegroundRegionSize,
          foreground_alpha: config.foregroundAlpha,
          background_alpha: config.backgroundAlpha,
        },
        debug: false,
      };

      // Call API
      const response = await fetch("/api/v1/remove-background", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: "Unknown error" }));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      const data = await response.json();

      // Convert API response to frontend format
      const result: BackgroundRemovalResult = {
        maskedScreenshots: data.masked_screenshots,
        statistics: {
          totalPixels: data.statistics.total_pixels,
          backgroundPixels: data.statistics.background_pixels,
          foregroundPixels: data.statistics.foreground_pixels,
          backgroundPercentage: data.statistics.background_percentage,
          foregroundPercentage: data.statistics.foreground_percentage,
          numScreenshots: data.statistics.num_screenshots,
          imageSize: data.statistics.image_size,
        },
        backgroundMask: data.background_mask,
      };

      setResult(result);
      toast.success("Background removal complete!");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      toast.error(`Failed to remove backgrounds: ${errorMessage}`);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedScreenshots, config]);

  // Handle download results
  const handleDownloadResults = useCallback(() => {
    if (!result) return;

    result.maskedScreenshots.forEach((dataUrl, index) => {
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `masked_${selectedScreenshots[index]?.name ?? "screenshot"}`;
      link.click();
    });

    toast.success("Downloaded processed screenshots");
  }, [result, selectedScreenshots]);

  return {
    selectedScreenshotIds,
    selectedScreenshotIndex,
    setSelectedScreenshotIndex,
    selectedScreenshots,
    selectedScreenshot,
    config,
    setConfig,
    result,
    isProcessing,
    error,
    activePreset,
    showAdvanced,
    setShowAdvanced,
    handleScreenshotsSelected,
    handlePresetChange,
    handleRemoveBackground,
    handleDownloadResults,
  };
}
