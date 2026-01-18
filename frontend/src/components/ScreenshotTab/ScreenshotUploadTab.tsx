import React, { useState, useRef, useEffect } from "react";
import {
  Upload,
  Image,
  Download,
  Trash2,
  Edit2,
  Check,
  X,
  FileJson,
  FileCode,
  Camera,
  Monitor,
  Loader2,
  CheckCircle,
} from "lucide-react";
import { Screenshot } from "../../types/Screenshot";
import {
  downloadStateExport,
  downloadPythonStateCode,
} from "../../lib/state-exporter";
import { useAutomation } from "../../contexts/automation-context";
import { State } from "../../contexts/automation-context/types";
import { apiClient } from "@/lib/api-client";
import { normalizeUrl } from "@/lib/screenshot-db";
import {
  ImageUploadProgress,
  type UploadingImage,
} from "@/components/ImageUploadProgress";
import { toast } from "sonner";
import {
  QontinuiHeader,
  QontinuiHeaderActions,
  QontinuiMain,
  QontinuiSidebar,
  UploadButton,
  CreateButton,
  GhostButton,
  QontinuiCard,
  QontinuiInput,
} from "../qontinui";

interface ScreenshotUploadTabProps {
  states: State[];
  onExport: (screenshots: Screenshot[]) => void;
}

const ScreenshotUploadTab: React.FC<ScreenshotUploadTabProps> = ({
  states,
  onExport,
}) => {
  const {
    screenshots: projectScreenshots,
    addScreenshot,
    updateScreenshot,
    deleteScreenshot: removeScreenshot,
    projectName,
    projectId,
    triggerSave,
  } = useAutomation();
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [selectedScreenshot, setSelectedScreenshot] =
    useState<Screenshot | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [editingScreenshotId, setEditingScreenshotId] = useState<string | null>(
    null
  );
  const [editingName, setEditingName] = useState<string>("");
  const [zoomMode, setZoomMode] = useState<"fit" | "original">("fit");
  const [uploadingFiles, setUploadingFiles] = useState<UploadingImage[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showMonitorMenu, setShowMonitorMenu] = useState(false);
  const [availableMonitors, setAvailableMonitors] = useState<
    Array<{ index: number; width: number; height: number; is_primary: boolean }>
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const monitorMenuRef = useRef<HTMLDivElement>(null);

  // Auto-save state
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const saveStatusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Helper to trigger save and show saved status
  const handleAutoSave = () => {
    triggerSave();
    setSaveStatus("saved");

    // Clear existing timeout
    if (saveStatusTimeoutRef.current) {
      clearTimeout(saveStatusTimeoutRef.current);
    }

    // Hide "Saved" status after 2 seconds
    saveStatusTimeoutRef.current = setTimeout(() => {
      setSaveStatus("idle");
    }, 2000);
  };

  // Close monitor menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        monitorMenuRef.current &&
        !monitorMenuRef.current.contains(event.target as Node)
      ) {
        setShowMonitorMenu(false);
      }
    };

    if (showMonitorMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showMonitorMenu]);

  // Sync local screenshots with project screenshots
  useEffect(() => {
    const loadScreenshots = async () => {
      const convertedScreenshots: Screenshot[] = await Promise.all(
        projectScreenshots.map(
          (ps) =>
            new Promise<Screenshot>((resolve) => {
              const img = new window.Image();
              img.onload = () => {
                resolve({
                  id: ps.id,
                  name: ps.name,
                  imageData: ps.url,
                  width: img.width,
                  height: img.height,
                  uploadedAt: ps.uploadedAt,
                  associatedStates: [],
                  regions: [],
                  locations: [],
                });
              };
              img.onerror = () => {
                resolve({
                  id: ps.id,
                  name: ps.name,
                  imageData: ps.url,
                  width: 0,
                  height: 0,
                  uploadedAt: ps.uploadedAt,
                  associatedStates: [],
                  regions: [],
                  locations: [],
                });
              };
              img.src = ps.url;
            })
        )
      );
      setScreenshots(convertedScreenshots);
    };

    loadScreenshots();
  }, [projectScreenshots]);

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Validate projectId is available
    if (!projectId) {
      toast.error("No project selected", {
        description: "Please open a project before uploading screenshots.",
      });
      return;
    }

    const fileArray = Array.from(files);

    // Validate file types before upload
    const invalidFiles = fileArray.filter(
      (file) => !file.type.startsWith("image/")
    );
    if (invalidFiles.length > 0) {
      toast.error("Invalid file type", {
        description: `${invalidFiles[0]?.name ?? "Unknown file"} is not an image file.`,
      });
      return;
    }

    // Initialize upload progress for all files
    const initialUploading: UploadingImage[] = [];
    fileArray.forEach((file) => {
      initialUploading.push({ name: file.name, progress: 0 });
    });
    setUploadingFiles(initialUploading);

    // Upload files sequentially to avoid overwhelming the backend
    for (const file of fileArray) {
      try {
        // Validate image before uploading
        await new Promise<void>((resolve, reject) => {
          const img = new window.Image();
          const reader = new FileReader();

          reader.onload = (e) => {
            img.onload = () => {
              if (img.width < 10 || img.height < 10) {
                reject(
                  new Error(
                    `Image too small: ${img.width}x${img.height}px. Images must be at least 10x10 pixels.`
                  )
                );
              } else {
                resolve();
              }
            };
            img.onerror = () => reject(new Error("Failed to load image"));
            img.src = e.target?.result as string;
          };
          reader.onerror = () => reject(new Error("Failed to read file"));
          reader.readAsDataURL(file);
        });

        // Upload to S3 via new screenshot API
        const nameWithoutExtension = file.name.replace(/\.[^/.]+$/, "");
        const result = await apiClient.uploadProjectScreenshot(
          parseInt(projectId ?? "0", 10),
          file,
          nameWithoutExtension,
          "manual_upload",
          undefined,
          (progress: number) => {
            setUploadingFiles((prev: UploadingImage[]) =>
              prev.map((f) => (f.name === file.name ? { ...f, progress } : f))
            );
          }
        );

        // Create screenshot object with S3 data
        const screenshotUrl = result.presigned_url;
        if (!screenshotUrl) {
          console.error("Upload response missing URL:", result);
          throw new Error("Upload succeeded but no URL was returned");
        }
        const screenshot = {
          id: result.id,
          name: result.name,
          url: normalizeUrl(screenshotUrl),
          size: result.file_size,
          uploadedAt: new Date(result.created_at),
          projectName: projectName,
        };

        // Add to context
        addScreenshot(screenshot);

        toast.success(`${file.name} uploaded successfully`);

        // Trigger auto-save
        handleAutoSave();

        // Select first uploaded screenshot
        if (!selectedScreenshot) {
          const img = new window.Image();
          img.onload = () => {
            setSelectedScreenshot({
              id: screenshot.id,
              name: screenshot.name,
              imageData: screenshot.url,
              width: img.width,
              height: img.height,
              uploadedAt: screenshot.uploadedAt,
              associatedStates: [],
              regions: [],
              locations: [],
            });
          };
          img.src = screenshot.url;
        }

        // Remove from uploading list
        setUploadingFiles((prev) => prev.filter((f) => f.name !== file.name));
      } catch (error: unknown) {
        console.error(`Upload failed for ${file.name}:`, error);

        // Show user-friendly error message
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("quota") || errorMsg.includes("Quota")) {
          toast.error("Storage quota exceeded", {
            description: "Please upgrade your plan or delete unused images.",
          });
        } else if (errorMsg.includes("too small")) {
          toast.error("Image too small", {
            description: errorMsg,
          });
        } else if (
          errorMsg.includes("Network error") ||
          errorMsg.includes("timeout")
        ) {
          toast.error("Network error", {
            description: "Please check your internet connection and try again.",
          });
        } else {
          toast.error(`Failed to upload ${file.name}`, {
            description: errorMsg,
          });
        }

        // Remove from uploading list
        setUploadingFiles((prev) => prev.filter((f) => f.name !== file.name));
      }
    }

    // Reset file input
    if (event.target) {
      event.target.value = "";
    }
  };

  const handleDeleteScreenshot = (screenshotId: string) => {
    removeScreenshot(screenshotId);
    if (selectedScreenshot?.id === screenshotId) {
      setSelectedScreenshot(
        screenshots.find((s) => s.id !== screenshotId) || null
      );
    }

    // Trigger auto-save
    handleAutoSave();
  };

  const handleStartEdit = (screenshot: Screenshot) => {
    setEditingScreenshotId(screenshot.id);
    setEditingName(screenshot.name);
  };

  const handleCancelEdit = () => {
    setEditingScreenshotId(null);
    setEditingName("");
  };

  const handleSaveEdit = () => {
    if (!editingScreenshotId || !editingName.trim()) {
      handleCancelEdit();
      return;
    }

    const projectScreenshot = projectScreenshots.find(
      (s) => s.id === editingScreenshotId
    );
    if (projectScreenshot) {
      updateScreenshot({
        ...projectScreenshot,
        name: editingName.trim(),
      });
    }

    if (selectedScreenshot?.id === editingScreenshotId) {
      setSelectedScreenshot({
        ...selectedScreenshot,
        name: editingName.trim(),
      });
    }

    handleCancelEdit();
  };

  const handleExportAll = () => {
    onExport(screenshots);
  };

  const handleExportJson = () => {
    downloadStateExport(states, screenshots);
    setShowExportMenu(false);
  };

  const handleExportPython = () => {
    downloadPythonStateCode(states, screenshots);
    setShowExportMenu(false);
  };

  // Fetch available monitors when opening the monitor menu
  const handleOpenMonitorMenu = async () => {
    setShowMonitorMenu(true);
    try {
      const apiUrl =
        process.env.NEXT_PUBLIC_RUNNER_URL || "http://localhost:9876";
      const response = await fetch(`${apiUrl}/api/capture/screenshot/monitors`);
      if (response.ok) {
        const data = await response.json();
        setAvailableMonitors(data.monitors || []);
      }
    } catch (error) {
      console.error("Failed to fetch monitors:", error);
      // Default to single monitor if API fails
      setAvailableMonitors([
        { index: 0, width: 1920, height: 1080, is_primary: true },
      ]);
    }
  };

  // Capture screenshot from screen
  const handleCaptureFromScreen = async (monitorIndex: number | null) => {
    setShowMonitorMenu(false);

    if (!projectId) {
      toast.error("No project selected", {
        description: "Please open a project before capturing screenshots.",
      });
      return;
    }

    setIsCapturing(true);
    try {
      const apiUrl =
        process.env.NEXT_PUBLIC_RUNNER_URL || "http://localhost:9876";
      const monitorParam =
        monitorIndex !== null ? `&monitor=${monitorIndex}` : "";
      const response = await fetch(
        `${apiUrl}/api/capture/screenshot/current?quality=95${monitorParam}`
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          errorText || `Failed to capture screenshot: ${response.statusText}`
        );
      }

      const data = await response.json();

      // Convert base64 to Blob
      const byteCharacters = atob(data.screenshot_base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "image/png" });

      // Create File object from Blob
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const monitorLabel =
        monitorIndex !== null ? `monitor${monitorIndex}_` : "";
      const filename = `screenshot_${monitorLabel}${timestamp}.png`;
      const file = new File([blob], filename, { type: "image/png" });

      // Add to uploading files for progress display
      setUploadingFiles([{ name: filename, progress: 0 }]);

      // Upload using new screenshot upload endpoint
      const result = await apiClient.uploadProjectScreenshot(
        parseInt(projectId ?? "0", 10),
        file,
        `Screenshot ${data.width}x${data.height}`,
        "web_capture",
        monitorIndex !== null ? monitorIndex : undefined,
        (progress) => {
          setUploadingFiles([{ name: filename, progress }]);
        }
      );

      // Add to screenshots
      const captureUrl = result.presigned_url;
      if (!captureUrl) {
        console.error("Upload response missing URL:", result);
        throw new Error("Upload succeeded but no URL was returned");
      }
      const screenshot = {
        id: result.id,
        name: result.name,
        url: captureUrl,
        size: result.file_size,
        uploadedAt: new Date(result.created_at),
        projectName: projectName,
      };

      addScreenshot(screenshot);

      // Trigger auto-save
      handleAutoSave();

      // Select the new screenshot
      const img = new window.Image();
      img.onload = () => {
        setSelectedScreenshot({
          id: screenshot.id,
          name: screenshot.name,
          imageData: screenshot.url,
          width: img.width,
          height: img.height,
          uploadedAt: screenshot.uploadedAt,
          associatedStates: [],
          regions: [],
          locations: [],
        });
      };
      img.src = screenshot.url;

      toast.success("Screenshot captured and uploaded", {
        description: `${data.width}x${data.height} pixels`,
      });
    } catch (error: unknown) {
      console.error("Screenshot capture failed:", error);
      toast.error("Failed to capture screenshot", {
        description:
          error instanceof Error
            ? error.message
            : "Make sure the runner is running on port 9876",
      });
    } finally {
      setIsCapturing(false);
      setUploadingFiles([]);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden bg-surface-canvas">
      {/* Upload Progress Indicator */}
      <ImageUploadProgress uploads={uploadingFiles} />

      {/* Toolbar */}
      <QontinuiHeader>
        <div className="flex items-center justify-between w-full">
          {/* Upload and Capture buttons */}
          <div className="flex items-center gap-2">
            {saveStatus === "saved" && (
              <div className="flex items-center gap-1 text-xs text-brand-success">
                <CheckCircle className="w-4 h-4" />
                <span>Saved</span>
              </div>
            )}
            <UploadButton onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-4 h-4" />
              Upload Screenshots
            </UploadButton>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />

            {/* Capture from Screen button */}
            <div className="relative" ref={monitorMenuRef}>
              <UploadButton
                onClick={handleOpenMonitorMenu}
                disabled={isCapturing}
              >
                {isCapturing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Camera className="w-4 h-4" />
                )}
                {isCapturing ? "Capturing..." : "Capture from Screen"}
              </UploadButton>

              {showMonitorMenu && (
                <div className="absolute left-0 mt-2 w-64 bg-surface-raised rounded-md shadow-lg z-10 border border-border-default">
                  <div className="py-1">
                    <div className="px-4 py-2 text-xs text-text-muted border-b border-border-default">
                      Select monitor to capture
                    </div>
                    {availableMonitors.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-text-muted flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading monitors...
                      </div>
                    ) : (
                      <>
                        {availableMonitors.map((monitor) => (
                          <button
                            key={monitor.index}
                            onClick={() =>
                              handleCaptureFromScreen(monitor.index)
                            }
                            className="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-surface-raised flex items-center gap-2"
                          >
                            <Monitor className="w-4 h-4" />
                            Monitor {monitor.index + 1}
                            {monitor.is_primary && (
                              <span className="text-xs text-brand-success ml-1">
                                (Primary)
                              </span>
                            )}
                            <span className="text-xs text-text-muted ml-auto">
                              {monitor.width}x{monitor.height}
                            </span>
                          </button>
                        ))}
                        {availableMonitors.length > 1 && (
                          <>
                            <div className="border-t border-border-default my-1"></div>
                            <button
                              onClick={() => handleCaptureFromScreen(null)}
                              className="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-surface-raised flex items-center gap-2"
                            >
                              <Monitor className="w-4 h-4" />
                              All Monitors Combined
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Zoom controls */}
          <div className="flex-1 flex items-center justify-center gap-2">
            {selectedScreenshot && (
              <GhostButton
                onClick={() =>
                  setZoomMode(zoomMode === "fit" ? "original" : "fit")
                }
                size="sm"
              >
                {zoomMode === "fit" ? "Original Size (1:1)" : "Fit to Screen"}
              </GhostButton>
            )}
          </div>

          {/* Export button */}
          <QontinuiHeaderActions>
            <div className="relative">
              <CreateButton
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={screenshots.length === 0}
              >
                <Download className="w-4 h-4" />
                Export
              </CreateButton>

              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-surface-raised rounded-md shadow-lg z-10 border border-border-default">
                  <div className="py-1">
                    <button
                      onClick={handleExportJson}
                      className="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-surface-raised flex items-center gap-2"
                    >
                      <FileJson className="w-4 h-4" />
                      Export as JSON
                      <span className="text-xs text-text-muted ml-auto">
                        qontinui
                      </span>
                    </button>
                    <button
                      onClick={handleExportPython}
                      className="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-surface-raised flex items-center gap-2"
                    >
                      <FileCode className="w-4 h-4" />
                      Export as Python Code
                    </button>
                    <div className="border-t border-border-default my-1"></div>
                    <button
                      onClick={handleExportAll}
                      className="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-surface-raised flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Export Raw Data
                      <span className="text-xs text-text-muted ml-auto">
                        debug
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </QontinuiHeaderActions>
        </div>
      </QontinuiHeader>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Screenshot List Sidebar */}
        <QontinuiSidebar className="overflow-y-auto">
          <h3 className="text-sm font-medium text-text-secondary mb-3">
            Screenshots ({screenshots.length})
          </h3>

          <div className="space-y-2">
            {screenshots.map((screenshot) => (
              <QontinuiCard
                key={screenshot.id}
                selected={selectedScreenshot?.id === screenshot.id}
                hoverable
                onClick={() => setSelectedScreenshot(screenshot)}
                className="group cursor-pointer p-2"
              >
                {/* Thumbnail */}
                <div className="aspect-video relative overflow-hidden rounded bg-surface-canvas">
                  {screenshot.imageData ? (
                    <img
                      src={screenshot.imageData}
                      alt={screenshot.name}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-text-muted text-xs">
                      No image
                    </div>
                  )}
                </div>

                {/* Name editing */}
                {editingScreenshotId === screenshot.id ? (
                  <div
                    className="mt-2 flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <QontinuiInput
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleSaveEdit();
                        } else if (e.key === "Escape") {
                          handleCancelEdit();
                        }
                      }}
                      className="flex-1 text-xs"
                      autoFocus
                    />
                    <button
                      onClick={handleSaveEdit}
                      className="p-1 bg-brand-success text-black rounded hover:bg-brand-success/90"
                      title="Save (Enter)"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="p-1 bg-surface-raised text-white rounded hover:bg-surface-raised/80"
                      title="Cancel (Esc)"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-1">
                    <p className="flex-1 text-xs font-medium truncate text-text-secondary">
                      {screenshot.name}
                    </p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartEdit(screenshot);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-brand-primary transition-opacity"
                      title="Edit name"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteScreenshot(screenshot.id);
                  }}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 bg-red-500/90 text-white rounded hover:bg-red-600 transition-opacity"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </QontinuiCard>
            ))}
          </div>
        </QontinuiSidebar>

        {/* Canvas Area */}
        <QontinuiMain>
          {selectedScreenshot ? (
            <div className="p-6 h-full">
              <div className="relative inline-block">
                {selectedScreenshot.imageData ? (
                  <>
                    <img
                      src={selectedScreenshot.imageData}
                      alt={selectedScreenshot.name}
                      className="border border-border-default shadow-lg bg-surface-raised"
                      style={{
                        maxWidth: zoomMode === "fit" ? "100%" : "none",
                        height: "auto",
                      }}
                    />
                    <div className="absolute bottom-2 left-2 bg-black/70 text-white px-2 py-1 rounded text-xs">
                      <span>
                        {selectedScreenshot.width} x {selectedScreenshot.height}
                        px
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center w-96 h-64 border border-border-default bg-surface-raised text-text-muted">
                    Image not available
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-muted">
              <div className="text-center">
                <Image className="w-12 h-12 mx-auto mb-2" />
                <p>Upload screenshots to begin</p>
              </div>
            </div>
          )}
        </QontinuiMain>
      </div>
    </div>
  );
};

export default ScreenshotUploadTab;
