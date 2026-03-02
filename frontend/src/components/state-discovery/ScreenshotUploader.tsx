/**
 * Screenshot Uploader Component
 * Handles screenshot upload and thumbnail display
 */

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Save, AlertCircle } from "lucide-react";
import { MonitorSelector } from "@/components/monitor-selector";
import ProjectScreenshotSelector from "./ProjectScreenshotSelector";
import SnapshotScreenshotSelector from "./SnapshotScreenshotSelector";
import { useScreenshotThumbnails } from "./_hooks/useScreenshotThumbnails";
import { useScreenshotUploader } from "./_hooks/useScreenshotUploader";
import ScreenshotDropZone from "./_components/ScreenshotDropZone";
import ScreenshotList from "./_components/ScreenshotList";
import ImageSourceTabs from "./_components/ImageSourceTabs";
import SaveMessageAlert from "./_components/SaveMessageAlert";

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
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const { getThumbnailUrl } = useScreenshotThumbnails(screenshots);
  const {
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
  } = useScreenshotUploader(screenshots, onUpload);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Image Sources</h3>

        <ImageSourceTabs
          onOpenFileDialog={openFileDialog}
          onOpenProjectSelector={() => setShowProjectSelector(true)}
          onOpenSnapshotSelector={() => setShowSnapshotSelector(true)}
          stateFilter={stateFilter}
          onStateFilterChange={setStateFilter}
        />

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
        {saveMessage && <SaveMessageAlert message={saveMessage} />}

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
        <ScreenshotDropZone onDrop={handleDrop} onDragOver={handleDragOver} />
      )}

      {/* Screenshot List */}
      {screenshots.length > 0 && (
        <ScreenshotList
          screenshots={screenshots}
          selectedIndex={selectedIndex}
          onSelectScreenshot={onSelectScreenshot}
          onRemove={handleRemove}
          getThumbnailUrl={getThumbnailUrl}
        />
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
