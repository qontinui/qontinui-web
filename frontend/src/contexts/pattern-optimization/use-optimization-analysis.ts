import { useState, useCallback } from "react";
import { patternOptimizationStorage } from "@/lib/pattern-optimization-storage";
import type {
  ExtractedPattern,
  PatternAnalysis,
  OptimizationStrategy,
  StrategyEvaluation,
  OptimizationSession,
} from "@/types/pattern-optimization";
import { createLogger } from "@/lib/logger";

const log = createLogger("OptimizationAnalysis");

interface ApiExtractedPattern {
  id: string | number;
  screenshot_index: number;
  region: { x: number; y: number; width: number; height: number };
  image_data: string;
}

async function getScreenshotBase64(
  screenshotId: string,
  fallbackUrl: string
): Promise<string> {
  const imageData = await patternOptimizationStorage.getImage(screenshotId);
  if (imageData) {
    return imageData.split(",")[1]!;
  }
  return fallbackUrl.split(",")[1]!;
}

export function useOptimizationAnalysis(
  session: OptimizationSession | null,
  setSession: React.Dispatch<React.SetStateAction<OptimizationSession | null>>
) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const startAnalysis = useCallback(async () => {
    log.debug("Starting analysis...", { session });

    if (!session || session.screenshots.length === 0) {
      log.error("No session or screenshots");
      throw new Error("No screenshots to analyze");
    }

    setIsAnalyzing(true);
    setSession((prev) => (prev ? { ...prev, status: "analyzing" } : prev));

    try {
      log.debug("Preparing data for API call...");
      const positiveScreenshots: string[] = [];
      const negativeScreenshots: string[] = [];
      const regions: { x: number; y: number; width: number; height: number }[] =
        [];

      for (const screenshot of session.screenshots) {
        if (screenshot.label === "positive" && screenshot.region) {
          const base64Data = await getScreenshotBase64(
            screenshot.id,
            screenshot.url
          );
          positiveScreenshots.push(base64Data);
          regions.push({
            x: Math.round(screenshot.region.x),
            y: Math.round(screenshot.region.y),
            width: Math.round(screenshot.region.width),
            height: Math.round(screenshot.region.height),
          });
        } else if (screenshot.label === "negative") {
          const base64Data = await getScreenshotBase64(
            screenshot.id,
            screenshot.url
          );
          negativeScreenshots.push(base64Data);
        }
      }

      if (positiveScreenshots.length === 0 || regions.length === 0) {
        log.error("No positive screenshots with regions", {
          positiveScreenshots,
          regions,
        });
        throw new Error("No positive screenshots with regions defined");
      }

      log.debug("Making API call", {
        screenshotsCount: positiveScreenshots.length,
        negativeCount: negativeScreenshots.length,
        regionsCount: regions.length,
      });

      const response = await fetch(
        "http://127.0.0.1:9876/api/v1/optimize-pattern",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            screenshots: positiveScreenshots,
            negative_screenshots: negativeScreenshots,
            regions: regions,
            strategies: [
              "multi-pattern",
              "consensus",
              "feature-based",
              "differential",
            ],
          }),
        }
      );

      log.debug("API response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        log.error("API request failed:", {
          status: response.status,
          errorText,
        });
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const apiResult = await response.json();
      log.debug("API result:", apiResult);

      const patterns: ExtractedPattern[] = apiResult.extractedPatterns.map(
        (pattern: ApiExtractedPattern) => ({
          id: String(pattern.id),
          screenshotId:
            session.screenshots[pattern.screenshot_index]?.id ||
            `screenshot_${pattern.screenshot_index}`,
          region: pattern.region,
          imageUrl: `data:image/png;base64,${pattern.image_data}`,
        })
      );

      const analysis: PatternAnalysis = {
        extractedPatterns: patterns,
        similarityMatrix: {
          scores: apiResult.similarityMatrix.scores,
        },
        statistics: apiResult.statistics,
      };

      const evaluations = apiResult.evaluations || [];

      setSession((prev) =>
        prev
          ? {
              ...prev,
              analysis,
              evaluations,
              status: "complete",
              updatedAt: new Date(),
            }
          : prev
      );
    } catch (error) {
      log.error("Analysis failed:", error);
      if (error instanceof Error) {
        log.error("Error details:", error.message, error.stack);
      }
      setSession((prev) => (prev ? { ...prev, status: "error" } : prev));
      throw error;
    } finally {
      setIsAnalyzing(false);
    }
  }, [session, setSession]);

  const evaluateStrategy = useCallback(
    async (strategy: OptimizationStrategy): Promise<StrategyEvaluation> => {
      if (!session?.analysis) {
        throw new Error("No analysis available");
      }

      const existingEvaluation = session.evaluations.find(
        (e) => e.strategy.type === strategy.type
      );
      if (existingEvaluation) {
        return existingEvaluation;
      }

      const evaluation: StrategyEvaluation = {
        strategy,
        performance: {
          truePositiveRate: 0.85,
          falsePositiveRate: 0.05,
          averageConfidence: 0.8,
          processingTime: 100,
        },
        recommendations: {
          confidenceLevel: "medium",
        },
      };

      setSession((prev) => {
        if (!prev) return prev;
        const evaluations = [
          ...prev.evaluations.filter((e) => e.strategy.type !== strategy.type),
          evaluation,
        ];
        return {
          ...prev,
          evaluations,
          updatedAt: new Date(),
        };
      });

      return evaluation;
    },
    [session, setSession]
  );

  const selectStrategy = useCallback(
    (strategy: OptimizationStrategy) => {
      setSession((prev) =>
        prev
          ? {
              ...prev,
              selectedStrategy: strategy,
              updatedAt: new Date(),
            }
          : prev
      );
    },
    [setSession]
  );

  return {
    isAnalyzing,
    startAnalysis,
    evaluateStrategy,
    selectStrategy,
  };
}
