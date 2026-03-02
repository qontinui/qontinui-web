import { useCallback, useRef, useState, useEffect, useMemo } from "react";
import { calculateImageHashes } from "@/utils/imageUtils";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface APIProjectScreenshot {
  hash: string;
}

interface ProjectScreenshot {
  id: string;
  name: string;
  hash: string;
  size: number;
  createdAt: string;
  thumbnailUrl?: string;
}

export interface SaveMessage {
  type: "success" | "error" | "info";
  text: string;
}

export function useScreenshotUploader(
  screenshots: File[],
  onUpload: (files: File[]) => void
) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [screenshotHashes, setScreenshotHashes] = useState<Map<string, string>>(
    new Map()
  );
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [showSnapshotSelector, setShowSnapshotSelector] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<SaveMessage | null>(null);
  const [selectedMonitors, setSelectedMonitors] = useState<number[]>([0]); // Default to primary monitor

  // Load project screenshots (hashes + count) on mount
  const { data: projectScreenshotsData } = useQuery({
    queryKey: ["projectScreenshots", "default"],
    queryFn: async ({ signal }) => {
      const projectId = "default";
      const response = await fetch(
        `http://localhost:8000/api/state-discovery/project/${projectId}/screenshots`,
        { signal }
      );
      if (!response.ok) {
        throw new Error("Failed to load project screenshots");
      }
      return response.json();
    },
    staleTime: 30 * 1000,
  });

  // Derive project hashes from query data
  const projectHashes = useMemo(() => {
    if (!projectScreenshotsData?.screenshots) return [];
    return projectScreenshotsData.screenshots.map(
      (s: APIProjectScreenshot) => s.hash
    );
  }, [projectScreenshotsData]);

  // Show info message when saved project screenshots are available (on initial load)
  const hasShownSavedMessageRef = useRef(false);
  useEffect(() => {
    if (
      !hasShownSavedMessageRef.current &&
      projectScreenshotsData?.screenshots &&
      screenshots.length === 0 &&
      projectScreenshotsData.screenshots.length > 0
    ) {
      hasShownSavedMessageRef.current = true;
      console.log(
        "[ScreenshotUploader] Loading saved screenshots:",
        projectScreenshotsData.screenshots.length
      );
      setSaveMessage({
        type: "info",
        text: `${projectScreenshotsData.screenshots.length} saved screenshot(s) available. Use "Load from Project" to restore them.`,
      });
    }
  }, [projectScreenshotsData, screenshots.length]);

  // Handle file selection
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        onUpload(files);
      }
    },
    [onUpload]
  );

  // Handle drag and drop
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/")
      );
      if (files.length > 0) {
        onUpload(files);
      }
    },
    [onUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Remove screenshot
  const handleRemove = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.stopPropagation();
      const newScreenshots = screenshots.filter((_, i) => i !== index);
      onUpload(newScreenshots);
    },
    [screenshots, onUpload]
  );

  // Calculate hashes when screenshots change
  useEffect(() => {
    const calculateHashes = async () => {
      if (screenshots.length > 0) {
        const hashes = await calculateImageHashes(screenshots);
        setScreenshotHashes(hashes);

        // Check for duplicates against project hashes
        let duplicates = 0;
        hashes.forEach((hash) => {
          if (projectHashes.includes(hash)) {
            duplicates++;
          }
        });
        setDuplicateCount(duplicates);
      }
    };

    calculateHashes();
  }, [screenshots, projectHashes]);

  // Handle saving screenshots to project
  const handleSaveToProject = async () => {
    if (screenshots.length === 0) return;

    setIsSaving(true);
    setSaveMessage(null);

    try {
      // Create FormData with screenshots
      const formData = new FormData();
      screenshots.forEach((file) => {
        formData.append("files", file);
      });
      // Add monitors metadata
      formData.append("monitors", JSON.stringify(selectedMonitors));
      // Use default project ID for now
      const projectId = "default";

      // Call actual API to save screenshots
      const response = await fetch(
        `http://localhost:8000/api/state-discovery/project/${projectId}/screenshots`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (!response.ok) {
        throw new Error("Failed to save screenshots");
      }

      const result = await response.json();

      // Update message based on result
      if (result.total_saved === 0) {
        setSaveMessage({
          type: "error",
          text: `All ${result.total_duplicates} screenshot(s) already exist in the project.`,
        });
      } else {
        setSaveMessage({
          type: "success",
          text: `Saved ${result.total_saved} screenshot(s) to project.${result.total_duplicates > 0 ? ` ${result.total_duplicates} duplicate(s) skipped.` : ""}`,
        });

        // Invalidate the project screenshots query to refresh hashes
        await queryClient.invalidateQueries({
          queryKey: ["projectScreenshots", "default"],
        });
      }
    } catch (error) {
      console.error("Failed to save screenshots:", error);
      setSaveMessage({
        type: "error",
        text: "Failed to save screenshots to project.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Handle selecting project screenshots
  const handleSelectProjectScreenshots = async (
    selected: ProjectScreenshot[]
  ) => {
    // Convert project screenshots to File objects
    // Selected project screenshots

    try {
      const projectId = "default";
      const newFiles: File[] = [];

      for (const screenshot of selected) {
        // Fetch the full screenshot data
        const response = await fetch(
          `http://localhost:8000/api/state-discovery/project/${projectId}/screenshots/${screenshot.id}`
        );

        if (!response.ok) {
          console.error(`Failed to load screenshot ${screenshot.name}`);
          continue;
        }

        const data = await response.json();

        // Convert base64 to File
        const base64Data = data.image_data.split(",")[1]; // Remove data:image/png;base64, prefix
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);

        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const blob = new Blob([bytes], { type: "image/png" });
        const file = new File([blob], screenshot.name, { type: "image/png" });

        newFiles.push(file);
      }

      // Add to existing screenshots
      if (newFiles.length > 0) {
        onUpload([...screenshots, ...newFiles]);
      }
    } catch (error) {
      console.error("Failed to load project screenshots:", error);
    }
  };

  // Handle selecting snapshot screenshots
  const handleSelectSnapshotScreenshots = async (
    selected: Array<{ url: string; name: string; snapshotId: string }>
  ) => {
    try {
      const newFiles: File[] = [];

      for (const screenshot of selected) {
        // Fetch the screenshot image from the API
        const response = await fetch(screenshot.url);

        if (!response.ok) {
          console.error(`Failed to load screenshot ${screenshot.name}`);
          continue;
        }

        // Get the image as a blob
        const blob = await response.blob();

        // Create a File object
        const file = new File([blob], screenshot.name, {
          type: blob.type || "image/png",
        });

        newFiles.push(file);
      }

      // Add to existing screenshots
      if (newFiles.length > 0) {
        onUpload([...screenshots, ...newFiles]);
        setSaveMessage({
          type: "success",
          text: `Added ${newFiles.length} screenshot(s) from snapshot runs`,
        });
      }
    } catch (error) {
      console.error("Failed to load snapshot screenshots:", error);
      setSaveMessage({
        type: "error",
        text: "Failed to load screenshots from snapshots",
      });
    }
  };

  const openFileDialog = () => fileInputRef.current?.click();

  return {
    fileInputRef,
    screenshotHashes,
    duplicateCount,
    showProjectSelector,
    setShowProjectSelector,
    showSnapshotSelector,
    setShowSnapshotSelector,
    isSaving,
    saveMessage,
    selectedMonitors,
    setSelectedMonitors,
    handleFileSelect,
    handleDrop,
    handleDragOver,
    handleRemove,
    handleSaveToProject,
    handleSelectProjectScreenshots,
    handleSelectSnapshotScreenshots,
    openFileDialog,
  };
}
