/**
 * Screenshot Uploader Component
 * Handles screenshot upload and thumbnail display
 */

import React, { useCallback, useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Upload,
  X,
  Image as ImageIcon,
  Save,
  FolderOpen,
  AlertCircle,
  Database,
  Plus,
  Lightbulb,
} from "lucide-react";
import { calculateImageHashes } from "@/utils/imageUtils";
import { useAvailableStates } from "@/hooks/useAvailableStates";
import ProjectScreenshotSelector from "./ProjectScreenshotSelector";
import SnapshotScreenshotSelector from "./SnapshotScreenshotSelector";
import { DirectPatternCreation } from "./DirectPatternCreation";
import { AutoPatternExtraction } from "./AutoPatternExtraction";
import { MonitorSelector } from "@/components/monitor-selector";
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

interface ScreenshotUploaderProps {
  onUpload: (files: File[]) => void;
  screenshots: File[];
  selectedIndex: number;
  onSelectScreenshot: (index: number) => void;
}

const ScreenshotUploader: React.FC<ScreenshotUploaderProps> = ({
  onUpload,
  screenshots,
  selectedIndex,
  onSelectScreenshot,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState("upload");
  const [thumbnails, setThumbnails] = useState<{ [key: string]: string }>({});
  const [screenshotHashes, setScreenshotHashes] = useState<Map<string, string>>(
    new Map()
  );
  const [projectHashes, setProjectHashes] = useState<string[]>([]);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [showSnapshotSelector, setShowSnapshotSelector] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const { availableStates, loading: statesLoading } = useAvailableStates();
  const [selectedMonitors, setSelectedMonitors] = useState<number[]>([0]); // Default to primary monitor

  // Load project screenshot hashes on mount
  useEffect(() => {
    const loadProjectHashes = async () => {
      try {
        const projectId = "default";
        const response = await fetch(
          `http://localhost:8000/api/state-discovery/project/${projectId}/screenshots`
        );

        if (response.ok) {
          const data = await response.json();
          const hashes = data.screenshots.map(
            (s: APIProjectScreenshot) => s.hash
          );
          setProjectHashes(hashes);
        }
      } catch (error) {
        console.error("Failed to load project hashes:", error);
      }
    };

    loadProjectHashes();
  }, []);

  // Generate thumbnails for uploaded files
  useEffect(() => {
    const generateThumbnails = async () => {
      const newThumbnails: { [key: string]: string } = {};

      for (const file of screenshots) {
        if (file.type.startsWith("image/")) {
          try {
            // Create a unique key for this file
            const key = `${file.name}_${file.size}_${file.lastModified}`;

            // Check if we already have this thumbnail
            if (thumbnails[key]) {
              newThumbnails[key] = thumbnails[key];
              continue;
            }

            // Create object URL for the image
            const url = URL.createObjectURL(file);
            newThumbnails[key] = url;
          } catch (error) {
            console.error("Failed to generate thumbnail:", error);
          }
        }
      }

      // Clean up old URLs that are no longer needed
      Object.entries(thumbnails).forEach(([key, url]) => {
        if (!newThumbnails[key]) {
          URL.revokeObjectURL(url);
        }
      });

      setThumbnails(newThumbnails);
    };

    generateThumbnails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenshots]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      // Revoke all object URLs when component unmounts
      Object.values(thumbnails).forEach((url) => {
        URL.revokeObjectURL(url);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load saved project screenshots on mount
  useEffect(() => {
    const loadProjectScreenshots = async () => {
      try {
        const projectId = "default";
        const response = await fetch(
          `http://localhost:8000/api/state-discovery/project/${projectId}/screenshots`
        );
        if (response.ok) {
          const data = await response.json();
          console.log(
            "[ScreenshotUploader] Loading saved screenshots:",
            data.screenshots.length
          );
          // Just notify the user that saved screenshots are available
          if (screenshots.length === 0 && data.screenshots.length > 0) {
            setSaveMessage({
              type: "info",
              text: `${data.screenshots.length} saved screenshot(s) available. Use "Load from Project" to restore them.`,
            });
          }
        }
      } catch (error) {
        console.error("Failed to check for saved screenshots:", error);
      }
    };
    loadProjectScreenshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

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

        // Reload project hashes to include newly saved screenshots
        const hashResponse = await fetch(
          `http://localhost:8000/api/state-discovery/project/${projectId}/screenshots`
        );
        if (hashResponse.ok) {
          const hashData = await hashResponse.json();
          const updatedHashes = hashData.screenshots.map(
            (s: APIProjectScreenshot) => s.hash
          );
          setProjectHashes(updatedHashes);
        }
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

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Image Sources</h3>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="upload">Upload</TabsTrigger>
            <TabsTrigger value="project">Project</TabsTrigger>
            <TabsTrigger value="snapshots">Snapshots</TabsTrigger>
            <TabsTrigger value="direct" className="relative">
              Direct
              <Badge variant="secondary" className="ml-1 text-xs">
                beta
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="auto" className="relative">
              Auto
              <Badge variant="secondary" className="ml-1 text-xs">
                beta
              </Badge>
            </TabsTrigger>
          </TabsList>

          {/* Upload Tab */}
          <TabsContent value="upload" className="space-y-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-1 h-4 w-4" />
              Upload Files
            </Button>
          </TabsContent>

          {/* Project Tab */}
          <TabsContent value="project" className="space-y-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setShowProjectSelector(true)}
            >
              <FolderOpen className="mr-1 h-4 w-4" />
              Select from Project
            </Button>
          </TabsContent>

          {/* Snapshots Tab */}
          <TabsContent value="snapshots" className="space-y-2 mt-4">
            {/* State Filter Section */}
            <div className="state-filter-section">
              <Label className="text-xs">Filter by state (optional):</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {stateFilter.map((state) => (
                  <Badge key={state} variant="secondary" className="text-xs">
                    {state}
                    <X
                      className="ml-1 h-3 w-3 cursor-pointer"
                      onClick={() =>
                        setStateFilter((prev) =>
                          prev.filter((s) => s !== state)
                        )
                      }
                    />
                  </Badge>
                ))}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs"
                      disabled={statesLoading || availableStates.length === 0}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Filter
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {availableStates
                      .filter((s) => !stateFilter.includes(s))
                      .map((state) => (
                        <DropdownMenuItem
                          key={state}
                          onClick={() =>
                            setStateFilter((prev) => [...prev, state])
                          }
                        >
                          {state}
                        </DropdownMenuItem>
                      ))}
                    {availableStates.filter((s) => !stateFilter.includes(s))
                      .length === 0 && (
                      <DropdownMenuItem disabled>
                        No more states available
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                {stateFilter.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setStateFilter([])}
                  >
                    Clear All
                  </Button>
                )}
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setShowSnapshotSelector(true)}
            >
              <Database className="mr-1 h-4 w-4" />
              Select from Snapshots
            </Button>
          </TabsContent>

          {/* Direct Creation Tab */}
          <TabsContent value="direct" className="space-y-2 mt-4">
            <Alert className="mb-4">
              <Lightbulb className="h-4 w-4" />
              <AlertTitle>Experimental Feature</AlertTitle>
              <AlertDescription>
                Direct pattern creation from snapshots. This feature is in beta.
              </AlertDescription>
            </Alert>
            <DirectPatternCreation />
          </TabsContent>

          {/* Auto-Extract Tab */}
          <TabsContent value="auto" className="space-y-2 mt-4">
            <Alert className="mb-4">
              <Lightbulb className="h-4 w-4" />
              <AlertTitle>Experimental Feature</AlertTitle>
              <AlertDescription>
                AI-powered pattern extraction. Results may vary.
              </AlertDescription>
            </Alert>
            <AutoPatternExtraction />
          </TabsContent>
        </Tabs>

        {/* Monitor Selection */}
        {screenshots.length > 0 && (
          <div className="mt-4">
            <MonitorSelector
              monitors={selectedMonitors}
              onChange={setSelectedMonitors}
              label="Screenshot Monitors"
              showLabel={true}
            />
          </div>
        )}

        {/* Save to Project Button */}
        {screenshots.length > 0 && (
          <Button
            className="w-full"
            size="sm"
            onClick={handleSaveToProject}
            disabled={isSaving || screenshots.length === 0}
          >
            <Save className="mr-2 h-4 w-4" />
            {isSaving ? "Saving..." : "Save to Project"}
          </Button>
        )}

        {/* Duplicate Warning */}
        {duplicateCount > 0 && (
          <Alert className="py-2">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {duplicateCount} screenshot{duplicateCount !== 1 ? "s" : ""}{" "}
              already in project
            </AlertDescription>
          </Alert>
        )}

        {/* Save Message */}
        {saveMessage && (
          <Alert
            className={`py-2 ${
              saveMessage.type === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : saveMessage.type === "info"
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-green-200 bg-green-50 text-green-700"
            }`}
          >
            <AlertDescription className="text-xs">
              {saveMessage.text}
            </AlertDescription>
          </Alert>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {/* Drop Zone */}
      {screenshots.length === 0 && (
        <div
          className="border-2 border-dashed border-border-default rounded-lg p-6 text-center hover:border-border-subtle transition-colors"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <ImageIcon className="mx-auto h-12 w-12 text-text-muted mb-2" />
          <p className="text-sm text-text-secondary">
            Drag and drop images here
          </p>
          <p className="text-xs text-text-muted mt-1">PNG, JPG up to 50MB</p>
        </div>
      )}

      {/* Screenshot List */}
      {screenshots.length > 0 && (
        <ScrollArea className="h-[400px]">
          <div className="space-y-2">
            {screenshots.map((file, index) => (
              <div
                key={index}
                className={cn(
                  "relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all",
                  selectedIndex === index
                    ? "border-blue-500 shadow-md"
                    : "border-border-subtle hover:border-border-default"
                )}
                onClick={() => onSelectScreenshot(index)}
              >
                {/* Thumbnail */}
                <div className="aspect-video bg-surface-raised flex items-center justify-center overflow-hidden">
                  {(() => {
                    const key = `${file.name}_${file.size}_${file.lastModified}`;
                    const thumbnailUrl = thumbnails[key];

                    if (thumbnailUrl) {
                      return (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumbnailUrl}
                          alt={file.name}
                          className="w-full h-full object-cover"
                        />
                      );
                    } else {
                      return <ImageIcon className="h-8 w-8 text-text-muted" />;
                    }
                  })()}
                </div>

                {/* Filename */}
                <div className="p-2">
                  <p className="text-xs truncate">{file.name}</p>
                  <p className="text-xs text-text-muted">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>

                {/* Remove button */}
                <button
                  className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => handleRemove(index, e)}
                >
                  <X className="h-3 w-3" />
                </button>

                {/* Selection indicator */}
                {selectedIndex === index && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-blue-500" />
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Screenshot count */}
      {screenshots.length > 0 && (
        <p className="text-xs text-text-muted text-center">
          {screenshots.length} screenshot{screenshots.length !== 1 ? "s" : ""}{" "}
          uploaded
        </p>
      )}

      {/* Project Screenshot Selector Dialog */}
      <ProjectScreenshotSelector
        isOpen={showProjectSelector}
        onClose={() => setShowProjectSelector(false)}
        onSelect={handleSelectProjectScreenshots}
        currentHashes={Array.from(screenshotHashes.values())}
      />

      {/* Snapshot Screenshot Selector Dialog */}
      <SnapshotScreenshotSelector
        isOpen={showSnapshotSelector}
        onClose={() => setShowSnapshotSelector(false)}
        onSelect={handleSelectSnapshotScreenshots}
        stateFilter={stateFilter}
      />
    </div>
  );
};

export default ScreenshotUploader;
