import { useState, useCallback, useEffect } from "react";
import { patternOptimizationStorage } from "@/lib/pattern-optimization-storage";
import { createLogger } from "@/lib/logger";
import type {
  Screenshot,
  Region,
  PatternSession,
} from "@/types/pattern-optimization";

const logger = createLogger("PatternSession");

const STORAGE_KEY = "pattern-optimization-session";

export function usePatternSession() {
  const [session, setSession] = useState<PatternSession | null>(null);

  // Load session from localStorage on mount
  useEffect(() => {
    const storedSession = localStorage.getItem(STORAGE_KEY);
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
        logger.error("Failed to parse stored session:", error);
      }
    }
  }, []);

  // Save session to localStorage
  useEffect(() => {
    if (session) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      } catch (error) {
        logger.error("Failed to save session:", error);
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
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
    logger.debug("Created new session:", newSession.id);
  }, []);

  const clearSession = useCallback(async () => {
    // Clean up stored images
    if (session?.screenshots) {
      for (const screenshot of session.screenshots) {
        try {
          await patternOptimizationStorage.deleteImage(screenshot.id);
        } catch (error) {
          logger.error("Failed to delete image:", error);
        }
      }
    }
    setSession(null);
    logger.debug("Cleared session");
  }, [session]);

  const addScreenshots = useCallback(
    async (files: File[]) => {
      logger.debug("Adding screenshots:", files.length);

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
      logger.debug("Added screenshots:", newScreenshots.length);
    },
    [session]
  );

  const removeScreenshot = useCallback((id: string) => {
    setSession((prev) => {
      if (!prev) return prev;

      // Delete from IndexedDB
      patternOptimizationStorage
        .deleteImage(id)
        .catch((err) => logger.error("Failed to delete image:", err));

      return {
        ...prev,
        screenshots: prev.screenshots.filter((s) => s.id !== id),
        updatedAt: new Date(),
      };
    });
    logger.debug("Removed screenshot:", id);
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
    logger.debug("Set region for screenshot:", id, region);
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
    logger.debug("Set region for all screenshots:", region);
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
    logger.debug("Copied region from:", sourceId);
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
    logger.debug("Cleared all regions");
  }, []);

  return {
    session,
    setSession,
    createSession,
    clearSession,
    addScreenshots,
    removeScreenshot,
    setScreenshotRegion,
    setAllScreenshotRegions,
    copyRegionToAll,
    clearAllRegions,
  };
}
