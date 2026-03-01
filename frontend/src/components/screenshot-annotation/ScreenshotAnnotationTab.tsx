import React from "react";
import { ScreenshotAnnotationTabProps } from "./screenshot-annotation-types";
import { useScreenshotAnnotationState } from "./_hooks/use-screenshot-annotation-state";
import AnnotationToolbar from "./_components/AnnotationToolbar";
import ScreenshotSidebar from "./_components/ScreenshotSidebar";
import CanvasArea from "./_components/CanvasArea";
import PropertiesPanel from "./_components/PropertiesPanel";

const ScreenshotAnnotationTab: React.FC<ScreenshotAnnotationTabProps> = ({
  states,
}) => {
  const {
    // State
    screenshots,
    selectedScreenshot,
    setSelectedScreenshot,
    selectionMode,
    setSelectionMode,
    setSelectedRegion,
    setSelectedLocation,
    showRegionPanel,
    setShowRegionPanel,
    showLocationPanel,
    setShowLocationPanel,
    openRegions,
    openLocations,
    activeRegionTab,
    setActiveRegionTab,
    activeLocationTab,
    setActiveLocationTab,
    saveStatus,
    isCapturing,
    showMonitorMenu,
    availableMonitors,

    // Refs
    fileInputRef,
    screenshotSelectorTriggerRef,
    monitorMenuRef,

    // Handlers
    handleFileSelect,
    handleSelectProjectScreenshot,
    handleOpenMonitorMenu,
    handleCaptureFromScreen,
    handleRegionCreate,
    handleLocationCreate,
    handleRegionUpdate,
    handleRegionDelete,
    handleLocationUpdate,
    handleLocationDelete,
    handleStateAssociation,
  } = useScreenshotAnnotationState(states);

  return (
    <div className="flex flex-col h-full w-full bg-surface-canvas">
      {/* Mode Toolbar */}
      <AnnotationToolbar
        screenshotCount={screenshots.length}
        saveStatus={saveStatus}
        selectionMode={selectionMode}
        showRegionPanel={showRegionPanel}
        showLocationPanel={showLocationPanel}
        onSelectionModeChange={setSelectionMode}
        onToggleRegionPanel={() => {
          setSelectionMode("region");
          setShowRegionPanel(!showRegionPanel);
          setShowLocationPanel(false);
        }}
        onToggleLocationPanel={() => {
          setSelectionMode("location");
          setShowLocationPanel(!showLocationPanel);
          setShowRegionPanel(false);
        }}
      />

      {/* Main Content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Screenshot List */}
        <ScreenshotSidebar
          screenshots={screenshots}
          selectedScreenshot={selectedScreenshot}
          states={states}
          isCapturing={isCapturing}
          showMonitorMenu={showMonitorMenu}
          availableMonitors={availableMonitors}
          fileInputRef={fileInputRef}
          screenshotSelectorTriggerRef={screenshotSelectorTriggerRef}
          monitorMenuRef={monitorMenuRef}
          onSelectScreenshot={setSelectedScreenshot}
          onSelectProjectScreenshot={handleSelectProjectScreenshot}
          onFileSelect={handleFileSelect}
          onOpenMonitorMenu={handleOpenMonitorMenu}
          onCaptureFromScreen={handleCaptureFromScreen}
          onRegionCreate={handleRegionCreate}
        />

        {/* Canvas Area */}
        <CanvasArea
          selectedScreenshot={selectedScreenshot}
          selectionMode={selectionMode}
          states={states}
          onRegionCreate={handleRegionCreate}
          onLocationCreate={handleLocationCreate}
          onRegionSelect={setSelectedRegion}
          onLocationSelect={setSelectedLocation}
          onStateAssociation={handleStateAssociation}
        />

        {/* Properties Panel */}
        <PropertiesPanel
          showRegionPanel={showRegionPanel}
          showLocationPanel={showLocationPanel}
          openRegions={openRegions}
          openLocations={openLocations}
          activeRegionTab={activeRegionTab}
          activeLocationTab={activeLocationTab}
          states={states}
          screenshots={screenshots}
          onActiveRegionTabChange={setActiveRegionTab}
          onActiveLocationTabChange={setActiveLocationTab}
          onRegionSelect={setSelectedRegion}
          onLocationSelect={setSelectedLocation}
          onRegionUpdate={handleRegionUpdate}
          onRegionDelete={handleRegionDelete}
          onLocationUpdate={handleLocationUpdate}
          onLocationDelete={handleLocationDelete}
        />
      </div>
    </div>
  );
};

export default ScreenshotAnnotationTab;
