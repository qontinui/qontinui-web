import { useState, useEffect, useCallback } from "react";
import { StateImage } from "../../../types/stateDiscovery";
import { createLogger } from "@/lib/logger";

const log = createLogger("useMaskedPatterns");
import {
  MaskedPattern,
  PatternExtractionConfig,
  PatternQualityAnalysis,
} from "../types";

const DEFAULT_EXTRACTION_CONFIG: PatternExtractionConfig = {
  similarityThreshold: 0.85,
  minActivePixels: 100,
  colorAveraging: "weighted",
  useAlphaChannel: false,
  morphologicalOps: {
    enabled: true,
    erosionSize: 1,
    dilationSize: 2,
  },
};

export function useMaskedPatterns() {
  const [patterns, setPatterns] = useState<MaskedPattern[]>([]);
  const [selectedPattern, setSelectedPattern] = useState<MaskedPattern | null>(
    null
  );
  const [stateImages, setStateImages] = useState<StateImage[]>([]);
  const [selectedStateImage, setSelectedStateImage] =
    useState<StateImage | null>(null);
  const [extractionConfig, setExtractionConfig] =
    useState<PatternExtractionConfig>(DEFAULT_EXTRACTION_CONFIG);
  const [isExtracting, setIsExtracting] = useState(false);
  const [patternName, setPatternName] = useState("");

  const fetchPatterns = async () => {
    try {
      const response = await fetch("/api/masks/patterns/masked");
      if (response.ok) {
        const data = await response.json();
        setPatterns(data);
      }
    } catch (error) {
      console.error("Failed to fetch masked patterns:", error);
    }
  };

  const fetchStateImages = async () => {
    try {
      // Fetch state images from the current project/analysis
      const response = await fetch("/api/state-discovery/state-images");
      if (response.ok) {
        const data = await response.json();
        setStateImages(data.state_images || []);
      }
    } catch (error) {
      console.error("Failed to fetch state images:", error);
    }
  };

  useEffect(() => {
    fetchPatterns();
    fetchStateImages();
  }, []);

  const extractMaskedPattern = async () => {
    if (!selectedStateImage || !patternName) return;

    setIsExtracting(true);
    try {
      const response = await fetch("/api/masks/patterns/extract-masked", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          state_image_id: selectedStateImage.id,
          pattern_name: patternName,
          config: extractionConfig,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        log.debug("Masked pattern extracted:", data.id);
        fetchPatterns(); // Refresh patterns list
        setPatternName("");
        setSelectedStateImage(null);
      }
    } catch (error) {
      console.error("Failed to extract masked pattern:", error);
    } finally {
      setIsExtracting(false);
    }
  };

  const updatePatternThreshold = async (
    patternId: string,
    newThreshold: number
  ) => {
    try {
      const response = await fetch(
        `/api/masks/patterns/${patternId}/update-threshold`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            similarity_threshold: newThreshold,
          }),
        }
      );

      if (response.ok) {
        await response.json();
        log.debug("Pattern threshold updated:", patternId);
        fetchPatterns(); // Refresh to get updated pattern
      }
    } catch (error) {
      console.error("Failed to update pattern threshold:", error);
    }
  };

  const analyzePatternQuality = useCallback(
    (pattern: MaskedPattern): PatternQualityAnalysis => {
      const density = pattern.maskDensity;
      const avgConf = pattern.avgConfidence;
      const stdDev = pattern.stdDevConfidence;

      let quality = "Poor";
      let qualityColor = "text-red-600";
      const recommendations: string[] = [];

      if (density < 0.1) {
        recommendations.push(
          "Very low mask density - consider lowering similarity threshold"
        );
      } else if (density > 0.9) {
        recommendations.push(
          "Very high mask density - pattern may be too general"
        );
      }

      if (stdDev > 0.3) {
        recommendations.push(
          "High confidence variance - pattern may be inconsistent"
        );
      }

      if (
        avgConf >= 0.9 &&
        density >= 0.3 &&
        density <= 0.8 &&
        stdDev <= 0.15
      ) {
        quality = "Excellent";
        qualityColor = "text-green-600";
      } else if (avgConf >= 0.75 && density >= 0.2 && stdDev <= 0.25) {
        quality = "Good";
        qualityColor = "text-blue-600";
      } else if (avgConf >= 0.6) {
        quality = "Fair";
        qualityColor = "text-yellow-600";
      }

      return { quality, qualityColor, recommendations };
    },
    []
  );

  return {
    patterns,
    selectedPattern,
    setSelectedPattern,
    stateImages,
    selectedStateImage,
    setSelectedStateImage,
    extractionConfig,
    setExtractionConfig,
    isExtracting,
    patternName,
    setPatternName,
    extractMaskedPattern,
    updatePatternThreshold,
    analyzePatternQuality,
  };
}
