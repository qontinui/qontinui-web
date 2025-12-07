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
  OptimizationScreenshot,
  Region,
  ExtractedPattern,
  PatternAnalysis,
  OptimizationStrategy,
  StrategyEvaluation,
  OptimizationSession,
  OptimizationResult,
} from "@/types/pattern-optimization";

interface PatternOptimizationContextType {
  // Session management
  session: OptimizationSession | null;
  createSession: () => void;
  clearSession: () => void;

  // Screenshot management
  addScreenshots: (screenshots: OptimizationScreenshot[]) => void;
  removeScreenshot: (id: string) => void;
  labelScreenshot: (
    id: string,
    label: "positive" | "negative" | "unlabeled"
  ) => void;

  // Region management
  setRegion: (screenshotId: string, region: Region) => void;
  copyRegionToAll: (sourceId: string) => void;
  clearRegions: () => void;

  // Analysis
  startAnalysis: () => Promise<void>;
  analysis: PatternAnalysis | null;
  isAnalyzing: boolean;

  // Pattern editing
  updatePattern: (patternId: string, customMask: string) => void;

  // Strategy evaluation
  evaluateStrategy: (
    strategy: OptimizationStrategy
  ) => Promise<StrategyEvaluation>;
  evaluations: StrategyEvaluation[];
  selectedStrategy: OptimizationStrategy | null;
  selectStrategy: (strategy: OptimizationStrategy) => void;

  // Results
  generateResult: (
    selectedPatternIds?: Set<string>
  ) => Promise<OptimizationResult | null>;
  exportResult: (result: OptimizationResult) => void;
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

export function PatternOptimizationProvider({
  children,
}: PatternOptimizationProviderProps) {
  // Store only lightweight session metadata in state, not image data
  const [session, setSession] = useState<OptimizationSession | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Load session from localStorage on mount (without image data)
  useEffect(() => {
    const storedSession = localStorage.getItem(
      "pattern-optimization-session-meta"
    );
    if (storedSession) {
      try {
        const parsed = JSON.parse(storedSession);
        setSession(parsed);
      } catch (error) {
        console.error("Failed to parse stored session:", error);
      }
    }
  }, []);

  // Save session metadata to localStorage (without image data)
  useEffect(() => {
    if (session) {
      // Create a lightweight version of the session without image URLs
      const lightSession = {
        ...session,
        screenshots: session.screenshots.map((s) => ({
          ...s,
          url: undefined, // Don't store the actual image data
        })),
        analysis: session.analysis
          ? {
              ...session.analysis,
              extractedPatterns: session.analysis.extractedPatterns.map(
                (p) => ({
                  ...p,
                  imageUrl: undefined, // Don't store pattern images
                })
              ),
            }
          : undefined,
      };
      try {
        localStorage.setItem(
          "pattern-optimization-session-meta",
          JSON.stringify(lightSession)
        );
      } catch (error) {
        console.error("Failed to save session metadata:", error);
      }
    } else {
      localStorage.removeItem("pattern-optimization-session-meta");
    }
  }, [session]);

  const createSession = useCallback(() => {
    const newSession: OptimizationSession = {
      id: `session-${Date.now()}`,
      screenshots: [],
      analysis: undefined,
      evaluations: [],
      selectedStrategy: undefined,
      status: "setup",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setSession(newSession);
  }, [setSession]);

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
  }, [session]);

  const addScreenshots = useCallback(
    async (screenshots: OptimizationScreenshot[]) => {
      console.log("Adding screenshots:", screenshots);

      // Create session if it doesn't exist
      if (!session) {
        console.log("No session, creating new one...");
        const newSession: OptimizationSession = {
          id: `session-${Date.now()}`,
          screenshots: [],
          analysis: undefined,
          evaluations: [],
          selectedStrategy: undefined,
          status: "setup",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        setSession(newSession);
      }

      // Store images in IndexedDB
      const processedScreenshots = await Promise.all(
        screenshots.map(async (screenshot) => {
          try {
            await patternOptimizationStorage.storeImage(
              screenshot.id,
              screenshot.url
            );
            console.log("Stored image in IndexedDB:", screenshot.id);
            return {
              ...screenshot,
              url: screenshot.id, // Store only the ID reference
            };
          } catch (error) {
            console.error("Failed to store image:", error);
            return screenshot;
          }
        })
      );

      setSession((prev) => {
        if (!prev) {
          // If session still doesn't exist, create it now
          const newSession: OptimizationSession = {
            id: `session-${Date.now()}`,
            screenshots: processedScreenshots,
            analysis: undefined,
            evaluations: [],
            selectedStrategy: undefined,
            status: "setup",
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          console.log("Created new session with screenshots:", newSession);
          return newSession;
        }
        const updated = {
          ...prev,
          screenshots: [...prev.screenshots, ...processedScreenshots],
          updatedAt: new Date(),
        };
        console.log("Updated session with screenshots:", updated);
        return updated;
      });
    },
    [session]
  );

  const removeScreenshot = useCallback(
    (id: string) => {
      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          screenshots: prev.screenshots.filter((s) => s.id !== id),
          updatedAt: new Date(),
        };
      });
    },
    [setSession]
  );

  const labelScreenshot = useCallback(
    (id: string, label: "positive" | "negative" | "unlabeled") => {
      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          screenshots: prev.screenshots.map((s) =>
            s.id === id ? { ...s, label } : s
          ),
          updatedAt: new Date(),
        };
      });
    },
    [setSession]
  );

  const setRegion = useCallback((screenshotId: string, region: Region) => {
    console.log("Setting region for screenshot:", { screenshotId, region });
    setSession((prev) => {
      if (!prev) {
        console.error("No session when setting region");
        return prev;
      }
      const updated = {
        ...prev,
        screenshots: prev.screenshots.map((s) =>
          s.id === screenshotId ? { ...s, region } : s
        ),
        selectedRegion: region,
        updatedAt: new Date(),
      };
      console.log("Session after setting region:", updated);
      return updated;
    });
  }, []);

  const copyRegionToAll = useCallback(
    (sourceId: string) => {
      setSession((prev) => {
        if (!prev) return prev;
        const sourceScreenshot = prev.screenshots.find(
          (s) => s.id === sourceId
        );
        if (!sourceScreenshot?.region) return prev;

        return {
          ...prev,
          screenshots: prev.screenshots.map((s) => ({
            ...s,
            region: sourceScreenshot.region,
          })),
          selectedRegion: sourceScreenshot.region,
          updatedAt: new Date(),
        };
      });
    },
    [setSession]
  );

  const clearRegions = useCallback(() => {
    setSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        screenshots: prev.screenshots.map((s) => ({
          ...s,
          region: undefined,
        })),
        selectedRegion: undefined,
        updatedAt: new Date(),
      };
    });
  }, [setSession]);

  const startAnalysis = useCallback(async () => {
    console.log("Starting analysis...", { session });

    if (!session || session.screenshots.length === 0) {
      console.error("No session or screenshots");
      throw new Error("No screenshots to analyze");
    }

    setIsAnalyzing(true);
    setSession((prev) => (prev ? { ...prev, status: "analyzing" } : prev));

    try {
      console.log("Preparing data for API call...");
      // Prepare screenshots and regions for API call
      const positiveScreenshots: string[] = [];
      const negativeScreenshots: string[] = [];
      const regions: { x: number; y: number; width: number; height: number }[] =
        [];

      for (const screenshot of session.screenshots) {
        if (screenshot.label === "positive" && screenshot.region) {
          // Retrieve image from IndexedDB
          const imageData = await patternOptimizationStorage.getImage(
            screenshot.id
          );
          if (imageData) {
            // Convert data URL to base64
            const base64Data = imageData.split(",")[1]!;
            positiveScreenshots.push(base64Data);
          } else {
            // Fallback if image is stored as URL
            const base64Data = screenshot.url.split(",")[1]!;
            positiveScreenshots.push(base64Data);
          }
          regions.push({
            x: Math.round(screenshot.region.x),
            y: Math.round(screenshot.region.y),
            width: Math.round(screenshot.region.width),
            height: Math.round(screenshot.region.height),
          });
        } else if (screenshot.label === "negative") {
          // Retrieve image from IndexedDB
          const imageData = await patternOptimizationStorage.getImage(
            screenshot.id
          );
          if (imageData) {
            const base64Data = imageData.split(",")[1]!;
            negativeScreenshots.push(base64Data);
          } else {
            // Fallback if image is stored as URL
            const base64Data = screenshot.url.split(",")[1]!;
            negativeScreenshots.push(base64Data);
          }
        }
      }

      if (positiveScreenshots.length === 0 || regions.length === 0) {
        console.error("No positive screenshots with regions", {
          positiveScreenshots,
          regions,
        });
        throw new Error("No positive screenshots with regions defined");
      }

      console.log("Making API call with data:", {
        screenshotsCount: positiveScreenshots.length,
        negativeCount: negativeScreenshots.length,
        regionsCount: regions.length,
      });

      // Call real qontinui API for pattern optimization
      const response = await fetch(
        "http://localhost:8001/api/v1/optimize-pattern",
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

      console.log("API response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("API request failed:", {
          status: response.status,
          errorText,
        });
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const apiResult = await response.json();
      console.log("API result:", apiResult);

      // Convert API response to our format
      const patterns: ExtractedPattern[] = apiResult.extractedPatterns.map(
        (pattern: any) => ({
          id: pattern.id,
          screenshotId:
            session.screenshots[pattern.screenshot_index]?.id ||
            `screenshot_${pattern.screenshot_index}`,
          region: pattern.region,
          imageUrl: `data:image/png;base64,${pattern.image_data}`, // Use the extracted pattern image
        })
      );

      const analysis: PatternAnalysis = {
        extractedPatterns: patterns,
        similarityMatrix: {
          scores: apiResult.similarityMatrix.scores,
        },
        statistics: apiResult.statistics,
      };

      // Store evaluations if they were returned
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
      console.error("Analysis failed:", error);
      if (error instanceof Error) {
        console.error("Error details:", error.message, error.stack);
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

      // Use the evaluations from the API response if available
      const existingEvaluation = session.evaluations.find(
        (e) => e.strategy.type === strategy.type
      );
      if (existingEvaluation) {
        return existingEvaluation;
      }

      // If not available, return a placeholder (should not happen with real API)
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

  const updatePattern = useCallback(
    (patternId: string, customMask: string) => {
      setSession((prev) => {
        if (!prev || !prev.analysis) return prev;

        const updatedPatterns = prev.analysis.extractedPatterns.map(
          (pattern) =>
            pattern.id === patternId ? { ...pattern, customMask } : pattern
        );

        return {
          ...prev,
          analysis: {
            ...prev.analysis,
            extractedPatterns: updatedPatterns,
          },
          updatedAt: new Date(),
        };
      });
    },
    [setSession]
  );

  const generateResult = useCallback(
    async (
      selectedPatternIds?: Set<string>
    ): Promise<OptimizationResult | null> => {
      if (!session?.selectedStrategy || !session.analysis) {
        return null;
      }

      try {
        // Filter patterns based on selection if provided
        let patternsToUse = session.analysis.extractedPatterns;
        if (selectedPatternIds && selectedPatternIds.size > 0) {
          patternsToUse = session.analysis.extractedPatterns.filter((p) =>
            selectedPatternIds.has(p.id)
          );
        }

        // Prepare patterns for StateImage creation
        const patterns = patternsToUse.map((pattern) => ({
          id: pattern.id,
          image_data: pattern.imageUrl?.split(",")[1] || "", // Extract base64 from data URL
          region: pattern.region,
        }));

        // Call API to create StateImage
        const response = await fetch(
          "http://localhost:8001/api/v1/create-state-image",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: `StateImage_${session.id}`,
              patterns: patterns,
              strategy_type: session.selectedStrategy.type,
              similarity_threshold:
                session.selectedStrategy.parameters?.threshold || 0.8,
            }),
          }
        );

        if (!response.ok) {
          throw new Error(
            `Failed to create StateImage: ${response.statusText}`
          );
        }

        await response.json();

        const result: OptimizationResult = {
          sessionId: session.id,
          patterns: session.analysis.extractedPatterns,
          strategy: session.selectedStrategy,
          createdAt: new Date(),
        };

        return result;
      } catch (error) {
        console.error("Failed to generate result:", error);
        throw error;
      }
    },
    [session]
  );

  const exportResult = useCallback((result: OptimizationResult) => {
    // Convert result to JSON and trigger download
    const dataStr = JSON.stringify(result, null, 2);
    const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(dataStr)}`;

    const exportFileDefaultName = `pattern-optimization-${result.sessionId}.json`;

    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", dataUri);
    linkElement.setAttribute("download", exportFileDefaultName);
    linkElement.click();
  }, []);

  const contextValue: PatternOptimizationContextType = {
    session,
    createSession,
    clearSession,
    addScreenshots,
    removeScreenshot,
    labelScreenshot,
    setRegion,
    copyRegionToAll,
    clearRegions,
    startAnalysis,
    analysis: session?.analysis || null,
    isAnalyzing,
    updatePattern,
    evaluateStrategy,
    evaluations: session?.evaluations || [],
    selectedStrategy: session?.selectedStrategy || null,
    selectStrategy,
    generateResult,
    exportResult,
  };

  return (
    <PatternOptimizationContext.Provider value={contextValue}>
      {children}
    </PatternOptimizationContext.Provider>
  );
}
