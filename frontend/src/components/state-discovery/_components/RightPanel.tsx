"use client";

/**
 * Right panel for the State Discovery tab.
 * Contains tabbed view of StateImage details and State details.
 */

import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import StateImageDetails from "../StateImageDetails";
import StateDetails from "../StateDetails";
import type { RightPanelProps } from "../state-discovery-types";

const RightPanel: React.FC<RightPanelProps> = ({
  rightPanelTab,
  onRightPanelTabChange,
  // State image details
  selectedStateImage,
  screenshots,
  filteredStates,
  onDeleteStateImage,
  // State details
  selectedState,
  filteredStateImages,
  selectedScreenshotIndex,
  onSelectScreenshot,
  onHighlightStateImages,
}) => {
  // Find the filtered version of the selected state (with pruned stateImageIds)
  const filteredSelectedState = selectedState
    ? filteredStates.find((s) => s.id === selectedState.id) || selectedState
    : null;

  return (
    <div className="w-80 border-l overflow-hidden flex flex-col">
      <Tabs
        value={rightPanelTab}
        onValueChange={(v) =>
          onRightPanelTabChange(v as "stateimage" | "state")
        }
        className="flex flex-col h-full"
      >
        <div className="border-b px-4 pt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="stateimage">StateImages</TabsTrigger>
            <TabsTrigger value="state">States</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="stateimage"
          className="flex-1 overflow-y-auto px-4 pb-4 mt-0"
        >
          {selectedStateImage ? (
            <StateImageDetails
              stateImage={selectedStateImage}
              screenshots={screenshots}
              states={filteredStates}
              onUpdate={() => {
                // Handle StateImage updates
              }}
              onDelete={onDeleteStateImage}
              onMerge={() => {
                // Handle merge
              }}
            />
          ) : (
            <div className="text-center text-text-muted mt-8">
              <p>Select a StateImage to view details</p>
            </div>
          )}
        </TabsContent>

        <TabsContent
          value="state"
          className="flex-1 overflow-y-auto px-4 pb-4 mt-0"
        >
          {filteredSelectedState ? (
            <StateDetails
              state={filteredSelectedState}
              stateImages={filteredStateImages}
              screenshots={screenshots}
              currentScreenshotIndex={selectedScreenshotIndex}
              onSelectScreenshot={(index) => {
                onSelectScreenshot(index);
              }}
              onHighlightStateImages={onHighlightStateImages}
            />
          ) : (
            <div className="text-center text-text-muted mt-8">
              <p>Select a State to view details</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default RightPanel;
