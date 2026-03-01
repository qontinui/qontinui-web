"use client";

import React from "react";
import { ImageIcon } from "lucide-react";
import {
  Screenshot,
  SelectionMode,
  ScreenshotRegion,
  ScreenshotLocation,
} from "../../../types/Screenshot";
import { State } from "../../../contexts/automation-context/types";
import ScreenshotCanvas from "../../ScreenshotTab/ScreenshotCanvas";
import StateAssociationPanel from "../../ScreenshotTab/StateAssociationPanel";

interface CanvasAreaProps {
  selectedScreenshot: Screenshot | null;
  selectionMode: SelectionMode;
  states: State[];
  onRegionCreate: (region: ScreenshotRegion) => void;
  onLocationCreate: (location: ScreenshotLocation) => void;
  onRegionSelect: (region: ScreenshotRegion | null) => void;
  onLocationSelect: (location: ScreenshotLocation | null) => void;
  onStateAssociation: (stateIds: string[]) => void;
}

const CanvasArea: React.FC<CanvasAreaProps> = ({
  selectedScreenshot,
  selectionMode,
  states,
  onRegionCreate,
  onLocationCreate,
  onRegionSelect,
  onLocationSelect,
  onStateAssociation,
}) => {
  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
      {selectedScreenshot ? (
        <>
          <ScreenshotCanvas
            screenshot={selectedScreenshot}
            selectionMode={selectionMode}
            zoomMode="fit"
            onRegionCreate={onRegionCreate}
            onLocationCreate={onLocationCreate}
            onRegionSelect={onRegionSelect}
            onLocationSelect={onLocationSelect}
          />
          <StateAssociationPanel
            screenshot={selectedScreenshot}
            states={states}
            onStateAssociation={onStateAssociation}
          />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-text-muted bg-surface-inset">
          <div className="text-center">
            <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">
              Select a screenshot to annotate
            </p>
            <p className="text-sm mt-2 text-text-muted">
              Upload, capture, or select from project screenshots
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CanvasArea;
