import React, { useState } from "react";
import { Screenshot } from "../../types/Screenshot";
import {
  downloadStateExport,
  downloadPythonStateCode,
} from "../../lib/state-exporter";
import { useAutomation } from "../../contexts/automation-context";
import { State } from "../../contexts/automation-context/types";
import { ImageUploadProgress } from "@/components/ImageUploadProgress";
import { useAutoSave } from "./_hooks/useAutoSave";
import { useScreenshotSync } from "./_hooks/useScreenshotSync";
import { useScreenshotEditing } from "./_hooks/useScreenshotEditing";
import { useScreenshotUpload } from "./_hooks/useScreenshotUpload";
import { useScreenshotCapture } from "./_hooks/useScreenshotCapture";
import { ScreenshotToolbar } from "./_components/ScreenshotToolbar";
import { ScreenshotSidebar } from "./_components/ScreenshotSidebar";
import { ScreenshotPreview } from "./_components/ScreenshotPreview";

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

  const [selectedScreenshot, setSelectedScreenshot] =
    useState<Screenshot | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [zoomMode, setZoomMode] = useState<"fit" | "original">("fit");

  const { saveStatus, handleAutoSave } = useAutoSave(triggerSave);
  const screenshots = useScreenshotSync(projectScreenshots);
  const editing = useScreenshotEditing();

  const { uploadingFiles, setUploadingFiles, fileInputRef, handleFileUpload } =
    useScreenshotUpload({
      projectId,
      projectName,
      addScreenshot,
      selectedScreenshot,
      setSelectedScreenshot,
      handleAutoSave,
    });

  const capture = useScreenshotCapture({
    projectId,
    projectName,
    addScreenshot,
    setSelectedScreenshot,
    setUploadingFiles,
    handleAutoSave,
  });

  const handleDeleteScreenshot = (screenshotId: string) => {
    removeScreenshot(screenshotId);
    if (selectedScreenshot?.id === screenshotId) {
      setSelectedScreenshot(
        screenshots.find((s) => s.id !== screenshotId) || null
      );
    }
    handleAutoSave();
  };

  const handleSaveEdit = () => {
    if (!editing.editingScreenshotId || !editing.editingName.trim()) {
      editing.handleCancelEdit();
      return;
    }

    const projectScreenshot = projectScreenshots.find(
      (s) => s.id === editing.editingScreenshotId
    );
    if (projectScreenshot) {
      updateScreenshot({
        ...projectScreenshot,
        name: editing.editingName.trim(),
      });
    }

    if (selectedScreenshot?.id === editing.editingScreenshotId) {
      setSelectedScreenshot({
        ...selectedScreenshot,
        name: editing.editingName.trim(),
      });
    }

    editing.handleCancelEdit();
  };

  const handleExportJson = () => {
    downloadStateExport(states, screenshots);
    setShowExportMenu(false);
  };

  const handleExportPython = () => {
    downloadPythonStateCode(states, screenshots);
    setShowExportMenu(false);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden bg-surface-canvas">
      <ImageUploadProgress uploads={uploadingFiles} />

      <ScreenshotToolbar
        saveStatus={saveStatus}
        selectedScreenshot={selectedScreenshot}
        zoomMode={zoomMode}
        onZoomToggle={() =>
          setZoomMode(zoomMode === "fit" ? "original" : "fit")
        }
        fileInputRef={fileInputRef}
        onFileUpload={handleFileUpload}
        isCapturing={capture.isCapturing}
        showMonitorMenu={capture.showMonitorMenu}
        availableMonitors={capture.availableMonitors}
        monitorMenuRef={capture.monitorMenuRef}
        onOpenMonitorMenu={capture.handleOpenMonitorMenu}
        onCaptureFromScreen={capture.handleCaptureFromScreen}
        screenshots={screenshots}
        showExportMenu={showExportMenu}
        onToggleExportMenu={() => setShowExportMenu(!showExportMenu)}
        onExportJson={handleExportJson}
        onExportPython={handleExportPython}
        onExportAll={() => onExport(screenshots)}
      />

      <div className="flex flex-1 overflow-hidden min-h-0">
        <ScreenshotSidebar
          screenshots={screenshots}
          selectedScreenshot={selectedScreenshot}
          editingScreenshotId={editing.editingScreenshotId}
          editingName={editing.editingName}
          onSelect={setSelectedScreenshot}
          onDelete={handleDeleteScreenshot}
          onStartEdit={editing.handleStartEdit}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={editing.handleCancelEdit}
          onEditingNameChange={editing.setEditingName}
        />

        <ScreenshotPreview
          selectedScreenshot={selectedScreenshot}
          zoomMode={zoomMode}
        />
      </div>
    </div>
  );
};

export default ScreenshotUploadTab;
