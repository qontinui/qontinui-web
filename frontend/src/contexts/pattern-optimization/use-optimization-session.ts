import { useState, useCallback, useEffect } from "react";
import { patternOptimizationStorage } from "@/lib/pattern-optimization-storage";
import type {
  OptimizationScreenshot,
  Region,
  OptimizationSession,
} from "@/types/pattern-optimization";

const STORAGE_KEY = "pattern-optimization-session-meta";

function createEmptySession(): OptimizationSession {
  return {
    id: `session-${Date.now()}`,
    screenshots: [],
    analysis: undefined,
    evaluations: [],
    selectedStrategy: undefined,
    status: "setup",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function stripImageData(session: OptimizationSession) {
  return {
    ...session,
    screenshots: session.screenshots.map((s) => ({
      ...s,
      url: undefined,
    })),
    analysis: session.analysis
      ? {
          ...session.analysis,
          extractedPatterns: session.analysis.extractedPatterns.map((p) => ({
            ...p,
            imageUrl: undefined,
          })),
        }
      : undefined,
  };
}

export function useOptimizationSession() {
  const [session, setSession] = useState<OptimizationSession | null>(null);

  // Load session from localStorage on mount
  useEffect(() => {
    const storedSession = localStorage.getItem(STORAGE_KEY);
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
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(stripImageData(session))
        );
      } catch (error) {
        console.error("Failed to save session metadata:", error);
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [session]);

  const createSession = useCallback(() => {
    setSession(createEmptySession());
  }, [setSession]);

  const clearSession = useCallback(async () => {
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

      if (!session) {
        console.log("No session, creating new one...");
        setSession(createEmptySession());
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
              url: screenshot.id,
            };
          } catch (error) {
            console.error("Failed to store image:", error);
            return screenshot;
          }
        })
      );

      setSession((prev) => {
        if (!prev) {
          const newSession = createEmptySession();
          newSession.screenshots = processedScreenshots;
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

  const setRegion = useCallback(
    (screenshotId: string, region: Region | null) => {
      console.log("Setting region for screenshot:", { screenshotId, region });
      setSession((prev) => {
        if (!prev) {
          console.error("No session when setting region");
          return prev;
        }
        const regionValue = region ?? undefined;
        const updated = {
          ...prev,
          screenshots: prev.screenshots.map((s) =>
            s.id === screenshotId ? { ...s, region: regionValue } : s
          ),
          selectedRegion: regionValue,
          updatedAt: new Date(),
        };
        console.log("Session after setting region:", updated);
        return updated;
      });
    },
    []
  );

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

  return {
    session,
    setSession,
    createSession,
    clearSession,
    addScreenshots,
    removeScreenshot,
    labelScreenshot,
    setRegion,
    copyRegionToAll,
    clearRegions,
    updatePattern,
  };
}
