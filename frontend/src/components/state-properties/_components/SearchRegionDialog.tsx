"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Link2 } from "lucide-react";
import type { State, StateImage } from "@/stores/automation";

export interface SearchRegionDialogProps {
  showAddSearchRegionDialog: {
    stateImageIndex: number;
    patternIndex?: number;
  };
  state: State;
  setShowAddSearchRegionDialog: (
    value: { stateImageIndex: number; patternIndex?: number } | null
  ) => void;
  updateStateImage: (index: number, updates: Partial<StateImage>) => void;
}

export function SearchRegionDialog({
  showAddSearchRegionDialog,
  state,
  setShowAddSearchRegionDialog,
  updateStateImage,
}: SearchRegionDialogProps) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      role="button"
      tabIndex={0}
      onClick={() => setShowAddSearchRegionDialog(null)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setShowAddSearchRegionDialog(null);
        }
      }}
    >
      <div
        className="bg-surface-raised border border-border-default rounded-lg p-6 max-w-md w-full max-h-[80vh] overflow-y-auto scrollbar-dark"
        role="button"
        tabIndex={0}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            ((e) => e.stopPropagation())(e);
          }
        }}
      >
        <h3 className="text-lg font-semibold text-text-secondary mb-4">
          Add Search Region
        </h3>
        <p className="text-sm text-text-muted mb-4">
          Select a StateRegion from this state to add as a search region to this{" "}
          {showAddSearchRegionDialog.patternIndex !== undefined
            ? "pattern"
            : "StateImage"}
        </p>

        {state.regions && state.regions.length > 0 ? (
          <div className="space-y-2">
            {state.regions.map((region) => {
              const stateImage =
                state.stateImages?.[showAddSearchRegionDialog.stateImageIndex];
              const pattern =
                showAddSearchRegionDialog.patternIndex !== undefined
                  ? stateImage?.patterns?.[
                      showAddSearchRegionDialog.patternIndex
                    ]
                  : undefined;
              const alreadyAdded =
                showAddSearchRegionDialog.patternIndex !== undefined
                  ? pattern?.searchRegions?.some((sr) => sr.id === region.id)
                  : stateImage?.searchRegions?.some(
                      (sr) => sr.id === region.id
                    );

              return (
                <button
                  key={region.id}
                  disabled={alreadyAdded}
                  onClick={() => {
                    if (!stateImage) return;

                    const newSearchRegion = {
                      id: region.id,
                      name: region.name,
                      x: region.x,
                      y: region.y,
                      width: region.width,
                      height: region.height,
                      referenceImageId: region.referenceImageId,
                    };

                    if (showAddSearchRegionDialog.patternIndex !== undefined) {
                      // Add to Pattern-level search regions
                      const updatedPatterns = [...(stateImage.patterns || [])];

                      // Ensure the pattern exists
                      while (
                        updatedPatterns.length <=
                        showAddSearchRegionDialog.patternIndex
                      ) {
                        updatedPatterns.push({
                          id: `pattern_${Date.now()}`,
                          name: `Pattern ${updatedPatterns.length + 1}`,
                          imageId: "",
                          fixed: false,
                          searchRegions: [],
                        });
                      }

                      const currentPattern =
                        updatedPatterns[showAddSearchRegionDialog.patternIndex];
                      if (currentPattern) {
                        updatedPatterns[
                          showAddSearchRegionDialog.patternIndex
                        ] = {
                          ...currentPattern,
                          searchRegions: [
                            ...(currentPattern.searchRegions || []),
                            newSearchRegion,
                          ],
                        };
                      }

                      updateStateImage(
                        showAddSearchRegionDialog.stateImageIndex,
                        { patterns: updatedPatterns }
                      );
                    } else {
                      // Add to StateImage-level search regions
                      const updatedSearchRegions = [
                        ...(stateImage.searchRegions || []),
                        newSearchRegion,
                      ];
                      updateStateImage(
                        showAddSearchRegionDialog.stateImageIndex,
                        { searchRegions: updatedSearchRegions }
                      );
                    }

                    setShowAddSearchRegionDialog(null);
                  }}
                  className={`w-full text-left p-3 rounded border transition-colors ${
                    alreadyAdded
                      ? "border-border-default bg-surface-raised/30 text-text-muted cursor-not-allowed"
                      : "border-border-subtle hover:border-brand-secondary hover:bg-surface-raised/50 text-text-secondary"
                  }`}
                >
                  <div className="font-medium">{region.name}</div>
                  <div className="text-xs text-text-muted mt-1">
                    {region.referenceImageId ? (
                      <>
                        <Link2 className="w-3 h-3 inline mr-1" />
                        Linked position
                      </>
                    ) : (
                      `↖ ${region.x},${region.y} ↔ ${region.width} ↕ ${region.height}`
                    )}
                  </div>
                  {alreadyAdded && (
                    <div className="text-xs text-text-muted mt-1">
                      Already added
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-text-muted text-center py-8">
            No StateRegions available in this state. Create regions in the
            Create Regions & Locations tab.
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button
            variant="ghost"
            onClick={() => setShowAddSearchRegionDialog(null)}
            className="text-text-muted hover:text-text-secondary"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
