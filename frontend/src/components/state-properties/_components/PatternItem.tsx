"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Plus,
  Trash2,
  Image as ImageIcon,
  ChevronRight,
  Link2,
} from "lucide-react";
import { ImageSelector } from "@/components/image-selector";
import { ImageStatsDisplay } from "@/components/image-stats-display";
import { StateImageViewer } from "@/components/state-image-viewer";
import type { State, StateImage, Pattern } from "@/stores/automation";

export interface PatternItemProps {
  pattern: Pattern;
  patternIndex: number;
  stateImage: StateImage;
  stateImageIndex: number;
  allStates: State[];
  openImageSelectorId: string | null;
  setOpenImageSelectorId: (id: string | null) => void;
  setShowAddSearchRegionDialog: (
    value: { stateImageIndex: number; patternIndex?: number } | null
  ) => void;
  images: Array<{ id: string; name: string; url: string }>;
  updateStateImage: (index: number, updates: Partial<StateImage>) => void;
  resolvePatternImage: (
    pattern: Pattern
  ) => { url: string; mask?: string } | null;
}

export function PatternItem({
  pattern,
  patternIndex: pIdx,
  stateImage,
  stateImageIndex: index,
  allStates,
  openImageSelectorId,
  setOpenImageSelectorId,
  setShowAddSearchRegionDialog,
  images,
  updateStateImage,
  resolvePatternImage,
}: PatternItemProps) {
  return (
    <div className="p-2 bg-surface-canvas/50 border border-border-default rounded space-y-1.5">
      {/* Pattern header with image */}
      <div className="flex items-start gap-2">
        {/* Pattern image */}
        <div
          className="w-24 h-16 bg-surface-raised rounded overflow-hidden flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-brand-primary transition-all"
          role="button"
          tabIndex={0}
          onClick={() =>
            setOpenImageSelectorId(`${stateImage.id}_pattern_${pIdx}`)
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpenImageSelectorId(`${stateImage.id}_pattern_${pIdx}`);
            }
          }}
          title="Click to select image for this pattern"
          style={{
            background:
              "linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)",
            backgroundSize: "8px 8px",
            backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
            backgroundColor: "#444",
          }}
        >
          {(() => {
            const imageData = resolvePatternImage(pattern);
            return imageData ? (
              <StateImageViewer
                image={imageData.url}
                mask={imageData.mask}
                mode={imageData.mask ? "with-mask" : "normal"}
                alt={pattern.name || `Pattern ${pIdx + 1}`}
                className="w-full h-full"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="w-4 h-4 text-text-muted" />
              </div>
            );
          })()}
        </div>

        {/* Pattern info */}
        <div className="flex-1 min-w-0">
          <Input
            value={pattern.name || ""}
            onChange={(e) => {
              const updatedPatterns = [...(stateImage.patterns || [])];
              updatedPatterns[pIdx] = {
                ...updatedPatterns[pIdx],
                name: e.target.value,
              } as Pattern;
              updateStateImage(index, {
                patterns: updatedPatterns,
              });
            }}
            className="h-6 bg-surface-raised border-border-subtle text-text-secondary text-xs px-2 mb-1"
            placeholder={`Pattern ${pIdx + 1}`}
          />
          <ImageStatsDisplay
            imageDataUrl={resolvePatternImage(pattern)?.url || null}
          />
          {(pattern.searchRegions?.length || 0) > 0 && (
            <div className="text-xs text-text-muted mt-0.5">
              {pattern.searchRegions!.length} search region
              {pattern.searchRegions!.length > 1 ? "s" : ""}
            </div>
          )}
        </div>

        {/* Delete pattern button */}
        {(stateImage.patterns || []).length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-red-400 hover:text-red-300 flex-shrink-0"
            onClick={() => {
              const updatedPatterns = (stateImage.patterns || []).filter(
                (_, idx) => idx !== pIdx
              );
              updateStateImage(index, {
                patterns: updatedPatterns,
              });
            }}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        )}
      </div>

      {/* Pattern-specific properties */}
      <div className="space-y-2">
        {/* Fixed checkbox */}
        <div className="flex items-center space-x-1.5">
          <Checkbox
            id={`pattern-fixed-${pattern.id}`}
            checked={pattern.fixed || false}
            onCheckedChange={(checked) => {
              const updatedPatterns = [...(stateImage.patterns || [])];
              updatedPatterns[pIdx] = {
                ...updatedPatterns[pIdx],
                fixed: checked as boolean,
              } as Pattern;
              updateStateImage(index, {
                patterns: updatedPatterns,
              });
            }}
            className="border-border-subtle data-[state=checked]:bg-brand-primary data-[state=checked]:border-brand-primary"
          />
          <Label
            htmlFor={`pattern-fixed-${pattern.id}`}
            className="text-xs text-text-secondary cursor-pointer"
          >
            Fixed Position
          </Label>
        </div>

        {/* Options - Collapsible section */}
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer text-xs text-text-secondary hover:text-brand-primary transition-colors list-none py-1 px-2 bg-surface-raised/30 rounded">
            <span className="font-medium">Options</span>
            <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
          </summary>
          <div className="mt-2 space-y-3 pl-2 border-l-2 border-border-default">
            {/* Search Regions section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-text-secondary font-medium">
                  Search Regions ({(pattern.searchRegions || []).length})
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-2 text-xs text-brand-secondary hover:text-brand-secondary/80"
                  onClick={() => {
                    setShowAddSearchRegionDialog({
                      stateImageIndex: index,
                      patternIndex: pIdx,
                    });
                  }}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add
                </Button>
              </div>

              {/* Display search regions for this pattern */}
              {(pattern.searchRegions || []).length > 0 ? (
                <div className="space-y-1">
                  {pattern.searchRegions!.map((sr, srIdx) => {
                    // Check if this search region has a linked reference image
                    const hasLinkedPosition = !!sr.referenceImageId;
                    let linkedInfo = null;

                    if (hasLinkedPosition) {
                      // Find the state and image that this region is linked to
                      const linkedState = allStates.find((s) =>
                        s.stateImages?.some(
                          (img) => img.id === sr.referenceImageId
                        )
                      );
                      const linkedImage = linkedState?.stateImages?.find(
                        (img) => img.id === sr.referenceImageId
                      );
                      linkedInfo = {
                        stateName: linkedState?.name || "Unknown State",
                        imageName: linkedImage?.name || "Unknown Image",
                      };
                    }

                    return (
                      <div
                        key={srIdx}
                        className="flex items-center justify-between gap-2 py-1 px-2 bg-surface-canvas/50 border border-brand-secondary/30 rounded text-xs"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {hasLinkedPosition && linkedInfo ? (
                            <span className="text-text-secondary truncate flex items-center gap-1.5">
                              <Link2 className="w-3 h-3 flex-shrink-0" />
                              {linkedInfo.stateName} → {linkedInfo.imageName}
                            </span>
                          ) : (
                            <>
                              <span className="text-text-muted">↖</span>
                              <span className="text-text-secondary">
                                {sr.x},{sr.y}
                              </span>
                              <span className="text-text-muted">↔</span>
                              <span className="text-text-secondary">
                                {sr.width}
                              </span>
                              <span className="text-text-muted">↕</span>
                              <span className="text-text-secondary">
                                {sr.height}
                              </span>
                            </>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 text-red-400 hover:text-red-300 flex-shrink-0"
                          onClick={() => {
                            const updatedPatterns = [
                              ...(stateImage.patterns || []),
                            ];
                            const currentPattern = updatedPatterns[pIdx];
                            if (currentPattern) {
                              updatedPatterns[pIdx] = {
                                ...currentPattern,
                                searchRegions:
                                  currentPattern.searchRegions.filter(
                                    (_, idx) => idx !== srIdx
                                  ),
                              };
                            }
                            updateStateImage(index, {
                              patterns: updatedPatterns,
                            });
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-text-muted italic py-2 px-2 bg-surface-canvas/30 rounded border border-dashed border-border-default">
                  No search regions defined. Add regions in Create Regions &
                  Locations.
                </div>
              )}
            </div>

            {/* Similarity slider - optional */}
            <div className="space-y-1 pt-2 border-t border-border-default">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-text-secondary">
                  Pattern Similarity Override
                </Label>
                <div className="flex items-center gap-2">
                  {pattern.similarity !== undefined ? (
                    <>
                      <span className="text-xs text-text-muted">
                        {(pattern.similarity * 100).toFixed(0)}%
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-4 w-4 p-0 text-text-muted hover:text-red-400"
                        onClick={() => {
                          const updatedPatterns = [
                            ...(stateImage.patterns || []),
                          ];
                          const pattern = updatedPatterns[pIdx];
                          if (pattern) {
                            const { similarity: _similarity, ...rest } =
                              pattern;
                            updatedPatterns[pIdx] = rest as Pattern;
                          }
                          updateStateImage(index, {
                            patterns: updatedPatterns,
                          });
                        }}
                        title="Remove override"
                      >
                        ×
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-text-muted">
                      (using{" "}
                      {stateImage.probability !== undefined
                        ? "StateImage"
                        : "project"}{" "}
                      default)
                    </span>
                  )}
                </div>
              </div>
              {pattern.similarity !== undefined ? (
                <>
                  <Slider
                    min={0}
                    max={100}
                    step={1}
                    value={[pattern.similarity * 100]}
                    onValueChange={(values) => {
                      const updatedPatterns = [...(stateImage.patterns || [])];
                      const currentPattern = updatedPatterns[pIdx];
                      if (currentPattern) {
                        updatedPatterns[pIdx] = {
                          ...currentPattern,
                          similarity: values[0]! / 100,
                        };
                        updateStateImage(index, {
                          patterns: updatedPatterns,
                        });
                      }
                    }}
                    className="w-full"
                  />
                  <p className="text-xs text-text-muted italic">
                    Minimum match confidence for this pattern
                  </p>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-6 text-xs text-brand-primary hover:text-brand-primary/80 hover:bg-brand-primary/10"
                  onClick={() => {
                    const updatedPatterns = [...(stateImage.patterns || [])];
                    updatedPatterns[pIdx] = {
                      ...updatedPatterns[pIdx],
                      similarity: 0.85,
                    } as Pattern;
                    updateStateImage(index, {
                      patterns: updatedPatterns,
                    });
                  }}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Set Pattern Override
                </Button>
              )}
            </div>
          </div>
        </details>
      </div>

      {/* Hidden image selector for this pattern */}
      <ImageSelector
        selectedImage={pattern.imageId || null}
        onSelectImage={async (imageId) => {
          const updatedPatterns = [...(stateImage.patterns || [])];
          if (imageId) {
            // Store only the imageId - library is source of truth
            updatedPatterns[pIdx] = {
              ...updatedPatterns[pIdx],
              imageId: imageId,
            } as Pattern;
            updateStateImage(index, {
              patterns: updatedPatterns,
              source: "upload",
            });
          } else {
            // Remove the pattern if no image selected
            const filteredPatterns = updatedPatterns.filter(
              (_, idx) => idx !== pIdx
            );
            updateStateImage(index, {
              patterns: filteredPatterns,
            });
          }
        }}
        images={images}
        placeholder="Select image"
        open={openImageSelectorId === `${stateImage.id}_pattern_${pIdx}`}
        onOpenChange={(open) => {
          if (!open) {
            setOpenImageSelectorId(null);
          }
        }}
        hideTrigger={true}
      />
    </div>
  );
}
