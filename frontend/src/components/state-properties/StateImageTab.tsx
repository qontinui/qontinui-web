"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { useImages } from "@/hooks/automation";
import type { State, StateImage } from "@/stores/automation";
import { TabsContent } from "@/components/ui/tabs";
import { useStateImageTracking } from "./_hooks/useStateImageTracking";
import { StateImageCard } from "./_components/StateImageCard";
import { SearchRegionDialog } from "./_components/SearchRegionDialog";

interface StateImageTabProps {
  state: State;
  allStates: State[];
  images: Array<{ id: string; name: string; url: string }>;
  addStateImage: () => void;
  updateStateImage: (index: number, updates: Partial<StateImage>) => void;
  removeStateImage: (index: number) => void;
  moveStateImage: (stateImageIndex: number, targetStateId: string) => void;
}

export function StateImageTab({
  state,
  allStates,
  images,
  addStateImage,
  updateStateImage,
  removeStateImage,
  moveStateImage,
}: StateImageTabProps) {
  const { resolvePatternImage } = useImages();

  const { openImageSelectorId, setOpenImageSelectorId } =
    useStateImageTracking(state);

  const [expandedAdvancedSections, setExpandedAdvancedSections] = useState<
    Set<string>
  >(new Set());
  const [showAddSearchRegionDialog, setShowAddSearchRegionDialog] = useState<{
    stateImageIndex: number;
    patternIndex?: number;
  } | null>(null);

  return (
    <>
      <TabsContent value="images" className="flex-1 flex flex-col min-h-0 p-4">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs text-brand-primary">StateImages</Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={addStateImage}
            className="text-brand-primary hover:text-brand-primary/80"
          >
            <Plus className="w-3 h-3" />
          </Button>
        </div>

        {!state.stateImages || state.stateImages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center border border-dashed border-border-subtle rounded">
            <p className="text-sm text-text-muted">No images configured</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-dark pr-2">
            <div className="grid grid-cols-2 gap-3">
              {state.stateImages.map((stateImage, index) => (
                <StateImageCard
                  key={stateImage.id}
                  stateImage={stateImage}
                  index={index}
                  state={state}
                  allStates={allStates}
                  images={images}
                  isAdvancedExpanded={expandedAdvancedSections.has(
                    stateImage.id
                  )}
                  openImageSelectorId={openImageSelectorId}
                  setOpenImageSelectorId={setOpenImageSelectorId}
                  setExpandedAdvancedSections={setExpandedAdvancedSections}
                  setShowAddSearchRegionDialog={setShowAddSearchRegionDialog}
                  updateStateImage={updateStateImage}
                  removeStateImage={removeStateImage}
                  moveStateImage={moveStateImage}
                  resolvePatternImage={resolvePatternImage}
                />
              ))}
            </div>
          </div>
        )}
      </TabsContent>

      {showAddSearchRegionDialog !== null && (
        <SearchRegionDialog
          showAddSearchRegionDialog={showAddSearchRegionDialog}
          state={state}
          setShowAddSearchRegionDialog={setShowAddSearchRegionDialog}
          updateStateImage={updateStateImage}
        />
      )}
    </>
  );
}
