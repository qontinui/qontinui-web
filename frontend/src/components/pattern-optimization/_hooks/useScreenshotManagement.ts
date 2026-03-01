import { useEffect, useRef } from "react";
import type { PatternSession, Screenshot } from "@/types/pattern-optimization";
import { urlToFile } from "../pattern-optimization-utils";

interface UseScreenshotManagementOptions {
  session: PatternSession | null;
  selectedScreenshotId: string | null;
  projectScreenshots: Array<{ id: string; url: string; name: string }>;
  createSession: () => void;
  addScreenshots: (files: File[]) => Promise<void>;
  setSelectedScreenshotId: (id: string | null) => void;
}

/**
 * Manages screenshot upload, project screenshot selection, and session initialization.
 */
export function useScreenshotManagement({
  session,
  selectedScreenshotId,
  projectScreenshots,
  createSession,
  addScreenshots,
  setSelectedScreenshotId,
}: UseScreenshotManagementOptions) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotSelectorTriggerRef = useRef<HTMLButtonElement>(null);

  // Initialize session on mount and select first screenshot
  useEffect(() => {
    if (!session) {
      createSession();
    } else if (session.screenshots?.length > 0 && !selectedScreenshotId) {
      const firstScreenshot = session.screenshots[0];
      if (firstScreenshot) {
        setSelectedScreenshotId(firstScreenshot.id);
      }
    }
  }, [session, createSession, selectedScreenshotId, setSelectedScreenshotId]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      await addScreenshots(files);
      // Select first screenshot after adding if none selected
      setTimeout(() => {
        if (!selectedScreenshotId && (session?.screenshots?.length ?? 0) > 0) {
          const firstScreenshot = session?.screenshots[0];
          if (firstScreenshot) {
            setSelectedScreenshotId(firstScreenshot.id);
          }
        }
      }, 100);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleProjectScreenshotSelect = async (screenshotIds: string[]) => {
    const files: File[] = [];
    for (const screenshotId of screenshotIds) {
      const projectScreenshot = projectScreenshots.find(
        (s) => s.id === screenshotId
      );
      if (projectScreenshot) {
        const file = await urlToFile(
          projectScreenshot.url,
          projectScreenshot.name
        );
        files.push(file);
      }
    }

    if (files.length > 0) {
      await addScreenshots(files);

      // Select the first newly added screenshot
      setTimeout(() => {
        if ((session?.screenshots?.length ?? 0) > 0) {
          const targetScreenshot =
            session?.screenshots[
              (session?.screenshots?.length ?? 0) - files.length
            ];
          if (targetScreenshot) {
            setSelectedScreenshotId(targetScreenshot.id);
          }
        }
      }, 100);
    }
  };

  const selectedScreenshot: Screenshot | undefined = session?.screenshots.find(
    (s) => s.id === selectedScreenshotId
  );

  return {
    fileInputRef,
    screenshotSelectorTriggerRef,
    selectedScreenshot,
    handleFileSelect,
    handleProjectScreenshotSelect,
  };
}
