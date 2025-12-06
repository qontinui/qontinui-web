"use client";

/**
 * GUI Element Annotation Tool - Web Version
 *
 * Admin-only page for creating ground truth annotations for GUI element detection research
 * Supports multiple screenshots with per-screenshot annotation management
 */

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { authService } from "@/services/service-factory";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { ImageCanvas, BoundingBox } from "@/components/common/ImageCanvas";
import {
  ScreenshotThumbnailStrip,
  ScreenshotData,
} from "@/components/annotations/ScreenshotThumbnailStrip";
import {
  Upload,
  Download,
  Trash2,
  FileImage,
  Plus,
  LayoutDashboard,
  Shield,
  Sparkles,
  Grid3x3,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Annotation extends Omit<BoundingBox, "id"> {
  id: string;
  description?: string;
  reason?: string;
  screenshot_index?: number;
}

interface ScreenshotMetadata {
  name: string;
  url: string;
  width: number;
  height: number;
}

interface AnnotationSet {
  id?: string;
  screenshot_name: string;
  screenshot_url: string;
  image_width: number;
  image_height: number;
  notes?: string;
  boundary_width?: number;
  annotations: Annotation[];
  screenshots?: ScreenshotMetadata[]; // Multi-screenshot support
}

export default function AnnotationsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Protection
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
      return;
    }

    if (!authLoading && user && !user.is_superuser) {
      toast.error("Access denied - Admin privileges required");
      router.push("/dashboard");
      return;
    }
  }, [user, authLoading, router]);

  // Multi-screenshot state
  const [screenshots, setScreenshots] = useState<ScreenshotData[]>([]);
  const [currentScreenshotIndex, setCurrentScreenshotIndex] = useState(0);

  // Current screenshot data
  const currentScreenshot = screenshots[currentScreenshotIndex];
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);

  // Form state for selected box
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [boundaryWidth, setBoundaryWidth] = useState(5);

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [savedSets, setSavedSets] = useState<AnnotationSet[]>([]);
  const [currentSetId, setCurrentSetId] = useState<string | undefined>();

  // Auto-save state
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">(
    "saved"
  );
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Unsaved changes warning
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [pendingScreenshotIndex, setPendingScreenshotIndex] = useState<
    number | null
  >(null);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);

  // Get selected box
  const selectedBox = currentScreenshot?.annotations?.find(
    (b) => b.id === selectedBoxId
  );

  // Update form when selection changes
  useEffect(() => {
    if (selectedBox) {
      setLabel(selectedBox.label || "");
      setDescription((selectedBox as any).description || "");
      setReason((selectedBox as any).reason || "");
    } else {
      setLabel("");
      setDescription("");
      setReason("");
    }
  }, [selectedBoxId, selectedBox]);

  // Auto-save effect - triggers after 2 seconds of inactivity
  useEffect(() => {
    // Clear any existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Don't auto-save if there are no unsaved changes
    if (!hasUnsavedChanges) {
      return;
    }

    // Don't auto-save if there are no annotations yet
    if (!currentScreenshot || !currentScreenshot.annotations || currentScreenshot.annotations.length === 0) {
      return;
    }

    // Set status to unsaved
    setSaveStatus("unsaved");

    // Set up debounced auto-save
    autoSaveTimerRef.current = setTimeout(() => {
      // Trigger save by calling handleSave directly
      // We'll wrap it in a function to avoid adding handleSave to dependencies
      setSaveStatus("saving");
      handleSave();
    }, 2000); // 2 seconds delay

    // Cleanup function
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
    // Note: We intentionally don't include handleSave in dependencies to avoid infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasUnsavedChanges,
    currentScreenshot?.annotations?.length,
    notes,
    boundaryWidth,
  ]);

  // Cancel pending saves on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // Load image dimensions
  const loadImageDimensions = async (
    file: File
  ): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.src = URL.createObjectURL(file);
    });
  };

  // Handle file upload
  const handleFileUpload = async (files: File[]) => {
    if (files.length === 0) return;

    const newScreenshots: ScreenshotData[] = await Promise.all(
      files.map(async (file) => {
        const url = URL.createObjectURL(file);
        const dimensions = await loadImageDimensions(file);
        return {
          id: `screenshot-${Date.now()}-${Math.random()}`,
          file,
          url,
          dimensions,
          annotations: [],
          hasUnsavedChanges: false,
        };
      })
    );

    setScreenshots((prev) => [...prev, ...newScreenshots]);

    // If this is the first upload, select the first screenshot
    if (screenshots.length === 0) {
      setCurrentScreenshotIndex(0);
      setHasUnsavedChanges(false);
      setSaveStatus("saved");
    }

    setSelectedBoxId(null);
    toast.success(`Added ${files.length} screenshot(s)`);
  };

  // Handle file input change
  const handleFileInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(e.target.files || []);
    await handleFileUpload(files);

    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Handle drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files).filter((file) =>
      file.type.startsWith("image/")
    );

    if (files.length > 0) {
      await handleFileUpload(files);
    }
  };

  // Handle screenshot navigation with unsaved changes check
  const handleScreenshotSelect = (index: number) => {
    if (index === currentScreenshotIndex) return;

    // Check for unsaved changes
    if (currentScreenshot?.hasUnsavedChanges) {
      setPendingScreenshotIndex(index);
      setShowUnsavedWarning(true);
      return;
    }

    switchToScreenshot(index);
  };

  // Switch to screenshot
  const switchToScreenshot = (index: number) => {
    setCurrentScreenshotIndex(index);
    setSelectedBoxId(null);
    setShowUnsavedWarning(false);
    setPendingScreenshotIndex(null);

    // Reset unsaved changes state for the new screenshot
    const newScreenshot = screenshots[index];
    if (newScreenshot && !newScreenshot.hasUnsavedChanges) {
      setHasUnsavedChanges(false);
      setSaveStatus("saved");
    } else if (newScreenshot?.hasUnsavedChanges) {
      setHasUnsavedChanges(true);
      setSaveStatus("unsaved");
    }
  };

  // Confirm switch with unsaved changes
  const confirmSwitchScreenshot = () => {
    if (pendingScreenshotIndex !== null) {
      switchToScreenshot(pendingScreenshotIndex);
    }
  };

  // Handle screenshot removal
  const handleScreenshotRemove = (index: number) => {
    if (screenshots.length === 1) {
      toast.error("Cannot remove the last screenshot");
      return;
    }

    const updatedScreenshots = screenshots.filter((_, i) => i !== index);
    setScreenshots(updatedScreenshots);

    // Adjust current index if needed
    if (currentScreenshotIndex >= updatedScreenshots.length) {
      setCurrentScreenshotIndex(updatedScreenshots.length - 1);
    }

    toast.success("Screenshot removed");
  };

  // Handle add screenshot button
  const handleAddScreenshot = () => {
    fileInputRef.current?.click();
  };

  // Handle box changes
  const handleBoxesChange = (newBoxes: BoundingBox[]) => {
    if (!currentScreenshot) return;

    const updatedScreenshots = screenshots.map((screenshot, index) => {
      if (index === currentScreenshotIndex) {
        return {
          ...screenshot,
          annotations: newBoxes,
          hasUnsavedChanges: true,
        };
      }
      return screenshot;
    });

    setScreenshots(updatedScreenshots);
    setHasUnsavedChanges(true);
  };

  // Handle box selection
  const handleBoxSelect = (boxId: string | null) => {
    setSelectedBoxId(boxId);
  };

  // Update selected box details
  const handleUpdateDetails = () => {
    if (!selectedBoxId || !currentScreenshot || !currentScreenshot.annotations) return;

    const updatedAnnotations = currentScreenshot.annotations.map((box) => {
      if (box.id === selectedBoxId) {
        return {
          ...box,
          label,
          description,
          reason,
        } as BoundingBox;
      }
      return box;
    });

    const updatedScreenshots = screenshots.map((screenshot, index) => {
      if (index === currentScreenshotIndex) {
        return {
          ...screenshot,
          annotations: updatedAnnotations,
          hasUnsavedChanges: true,
        };
      }
      return screenshot;
    });

    setScreenshots(updatedScreenshots);
    setHasUnsavedChanges(true);
    toast.success("Element details updated");
  };

  // Delete selected box
  const handleDeleteBox = () => {
    if (!selectedBoxId || !currentScreenshot || !currentScreenshot.annotations) return;

    const updatedAnnotations = currentScreenshot.annotations.filter(
      (box) => box.id !== selectedBoxId
    );

    const updatedScreenshots = screenshots.map((screenshot, index) => {
      if (index === currentScreenshotIndex) {
        return {
          ...screenshot,
          annotations: updatedAnnotations,
          hasUnsavedChanges: true,
        };
      }
      return screenshot;
    });

    setScreenshots(updatedScreenshots);
    setHasUnsavedChanges(true);
    setSelectedBoxId(null);
    toast.success("Element deleted");
  };

  // Save current screenshot annotations
  // Updated: 2025-11-12 - Fixed API endpoint URL with trailing slash and proper auth headers
  const handleSave = async () => {
    if (!currentScreenshot || !currentScreenshot.annotations || currentScreenshot.annotations.length === 0) {
      toast.error("Please annotate at least one element before saving");
      return;
    }

    setIsSaving(true);
    setSaveStatus("saving");

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const accessToken = authService.tokenManager.getAccessToken();

      if (!accessToken) {
        throw new Error("Not authenticated");
      }

      // Upload all screenshots and prepare annotation set
      // For multi-screenshot sets, we need to upload each screenshot and collect their URLs
      const screenshotMetadata: Array<{
        name: string;
        url: string;
        width: number;
        height: number;
      }> = [];
      const allAnnotations: Array<any> = [];

      for (let i = 0; i < screenshots.length; i++) {
        const screenshot = screenshots[i];
        if (!screenshot) continue;

        console.log(`[Annotations] Processing screenshot ${i}:`, {
          hasPermUrl: !!screenshot.permanentUrl,
          permUrl: screenshot.permanentUrl,
          displayUrl: screenshot.url,
          urlType: screenshot.url?.startsWith("blob:") ? "blob" : "other",
        });

        // Use permanent URL if available, otherwise use blob URL and upload
        let screenshotUrl = screenshot.permanentUrl || screenshot.url;
        if (!screenshot.permanentUrl && screenshot.url?.startsWith("blob:")) {
          console.log(
            `[Annotations] Screenshot ${i} needs upload (blob URL, no permanentUrl)`
          );

          if (!screenshot.file) continue;

          const formData = new FormData();
          formData.append("file", screenshot.file);

          const uploadResponse = await fetch(
            `${apiUrl}/api/v1/annotations/upload-screenshot`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
              body: formData,
            }
          );

          if (!uploadResponse.ok) {
            const errorData = await uploadResponse
              .json()
              .catch(() => ({ detail: "Unknown error" }));
            throw new Error(
              errorData.detail ||
                `Failed to upload screenshot ${screenshot.file.name} (${uploadResponse.status})`
            );
          }

          const uploadResult = await uploadResponse.json();
          screenshotUrl = uploadResult.url;

          console.log(
            "[Annotations] Upload result for screenshot",
            i,
            ":",
            uploadResult
          );
          console.log("[Annotations] Backend returned URL:", screenshotUrl);

          // Store the permanent URL (keep it relative as returned by backend)
          // This will be sent in the screenshots array when saving
          screenshots[i] = {
            ...screenshot,
            permanentUrl: screenshotUrl, // Store permanent URL separately
          };

          const updatedScreenshot = screenshots[i];
          console.log("[Annotations] Updated screenshot", i, "state:", {
            permanentUrl: updatedScreenshot?.permanentUrl,
            displayUrl: updatedScreenshot?.url,
          });
        } else {
          console.log(`[Annotations] Screenshot ${i} skipping upload:`, {
            reason: screenshot.permanentUrl
              ? "already has permanentUrl"
              : "not a blob URL",
            permanentUrl: screenshot.permanentUrl,
            url: screenshot.url,
          });
        }

        // Add screenshot metadata
        screenshotMetadata.push({
          name: screenshot.file?.name || 'screenshot',
          url: screenshotUrl || '',
          width: screenshot.dimensions?.width || 0,
          height: screenshot.dimensions?.height || 0,
        });

        // Add annotations for this screenshot with correct screenshot_index
        screenshot.annotations?.forEach((box) => {
          allAnnotations.push({
            x: Math.round(box.x),
            y: Math.round(box.y),
            width: Math.round(box.width),
            height: Math.round(box.height),
            label: box.label,
            description: (box as any).description,
            reason: (box as any).reason,
            screenshot_index: i,
          });
        });
      }

      // Create annotation set with multi-screenshot support
      const annotationSet: AnnotationSet = {
        // For backward compatibility, set the first screenshot in the old fields
        screenshot_name: screenshotMetadata[0]?.name || '',
        screenshot_url: screenshotMetadata[0]?.url || '',
        image_width: screenshotMetadata[0]?.width || 0,
        image_height: screenshotMetadata[0]?.height || 0,
        // New multi-screenshot field
        screenshots:
          screenshotMetadata.length > 1 ? screenshotMetadata : undefined,
        notes,
        boundary_width: boundaryWidth,
        annotations: allAnnotations,
      };

      // Decide whether to create (POST) or update (PUT)
      const isUpdate = !!currentSetId;
      const method = isUpdate ? "PUT" : "POST";
      const endpoint = isUpdate
        ? `${apiUrl}/api/v1/annotations/${currentSetId}`
        : `${apiUrl}/api/v1/annotations/`;

      console.log("[Annotations] Attempting to save:", {
        hasToken: !!accessToken,
        tokenPreview: accessToken
          ? accessToken.substring(0, 20) + "..."
          : "none",
        apiUrl,
        method,
        isUpdate,
        currentSetId,
        annotationCount: annotationSet.annotations.length,
        screenshotCount: screenshotMetadata.length,
        firstScreenshotUrl: screenshotMetadata[0]?.url,
      });

      const response = await fetch(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(annotationSet),
      });

      console.log("[Annotations] Response received:", {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText,
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: "Unknown error" }));
        console.error("[Annotations] Error response:", errorData);

        // Special handling for 401 Unauthorized
        if (response.status === 401) {
          throw new Error(
            "Authentication failed. Please ensure you are logged in as an admin/superuser."
          );
        }

        throw new Error(
          errorData.detail || `Failed to save annotations (${response.status})`
        );
      }

      const saved = await response.json();

      console.log("[Annotations] Save response:", saved);
      console.log(
        "[Annotations] Response screenshots field:",
        saved.screenshots
      );
      if (saved.screenshots && Array.isArray(saved.screenshots)) {
        console.log(
          "[Annotations] Response contains screenshots array with",
          saved.screenshots.length,
          "items"
        );
        saved.screenshots.forEach((s: any, i: number) => {
          console.log(`[Annotations]   Response screenshot ${i}:`, s);
        });
      }
      console.log(
        "[Annotations] Screenshots before state update:",
        screenshots.map((s, i) => ({
          index: i,
          url: s?.url,
          permanentUrl: s?.permanentUrl,
          name: s?.file?.name,
          urlType: s?.url?.startsWith("blob:") ? "blob" : "other",
        }))
      );

      // Set the current set ID if this was a new save
      if (!isUpdate && saved.id) {
        setCurrentSetId(saved.id);
      }

      // Mark all screenshots as saved (no unsaved changes)
      // Use the screenshots array that was updated during upload (with permanent URLs)
      const updatedScreenshots = screenshots.map((screenshot) => ({
        ...screenshot,
        hasUnsavedChanges: false,
      }));

      console.log(
        "[Annotations] Screenshots after mapping:",
        updatedScreenshots.map((s, i) => ({
          index: i,
          url: s?.url,
          permanentUrl: s?.permanentUrl,
          name: s?.file?.name,
          urlType: s?.url?.startsWith("blob:") ? "blob" : "other",
        }))
      );

      console.log("[Annotations] Calling setScreenshots with updated array");
      setScreenshots(updatedScreenshots);
      console.log("[Annotations] setScreenshots called");
      setHasUnsavedChanges(false);
      setSaveStatus("saved");

      const actionText = isUpdate ? "updated" : "saved";
      const screenshotCount = screenshots.length;
      const annotationCount = allAnnotations.length;
      toast.success(
        `Annotation set ${actionText} with ${screenshotCount} screenshot${screenshotCount > 1 ? "s" : ""} ` +
          `and ${annotationCount} annotation${annotationCount > 1 ? "s" : ""}`
      );
    } catch (error) {
      console.error("Error saving annotations:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to save annotations";
      toast.error(errorMessage);
      setSaveStatus("unsaved");
    } finally {
      setIsSaving(false);
    }
  };

  // Save as new annotation set
  const handleSaveAs = async () => {
    // Clear the current set ID to force creating a new annotation set
    setCurrentSetId(undefined);
    // Then call the regular save function which will create a new set
    await handleSave();
  };

  // Export current screenshot annotations as JSON
  const handleExport = () => {
    if (!currentScreenshot || !currentScreenshot.annotations || currentScreenshot.annotations.length === 0) {
      toast.error("No annotations to export");
      return;
    }

    const annotationSet = {
      screenshot: currentScreenshot.file?.name || 'screenshot',
      image_size: [
        currentScreenshot.dimensions?.width || 0,
        currentScreenshot.dimensions?.height || 0,
      ],
      num_elements: currentScreenshot.annotations.length,
      annotations: currentScreenshot.annotations.map((box) => ({
        bbox: [
          Math.round(box.x),
          Math.round(box.y),
          Math.round(box.x + box.width),
          Math.round(box.y + box.height),
        ],
        label: box.label || "",
        description: (box as any).description || "",
        reason: (box as any).reason || "",
        width: Math.round(box.width),
        height: Math.round(box.height),
        area: Math.round(box.width * box.height),
      })),
    };

    const blob = new Blob([JSON.stringify(annotationSet, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(currentScreenshot.file?.name || 'screenshot').replace(/\.[^/.]+$/, "")}_annotations.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success("Annotations exported");
  };

  // Export all screenshots
  const handleExportAll = () => {
    const screenshotsWithAnnotations = screenshots.filter(
      (screenshot) => screenshot?.annotations && screenshot.annotations.length > 0
    );

    if (screenshotsWithAnnotations.length === 0) {
      toast.error("No annotations to export");
      return;
    }

    const allAnnotations = {
      export_date: new Date().toISOString(),
      total_screenshots: screenshotsWithAnnotations.length,
      screenshots: screenshotsWithAnnotations.map((screenshot) => ({
        screenshot: screenshot.file?.name || 'screenshot',
        image_size: [screenshot.dimensions?.width || 0, screenshot.dimensions?.height || 0],
        num_elements: screenshot.annotations?.length || 0,
        annotations: (screenshot.annotations || []).map((box) => ({
          bbox: [
            Math.round(box.x),
            Math.round(box.y),
            Math.round(box.x + box.width),
            Math.round(box.y + box.height),
          ],
          label: box.label || "",
          description: (box as any).description || "",
          reason: (box as any).reason || "",
          width: Math.round(box.width),
          height: Math.round(box.height),
          area: Math.round(box.width * box.height),
        })),
      })),
    };

    const blob = new Blob([JSON.stringify(allAnnotations, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `all_annotations_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success(
      `Exported annotations for ${screenshotsWithAnnotations.length} screenshot(s)`
    );
  };

  // Load saved annotation sets
  const handleLoadDialog = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const accessToken = authService.tokenManager.getAccessToken();

      if (!accessToken) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(`${apiUrl}/api/v1/annotations/`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: "Unknown error" }));
        throw new Error(
          errorData.detail ||
            `Failed to load annotation sets (${response.status})`
        );
      }

      const sets = await response.json();
      setSavedSets(sets);
      setShowLoadDialog(true);
    } catch (error) {
      console.error("Error loading annotation sets:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to load annotation sets";
      toast.error(errorMessage);
    }
  };

  // Load a specific annotation set
  const handleLoadSet = async (set: AnnotationSet) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

      console.log("[Annotations] Loading annotation set:", set.id);
      console.log("[Annotations] Has screenshots array:", !!set.screenshots);

      // Helper function to convert relative URLs to absolute
      const makeAbsoluteUrl = (url: string): string => {
        if (url.startsWith("/")) {
          const absoluteUrl = `${apiUrl}${url}`;
          console.log("[Annotations] Converting relative URL to absolute:", {
            original: url,
            absolute: absoluteUrl,
          });
          return absoluteUrl;
        }
        return url;
      };

      // Determine which format we're dealing with
      const screenshotsToLoad =
        set.screenshots && set.screenshots.length > 0
          ? set.screenshots // New multi-screenshot format
          : [
              {
                // Old single-screenshot format
                name: set.screenshot_name,
                url: set.screenshot_url,
                width: set.image_width,
                height: set.image_height,
              },
            ];

      console.log(
        "[Annotations] Loading",
        screenshotsToLoad.length,
        "screenshot(s)"
      );

      // Load all screenshots
      const loadedScreenshots: ScreenshotData[] = [];

      for (let i = 0; i < screenshotsToLoad.length; i++) {
        const screenshot = screenshotsToLoad[i];
        if (!screenshot) continue;
        const absoluteUrl = makeAbsoluteUrl(screenshot.url);

        // Check if the screenshot URL is a blob URL (invalid)
        if (absoluteUrl.startsWith("blob:")) {
          toast.error(
            "Cannot load annotation set - screenshot was not saved properly. Please delete this set and create a new one."
          );
          console.error(
            "Error loading screenshot: Annotation set has blob URL (not saved):",
            absoluteUrl
          );
          return;
        }

        console.log(
          "[Annotations] Fetching screenshot",
          i,
          "from:",
          absoluteUrl
        );

        // Fetch the screenshot from the URL
        const response = await fetch(absoluteUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch screenshot ${i}: ${response.status} ${response.statusText}`
          );
        }

        // Convert to blob and then to File
        const blob = await response.blob();
        const file = new File([blob], screenshot.name, { type: blob.type });

        // Load image dimensions
        const url = URL.createObjectURL(file);
        const dimensions = await loadImageDimensions(file);

        // Get annotations for this screenshot index
        const screenshotAnnotations = set.annotations
          .filter((ann) => (ann.screenshot_index ?? 0) === i)
          .map((ann) => ({
            id: ann.id,
            x: ann.x,
            y: ann.y,
            width: ann.width,
            height: ann.height,
            label: ann.label,
            color: "#3b82f6", // Default blue color
          }));

        console.log(
          "[Annotations] Screenshot",
          i,
          "has",
          screenshotAnnotations.length,
          "annotation(s)"
        );

        // Create the screenshot data
        loadedScreenshots.push({
          id: `screenshot-${Date.now()}-${i}-${Math.random()}`,
          file,
          url, // Use blob URL for display
          dimensions,
          annotations: screenshotAnnotations,
          hasUnsavedChanges: false,
        });
      }

      // Replace current screenshots with the loaded ones
      setScreenshots(loadedScreenshots);
      setCurrentScreenshotIndex(0);
      setNotes(set.notes || "");
      setBoundaryWidth(set.boundary_width || 5);
      setCurrentSetId(set.id);
      setShowLoadDialog(false);
      setSelectedBoxId(null);
      setHasUnsavedChanges(false);
      setSaveStatus("saved");

      const totalAnnotations = set.annotations.length;
      toast.success(
        `Loaded ${loadedScreenshots.length} screenshot(s) with ${totalAnnotations} annotation(s)`
      );
    } catch (error) {
      console.error("Error loading screenshot:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to load screenshot";
      toast.error(errorMessage);
    }
  };

  // Delete an annotation set
  const handleDeleteSet = async (setId: string, setName: string) => {
    if (
      !confirm(
        `Are you sure you want to delete "${setName}"? This cannot be undone.`
      )
    ) {
      return;
    }

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const accessToken = authService.tokenManager.getAccessToken();

      if (!accessToken) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(`${apiUrl}/api/v1/annotations/${setId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: "Unknown error" }));
        throw new Error(
          errorData.detail ||
            `Failed to delete annotation set (${response.status})`
        );
      }

      // Remove from local state
      setSavedSets((prev) => prev.filter((s) => s.id !== setId));
      toast.success(`Deleted "${setName}"`);
    } catch (error) {
      console.error("Error deleting annotation set:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to delete annotation set";
      toast.error(errorMessage);
    }
  };

  // Don't render until auth is confirmed
  if (authLoading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user?.is_superuser) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Admin Access Required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              This page is only accessible to administrators. You need superuser
              permissions to create and manage annotations.
            </p>
            <Button
              variant="outline"
              onClick={() => router.push("/dashboard")}
              className="mt-4"
            >
              <LayoutDashboard className="mr-2 h-4 w-4" />
              Return to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div
      className="container mx-auto py-8"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag and Drop Overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="text-center">
            <Upload className="mx-auto h-16 w-16 text-primary mb-4" />
            <p className="text-xl font-semibold">Drop images here to upload</p>
          </div>
        </div>
      )}

      {/* Navigation Links */}
      <div className="mb-6 flex items-center gap-4">
        <Button
          variant="ghost"
          onClick={() => router.push("/dashboard")}
          className="hover:bg-primary/10"
        >
          <LayoutDashboard className="mr-2 h-4 w-4" />
          Dashboard
        </Button>
        <Button
          variant="ghost"
          onClick={() => router.push("/admin")}
          className="hover:bg-secondary/10"
        >
          <Shield className="mr-2 h-4 w-4" />
          Admin
        </Button>
        <Button
          variant="ghost"
          onClick={() => router.push("/admin/analysis")}
          className="hover:bg-accent/10"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          Element Analysis
        </Button>
        <Button
          variant="ghost"
          onClick={() => router.push("/admin/region-analysis")}
          className="hover:bg-accent/10"
        >
          <Grid3x3 className="mr-2 h-4 w-4" />
          Region Analysis
        </Button>
      </div>

      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">GUI Element Annotation Tool</h1>
        <p className="text-muted-foreground">
          Create ground truth annotations for training GUI element detection
          models
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Panel - Screenshot Management */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Screenshots</CardTitle>
            <CardDescription>
              {screenshots.length > 0
                ? `${screenshots.length} screenshot(s) loaded`
                : "Upload screenshots to begin"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="screenshot-upload" className="cursor-pointer">
                <div className="flex items-center justify-center w-full h-32 border-2 border-dashed rounded-lg hover:bg-accent transition-colors">
                  <div className="text-center">
                    <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      Click to upload or drag & drop
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Supports multiple images
                    </p>
                  </div>
                </div>
              </Label>
              <Input
                ref={fileInputRef}
                id="screenshot-upload"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
              />
            </div>

            {currentScreenshot && (
              <>
                <div className="space-y-2">
                  <Label>Current Screenshot</Label>
                  <div className="text-sm space-y-1">
                    <div
                      className="font-medium truncate"
                      title={currentScreenshot.file?.name}
                    >
                      {currentScreenshot.file?.name}
                    </div>
                    <div className="text-muted-foreground">
                      {currentScreenshot.dimensions?.width || 0} ×{" "}
                      {currentScreenshot.dimensions?.height || 0}px
                    </div>
                    <div className="text-muted-foreground">
                      {currentScreenshot.annotations?.length || 0} annotation(s)
                    </div>
                    {currentScreenshot.hasUnsavedChanges && (
                      <Badge
                        variant="outline"
                        className="text-orange-500 border-orange-500"
                      >
                        Unsaved changes
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    placeholder="Add notes about this annotation set..."
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      setHasUnsavedChanges(true);
                    }}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="boundary-width">Boundary Width</Label>
                    <span className="text-sm text-muted-foreground">
                      {boundaryWidth}px
                    </span>
                  </div>
                  <Slider
                    id="boundary-width"
                    min={0}
                    max={50}
                    step={1}
                    value={[boundaryWidth]}
                    onValueChange={(value) => {
                      setBoundaryWidth(value[0] ?? 0);
                      setHasUnsavedChanges(true);
                    }}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    Tolerance for matching detected boxes to ground truth
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Actions</Label>
                    {currentScreenshot.annotations && currentScreenshot.annotations.length > 0 && (
                      <div className="text-xs">
                        {saveStatus === "saving" && (
                          <span className="text-blue-500">Saving...</span>
                        )}
                        {saveStatus === "saved" && (
                          <span className="text-muted-foreground">
                            All changes saved
                          </span>
                        )}
                        {saveStatus === "unsaved" && (
                          <span className="text-yellow-600">
                            Unsaved changes
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {currentSetId && (
                      <Button
                        onClick={handleSaveAs}
                        disabled={
                          isSaving || !currentScreenshot.annotations || currentScreenshot.annotations.length === 0
                        }
                        variant="outline"
                        className="flex-1"
                        size="sm"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Save As New
                      </Button>
                    )}
                    <Button
                      onClick={handleExport}
                      disabled={!currentScreenshot.annotations || currentScreenshot.annotations.length === 0}
                      variant="outline"
                      size="sm"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                  {screenshots.length > 1 && (
                    <Button
                      onClick={handleExportAll}
                      variant="outline"
                      size="sm"
                      className="w-full"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Export All
                    </Button>
                  )}
                </div>
              </>
            )}

            <Button
              onClick={handleLoadDialog}
              variant="outline"
              className="w-full"
              size="sm"
            >
              Load Saved
            </Button>
          </CardContent>
        </Card>

        {/* Middle Panel - Canvas */}
        <Card className="lg:col-span-8">
          <CardHeader>
            <CardTitle>Annotation Canvas</CardTitle>
            <CardDescription>
              {currentScreenshot
                ? `${currentScreenshot.dimensions?.width || 0} × ${currentScreenshot.dimensions?.height || 0}px`
                : "No image loaded"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {currentScreenshot ? (
              <ImageCanvas
                imageUrl={currentScreenshot.url || ''}
                boxes={currentScreenshot.annotations || []}
                selectedBoxId={selectedBoxId}
                onBoxesChange={handleBoxesChange}
                onBoxSelect={handleBoxSelect}
                className="h-[600px]"
              />
            ) : (
              <div className="flex items-center justify-center h-[600px] border-2 border-dashed rounded-lg">
                <div className="text-center text-muted-foreground">
                  <FileImage className="mx-auto h-12 w-12 mb-2" />
                  <p>Upload a screenshot to begin</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Panel - Element Details */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Element Details</CardTitle>
            <CardDescription>
              {currentScreenshot?.annotations?.length || 0} element(s) annotated
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="list" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="list">List</TabsTrigger>
                <TabsTrigger value="edit">Edit</TabsTrigger>
              </TabsList>

              <TabsContent value="list" className="space-y-2">
                <ScrollArea className="h-[500px]">
                  {!currentScreenshot ||
                  !currentScreenshot.annotations ||
                  currentScreenshot.annotations.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No elements annotated yet
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {currentScreenshot.annotations.map((box, index) => (
                        <button
                          key={box.id}
                          onClick={() => setSelectedBoxId(box.id)}
                          className={`w-full text-left p-3 rounded border transition-colors ${
                            box.id === selectedBoxId
                              ? "border-primary bg-accent"
                              : "border-border hover:bg-accent"
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="font-medium">
                                {box.label || `Element ${index + 1}`}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {Math.round(box.width)} ×{" "}
                                {Math.round(box.height)}px
                              </div>
                              {(box as any).description && (
                                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                  {(box as any).description}
                                </div>
                              )}
                            </div>
                            <Badge
                              variant={
                                box.id === selectedBoxId
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {index + 1}
                            </Badge>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="edit" className="space-y-4">
                {selectedBox ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="label">Label *</Label>
                      <Input
                        id="label"
                        placeholder="e.g., Login Button"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        placeholder="Describe the element..."
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reason">Why is this useful?</Label>
                      <Textarea
                        id="reason"
                        placeholder="Explain why this element is important for detection..."
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={3}
                      />
                    </div>

                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>
                        Position: ({Math.round(selectedBox.x)},{" "}
                        {Math.round(selectedBox.y)})
                      </div>
                      <div>
                        Size: {Math.round(selectedBox.width)} ×{" "}
                        {Math.round(selectedBox.height)}px
                      </div>
                      <div>
                        Area:{" "}
                        {Math.round(selectedBox.width * selectedBox.height)} px²
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={handleUpdateDetails} className="flex-1">
                        Update
                      </Button>
                      <Button onClick={handleDeleteBox} variant="destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Select an element to edit its details
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Thumbnail Strip */}
      {screenshots.length > 0 && (
        <div className="mt-6">
          <ScreenshotThumbnailStrip
            screenshots={screenshots}
            currentIndex={currentScreenshotIndex}
            onScreenshotSelect={handleScreenshotSelect}
            onScreenshotRemove={handleScreenshotRemove}
            onAddScreenshot={handleAddScreenshot}
          />
        </div>
      )}

      {/* Unsaved Changes Warning Dialog */}
      <AlertDialog
        open={showUnsavedWarning}
        onOpenChange={setShowUnsavedWarning}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              The current screenshot has unsaved changes. If you switch to
              another screenshot, these changes will be lost. Do you want to
              continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitchScreenshot}>
              Switch Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Load Dialog */}
      <Dialog open={showLoadDialog} onOpenChange={setShowLoadDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Load Annotation Set</DialogTitle>
            <DialogDescription>
              Select a previously saved annotation set to load
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-96">
            {savedSets.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No saved annotation sets found
              </p>
            ) : (
              <div className="space-y-2">
                {savedSets.map((set) => {
                  const isBlobUrl = set.screenshot_url.startsWith("blob:");
                  return (
                    <div
                      key={set.id}
                      className={`relative p-4 rounded border transition-colors ${
                        isBlobUrl ? "opacity-50 bg-muted" : "hover:bg-accent"
                      }`}
                    >
                      <button
                        onClick={() => handleLoadSet(set)}
                        disabled={isBlobUrl}
                        className="w-full text-left"
                      >
                        <div className="font-medium">
                          {set.screenshot_name}
                          {isBlobUrl && (
                            <span className="ml-2 text-xs text-red-500 font-normal">
                              (Invalid - not saved)
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {set.annotations.length} elements • {set.image_width}{" "}
                          × {set.image_height}px
                        </div>
                        {set.notes && (
                          <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {set.notes}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground mt-2">
                          {new Date((set as any).created_at).toLocaleString()}
                        </div>
                        {isBlobUrl && (
                          <div className="text-xs text-red-500 mt-2">
                            Screenshot was not properly saved. Please delete
                            this set.
                          </div>
                        )}
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (set.id) {
                            handleDeleteSet(set.id, set.screenshot_name);
                          }
                        }}
                        className="absolute top-2 right-2"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLoadDialog(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
