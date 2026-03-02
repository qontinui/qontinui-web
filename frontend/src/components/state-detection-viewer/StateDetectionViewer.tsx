"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useStateDetection } from "./_hooks/use-state-detection";
import { HeaderCard } from "./_components/HeaderCard";
import { StateListPanel } from "./_components/StateListPanel";
import { StateDetailPanel } from "./_components/StateDetailPanel";
import { ScreenshotPreviewPanel } from "./_components/ScreenshotPreviewPanel";
import type { StateDetectionViewerProps } from "./types";

export function StateDetectionViewer({
  sessionId: initialSessionId,
  onExport,
  className,
}: StateDetectionViewerProps) {
  const {
    sessionId,
    setSessionId,
    states,
    selectedState,
    setSelectedState,
    searchQuery,
    setSearchQuery,
    isLoading,
    error,
    editingStateId,
    setEditingStateId,
    editValue,
    setEditValue,
    algorithm,
    setAlgorithm,
    stateThreshold,
    setStateThreshold,
    maxInputDistance,
    setMaxInputDistance,
    metadata,
    filteredStates,
    loadStates,
    handleRenameState,
    handleExport,
  } = useStateDetection(initialSessionId);

  return (
    <div className={cn("flex flex-col h-full gap-4 p-4", className)}>
      <HeaderCard
        sessionId={sessionId}
        onSessionIdChange={setSessionId}
        isLoading={isLoading}
        onLoadStates={loadStates}
        algorithm={algorithm}
        onAlgorithmChange={setAlgorithm}
        stateThreshold={stateThreshold}
        onStateThresholdChange={setStateThreshold}
        maxInputDistance={maxInputDistance}
        onMaxInputDistanceChange={setMaxInputDistance}
        metadata={metadata}
        error={error}
      />

      {/* Main Content Grid */}
      <div className="grid grid-cols-3 gap-4 flex-1 min-h-0">
        <StateListPanel
          filteredStates={filteredStates}
          allStatesCount={states.length}
          selectedState={selectedState}
          onSelectState={setSelectedState}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          editingStateId={editingStateId}
          editValue={editValue}
          onEditValueChange={setEditValue}
          onStartEditing={(stateId) => {
            setEditingStateId(stateId);
            setEditValue(stateId);
          }}
          onCancelEditing={() => {
            setEditingStateId(null);
            setEditValue("");
          }}
          onRenameState={handleRenameState}
          onExport={() => handleExport(onExport)}
          isLoading={isLoading}
          hasStates={states.length > 0}
        />

        {/* Right Panel - State Details (2 columns) */}
        <div className="col-span-2 grid grid-cols-2 gap-4">
          <StateDetailPanel selectedState={selectedState} />
          <ScreenshotPreviewPanel selectedState={selectedState} />
        </div>
      </div>
    </div>
  );
}

export default StateDetectionViewer;
