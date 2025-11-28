"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect,
} from "react";
import { patternOptimizationStorage } from "@/lib/pattern-optimization-storage";
import type {
  Screenshot,
  Region,
  ExtractedPattern,
  ExtractionConfig,
  PatternSession,
  PatternQuality,
} from "@/types/pattern-optimization";

/**
 * Pattern Optimization Context - Simplified
 * Single Responsibility: Manage pattern extraction session state
 */
interface PatternOptimizationContextType {
  // Session management
  session: PatternSession | null;
  createSession: () => void;
  clearSession: () => void;

  // Screenshot management
  addScreenshots: (files: File[]) => Promise<void>;
  removeScreenshot: (id: string) => void;
  setScreenshotRegion: (id: string, region: Region) => void;
  setAllScreenshotRegions: (region: Region) => void;
  copyRegionToAll: (sourceId: string) => void;
  clearAllRegions: () => void;

  // Pattern extraction
  extractPattern: (config: ExtractionConfig) => Promise<void>;
  isExtracting: boolean;
  extractedPattern: ExtractedPattern | null;

  // Pattern quality
  analyzePatternQuality: (pattern: ExtractedPattern) => PatternQuality;

  // Export
  exportPattern: (pattern: ExtractedPattern) => void;
}

const PatternOptimizationContext = createContext<
  PatternOptimizationContextType | undefined
>(undefined);

export const usePatternOptimization = () => {
  const context = useContext(PatternOptimizationContext);
  if (!context) {
    throw new Error(
      "usePatternOptimization must be used within a PatternOptimizationProvider"
    );
  }
  return context;
};

interface PatternOptimizationProviderProps {
  children: ReactNode;
}

/**
 * Pattern Optimization Provider - Simplified
 * Manages the state for pattern extraction from screenshots
 */
export function PatternOptimizationProvider({
  children,
}: PatternOptimizationProviderProps) {
  const [session, setSession] = useState<PatternSession | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  // Load session from localStorage on mount
  useEffect(() => {
    const storedSession = localStorage.getItem("pattern-optimization-session");
    if (storedSession) {
      try {
        const parsed = JSON.parse(storedSession);
        // Restore dates
        parsed.createdAt = new Date(parsed.createdAt);
        parsed.updatedAt = new Date(parsed.updatedAt);
        parsed.screenshots.forEach((s: Screenshot) => {
          s.uploadedAt = new Date(s.uploadedAt);
        });
        setSession(parsed);
      } catch (error) {
        console.error("Failed to parse stored session:", error);
      }
    }
  }, []);

  // Save session to localStorage
  useEffect(() => {
    if (session) {
      try {
        localStorage.setItem(
          "pattern-optimization-session",
          JSON.stringify(session)
        );
      } catch (error) {
        console.error("Failed to save session:", error);
      }
    } else {
      localStorage.removeItem("pattern-optimization-session");
    }
  }, [session]);

  const createSession = useCallback(() => {
    const newSession: PatternSession = {
      id: `session-${Date.now()}`,
      screenshots: [],
      status: "setup",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setSession(newSession);
    console.log("[PatternOptimization] Created new session:", newSession.id);
  }, []);

  const clearSession = useCallback(async () => {
    // Clean up stored images
    if (session?.screenshots) {
      for (const screenshot of session.screenshots) {
        try {
          await patternOptimizationStorage.deleteImage(screenshot.id);
        } catch (error) {
          console.error("Failed to delete image:", error);
        }
      }
    }
    setSession(null);
    console.log("[PatternOptimization] Cleared session");
  }, [session]);

  const addScreenshots = useCallback(
    async (files: File[]) => {
      console.log("[PatternOptimization] Adding screenshots:", files.length);

      // Create session if it doesn't exist
      let currentSession = session;
      if (!currentSession) {
        currentSession = {
          id: `session-${Date.now()}`,
          screenshots: [],
          status: "setup",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }

      // Process screenshots
      const newScreenshots: Screenshot[] = [];
      for (const file of files) {
        const id = `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Read file as data URL
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsDataURL(file);
        });

        // Store in IndexedDB
        await patternOptimizationStorage.storeImage(id, dataUrl);

        newScreenshots.push({
          id,
          name: file.name,
          url: id, // Store ID as reference
          uploadedAt: new Date(),
        });
      }

      // Update session
      const updatedSession: PatternSession = {
        ...currentSession,
        screenshots: [...currentSession.screenshots, ...newScreenshots],
        updatedAt: new Date(),
      };

      setSession(updatedSession);
      console.log(
        "[PatternOptimization] Added screenshots:",
        newScreenshots.length
      );
    },
    [session]
  );

  const removeScreenshot = useCallback((id: string) => {
    setSession((prev) => {
      if (!prev) return prev;

      // Delete from IndexedDB
      patternOptimizationStorage.deleteImage(id).catch(console.error);

      return {
        ...prev,
        screenshots: prev.screenshots.filter((s) => s.id !== id),
        updatedAt: new Date(),
      };
    });
    console.log("[PatternOptimization] Removed screenshot:", id);
  }, []);

  const setScreenshotRegion = useCallback((id: string, region: Region) => {
    setSession((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        screenshots: prev.screenshots.map((s) =>
          s.id === id ? { ...s, region } : s
        ),
        updatedAt: new Date(),
      };
    });
    console.log("[PatternOptimization] Set region for screenshot:", id, region);
  }, []);

  const setAllScreenshotRegions = useCallback((region: Region) => {
    setSession((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        screenshots: prev.screenshots.map((s) => ({ ...s, region })),
        updatedAt: new Date(),
      };
    });
    console.log(
      "[PatternOptimization] Set region for all screenshots:",
      region
    );
  }, []);

  const copyRegionToAll = useCallback((sourceId: string) => {
    setSession((prev) => {
      if (!prev) return prev;

      const source = prev.screenshots.find((s) => s.id === sourceId);
      if (!source?.region) return prev;

      return {
        ...prev,
        screenshots: prev.screenshots.map((s) => ({
          ...s,
          region: source.region,
        })),
        updatedAt: new Date(),
      };
    });
    console.log("[PatternOptimization] Copied region from:", sourceId);
  }, []);

  const clearAllRegions = useCallback(() => {
    setSession((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        screenshots: prev.screenshots.map((s) => ({
          ...s,
          region: undefined,
        })),
        updatedAt: new Date(),
      };
    });
    console.log("[PatternOptimization] Cleared all regions");
  }, []);

  const extractPattern = useCallback(
    async (config: ExtractionConfig) => {
      if (!session || session.screenshots.length === 0) {
        throw new Error("No screenshots to extract pattern from");
      }

      // Check that all screenshots have regions
      const screenshotsWithRegions = session.screenshots.filter(
        (s) => s.region
      );
      if (screenshotsWithRegions.length === 0) {
        throw new Error("No regions selected for pattern extraction");
      }

      console.log(
        "[PatternOptimization] Extracting pattern with config:",
        config
      );
      setIsExtracting(true);

      setSession((prev) => (prev ? { ...prev, status: "extracting" } : prev));

      try {
        // Prepare cropped regions only (not full screenshots)
        const screenshots: string[] = [];
        const regions: {
          x: number;
          y: number;
          width: number;
          height: number;
        }[] = [];

        // Helper to extract region from image
        const extractRegion = async (
          dataUrl: string,
          region: Region
        ): Promise<string> => {
          return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              // Create canvas with region dimensions
              const canvas = document.createElement("canvas");
              canvas.width = region.width;
              canvas.height = region.height;
              const ctx = canvas.getContext("2d");

              // Draw only the selected region
              ctx?.drawImage(
                img,
                region.x,
                region.y,
                region.width,
                region.height, // Source rectangle
                0,
                0,
                region.width,
                region.height // Destination rectangle
              );

              // Convert to base64
              const croppedDataUrl = canvas.toDataURL("image/png");
              resolve(croppedDataUrl);
            };
            img.src = dataUrl;
          });
        };

        for (const screenshot of screenshotsWithRegions) {
          // Retrieve image from IndexedDB
          const imageData = await patternOptimizationStorage.getImage(
            screenshot.id
          );
          if (imageData && screenshot.region) {
            // Extract only the region, not the full image
            const croppedImage = await extractRegion(
              imageData,
              screenshot.region
            );
            const base64Data = croppedImage.split(",")[1];
            screenshots.push(base64Data);

            // Since we're sending cropped regions, the coordinates are now relative to the crop
            regions.push({
              x: 0,
              y: 0,
              width: Math.round(screenshot.region.width),
              height: Math.round(screenshot.region.height),
            });
          }
        }

        console.log(
          `[PatternOptimization] Sending ${screenshots.length} cropped regions`
        );

        // Call API for pattern extraction
        console.log(
          "[PatternOptimization] Sending API request to extract pattern..."
        );
        const requestBody = {
          state_image_id: "temp", // Not used in our simplified version
          pattern_name: `Pattern_${session.id}`,
          config: {
            similarityThreshold: config.similarityThreshold,
            minActivePixels: config.minActivePixels,
            colorAveraging: config.colorAveraging,
            morphologicalOps: config.morphologicalOps,
          },
          screenshots,
          regions,
        };
        // Calculate request size
        const requestSize = JSON.stringify(requestBody).length;
        console.log(
          "[PatternOptimization] Request size:",
          (requestSize / 1024 / 1024).toFixed(2),
          "MB"
        );
        console.log("[PatternOptimization] Request body summary:", {
          screenshots: requestBody.screenshots.length,
          screenshotSizes: requestBody.screenshots.map(
            (s) => (s.length / 1024).toFixed(1) + "KB"
          ),
          regions: requestBody.regions,
          config: requestBody.config,
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.error(
            "[PatternOptimization] Aborting request due to timeout"
          );
          controller.abort();
        }, 60000); // 60 second timeout

        let response;
        try {
          console.log(
            "[PatternOptimization] Sending fetch request to:",
            "http://localhost:8000/api/masked-patterns/extract-masked"
          );

          // Now send the actual request (using relative path through proxy)
          console.log("[PatternOptimization] Sending actual POST request...");
          response = await fetch("/api/masked-patterns/extract-masked", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
          console.log("[PatternOptimization] Fetch completed successfully");
        } catch (fetchError: any) {
          clearTimeout(timeoutId);
          console.error("[PatternOptimization] Fetch error:", fetchError);
          console.error("[PatternOptimization] Error stack:", fetchError.stack);
          if (fetchError.name === "AbortError") {
            throw new Error("Request timed out after 60 seconds");
          }
          throw fetchError;
        } finally {
          clearTimeout(timeoutId);
        }

        console.log(
          "[PatternOptimization] API response status:",
          response.status,
          response.statusText
        );
        console.log(
          "[PatternOptimization] Response headers:",
          response.headers
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error("[PatternOptimization] API error response:", errorText);
          throw new Error(
            `API request failed: ${response.status} ${response.statusText} - ${errorText}`
          );
        }

        let result;
        try {
          const responseText = await response.text();
          console.log(
            "[PatternOptimization] Raw response text length:",
            responseText.length
          );
          result = JSON.parse(responseText);
          console.log(
            "[PatternOptimization] Pattern extracted successfully:",
            result
          );
        } catch (parseError) {
          console.error(
            "[PatternOptimization] Failed to parse response:",
            parseError
          );
          throw new Error("Failed to parse API response");
        }

        // Get detailed pattern data including images
        const detailsResponse = await fetch(
          `/api/masked-patterns/${result.id}`
        );
        if (!detailsResponse.ok) {
          throw new Error(
            `Failed to get pattern details: ${detailsResponse.statusText}`
          );
        }
        const details = await detailsResponse.json();
        console.log("[PatternOptimization] Pattern details:", details);

        // Create ExtractedPattern object
        const extractedPattern: ExtractedPattern = {
          id: result.id,
          name: result.name,
          width: result.width,
          height: result.height,
          patternImage: details.pattern_image || "",
          confidenceMap: details.confidence_image || "",
          maskImage: details.mask_image || "",
          maskDensity: result.maskDensity,
          activePixels: result.activePixels,
          totalPixels: result.totalPixels,
          minConfidence: result.minConfidence,
          maxConfidence: result.maxConfidence,
          avgConfidence: result.avgConfidence,
          stdDevConfidence: result.stdDevConfidence,
          config,
          sourceScreenshotIds: screenshotsWithRegions.map((s) => s.id),
          createdAt: new Date(),
        };

        setSession((prev) =>
          prev
            ? {
                ...prev,
                extractedPattern,
                status: "complete",
                updatedAt: new Date(),
              }
            : prev
        );

        console.log(
          "[PatternOptimization] Extraction successful! Pattern saved to session:",
          extractedPattern
        );
      } catch (error: any) {
        console.error("[PatternOptimization] Extraction failed:", error);

        if (error.name === "AbortError") {
          console.error(
            "[PatternOptimization] Request timed out after 60 seconds"
          );
        }

        console.error("[PatternOptimization] Error details:", {
          name: error.name,
          message: error.message,
          stack: error.stack,
        });
        setSession((prev) => (prev ? { ...prev, status: "error" } : prev));
        throw error;
      } finally {
        setIsExtracting(false);
        console.log(
          "[PatternOptimization] Extraction finished, isExtracting set to false"
        );
      }
    },
    [session]
  );

  const analyzePatternQuality = useCallback(
    (pattern: ExtractedPattern): PatternQuality => {
      const density = pattern.maskDensity;
      const avgConf = pattern.avgConfidence;
      const stdDev = pattern.stdDevConfidence;

      let score = 0;
      const recommendations: string[] = [];

      // Density score (ideal: 30-80%)
      if (density >= 0.3 && density <= 0.8) {
        score += 30;
      } else if (density >= 0.2 && density <= 0.9) {
        score += 20;
      } else if (density >= 0.1 && density <= 0.95) {
        score += 10;
      }

      if (density < 0.1) {
        recommendations.push(
          "Pattern has very low mask density - consider lowering similarity threshold"
        );
      } else if (density > 0.9) {
        recommendations.push(
          "Pattern has very high mask density - may be too general"
        );
      }

      // Confidence score
      if (avgConf >= 0.9) score += 40;
      else if (avgConf >= 0.8) score += 30;
      else if (avgConf >= 0.7) score += 20;
      else if (avgConf >= 0.6) score += 10;

      if (avgConf < 0.7) {
        recommendations.push(
          "Low average confidence - screenshots may be too different"
        );
      }

      // Variance score (lower is better)
      if (stdDev <= 0.1) score += 30;
      else if (stdDev <= 0.2) score += 20;
      else if (stdDev <= 0.3) score += 10;

      if (stdDev > 0.3) {
        recommendations.push(
          "High confidence variance - pattern may be inconsistent"
        );
      }

      // Determine rating
      let rating: PatternQuality["rating"];
      if (score >= 80) rating = "excellent";
      else if (score >= 60) rating = "good";
      else if (score >= 40) rating = "fair";
      else rating = "poor";

      if (rating === "excellent" && recommendations.length === 0) {
        recommendations.push("Pattern quality is excellent!");
      }

      return { rating, score, recommendations };
    },
    []
  );

  const exportPattern = useCallback(
    (pattern: ExtractedPattern) => {
      const exportData = {
        pattern: {
          id: pattern.id,
          name: pattern.name,
          dimensions: { width: pattern.width, height: pattern.height },
          statistics: {
            maskDensity: pattern.maskDensity,
            activePixels: pattern.activePixels,
            totalPixels: pattern.totalPixels,
            confidence: {
              min: pattern.minConfidence,
              max: pattern.maxConfidence,
              avg: pattern.avgConfidence,
              stdDev: pattern.stdDevConfidence,
            },
          },
          config: pattern.config,
          images: {
            pattern: pattern.patternImage,
            confidence: pattern.confidenceMap,
            mask: pattern.maskImage,
          },
        },
        metadata: {
          createdAt: pattern.createdAt,
          sourceScreenshots: pattern.sourceScreenshotIds.length,
          sessionId: session?.id,
        },
      };

      const dataStr = JSON.stringify(exportData, null, 2);
      const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(dataStr)}`;

      const filename = `pattern-${pattern.name}-${Date.now()}.json`;

      const link = document.createElement("a");
      link.setAttribute("href", dataUri);
      link.setAttribute("download", filename);
      link.click();

      console.log("[PatternOptimization] Exported pattern:", pattern.id);
    },
    [session]
  );

  const contextValue: PatternOptimizationContextType = {
    session,
    createSession,
    clearSession,
    addScreenshots,
    removeScreenshot,
    setScreenshotRegion,
    setAllScreenshotRegions,
    copyRegionToAll,
    clearAllRegions,
    extractPattern,
    isExtracting,
    extractedPattern: session?.extractedPattern || null,
    analyzePatternQuality,
    exportPattern,
  };

  return (
    <PatternOptimizationContext.Provider value={contextValue}>
      {children}
    </PatternOptimizationContext.Provider>
  );
}
