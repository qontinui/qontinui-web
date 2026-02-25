"use client";

import React, { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Plus,
  Trash2,
  Image as ImageIcon,
  Info,
  ChevronDown,
  ChevronRight,
  Link2,
  ArrowRightLeft,
  Accessibility,
} from "lucide-react";
import { ImageSelector } from "@/components/image-selector";
import { ImageStatsDisplay } from "@/components/image-stats-display";
import { StateImageViewer } from "@/components/state-image-viewer";
import { MonitorSelector } from "@/components/monitor-selector";
import { useImages } from "@/hooks/automation";
import type { State, StateImage, Pattern } from "@/stores/automation";
import { TabsContent } from "@/components/ui/tabs";

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

  const [openImageSelectorId, setOpenImageSelectorId] = useState<string | null>(
    null
  );
  const [expandedAdvancedSections, setExpandedAdvancedSections] = useState<
    Set<string>
  >(new Set());
  const [showAddSearchRegionDialog, setShowAddSearchRegionDialog] = useState<{
    stateImageIndex: number;
    patternIndex?: number;
  } | null>(null);

  // Track when a new StateImage is added to auto-open its first pattern's selector
  const prevStateId = useRef<string | null>(null);
  const prevStateImagesLength = useRef<number>(0);
  const prevPatternsCount = useRef<{ [key: string]: number }>({});

  useEffect(() => {
    // If the state ID changed, we're looking at a different state
    // Reset tracking without opening any selectors
    if (state.id !== prevStateId.current) {
      prevStateId.current = state.id;
      prevStateImagesLength.current = state.stateImages?.length || 0;
      prevPatternsCount.current = {};
      // Re-populate pattern counts for the new state
      if (state.stateImages) {
        state.stateImages.forEach((stateImage) => {
          prevPatternsCount.current[stateImage.id] =
            stateImage.patterns?.length || 0;
        });
      }
      return; // Don't auto-open anything when switching states
    }

    const currentLength = state.stateImages?.length || 0;

    // Check if a new StateImage was added (only if same state)
    if (currentLength > prevStateImagesLength.current && state.stateImages) {
      const lastImage = state.stateImages[state.stateImages.length - 1];
      // Open selector for the first pattern of the new StateImage
      if (lastImage) {
        setOpenImageSelectorId(`${lastImage.id}_pattern_0`);
      }
    }

    // Check if new patterns were added to existing StateImages (only if same state)
    if (state.stateImages) {
      state.stateImages.forEach((stateImage) => {
        const currentPatternCount = stateImage.patterns?.length || 0;
        const prevPatternCount = prevPatternsCount.current[stateImage.id] || 0;

        if (currentPatternCount > prevPatternCount) {
          // A new pattern was added, open its selector
          const newPatternIndex = currentPatternCount - 1;
          setOpenImageSelectorId(`${stateImage.id}_pattern_${newPatternIndex}`);
        }

        prevPatternsCount.current[stateImage.id] = currentPatternCount;
      });
    }

    prevStateImagesLength.current = currentLength;
  }, [state.id, state.stateImages]);

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
          <div className="flex-1 grid grid-cols-2 gap-3 overflow-y-auto scrollbar-dark pr-2 content-start">
            {state.stateImages.map((stateImage, index) => {
              const isAdvancedExpanded = expandedAdvancedSections.has(
                stateImage.id
              );

              // Auto-detect if any pattern in this StateImage is shared (appears in other states)
              const currentPatternImages = (stateImage.patterns || [])
                .map((p) => p.imageId)
                .filter((img) => img && img !== "");

              const otherStatesWithThesePatterns = allStates.filter(
                (s) =>
                  s.id !== state.id &&
                  s.stateImages?.some((img) =>
                    img.patterns?.some(
                      (p) =>
                        currentPatternImages.includes(p.imageId) &&
                        p.imageId !== ""
                    )
                  )
              );
              const isShared = otherStatesWithThesePatterns.length > 0;

              return (
                <div
                  key={stateImage.id}
                  className="rounded-lg overflow-hidden border-l-4 border-l-brand-primary bg-brand-primary/[0.03]"
                >
                  {/* Header bar with index */}
                  <div className="bg-brand-primary/15 px-3 py-2 flex items-center gap-2">
                    <span className="text-brand-primary text-xs font-bold min-w-[1.25rem]">
                      {index + 1}
                    </span>
                    <span className="text-text-secondary text-xs font-medium truncate flex-1">
                      {stateImage.name || "Unnamed"}
                    </span>
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={stateImage.name}
                        onChange={(e) =>
                          updateStateImage(index, { name: e.target.value })
                        }
                        className="flex-1 h-6 bg-surface-canvas border-border-subtle text-text-secondary text-xs px-2"
                        placeholder="StateImage name"
                      />
                      {/* Move button with popover */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-brand-primary hover:text-brand-primary/80"
                            title="Move to another state"
                            disabled={allStates.length <= 1}
                          >
                            <ArrowRightLeft className="w-3 h-3" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-56 p-2 bg-surface-raised border-border-default"
                          align="end"
                        >
                          <div className="space-y-2">
                            <p className="text-xs text-text-muted font-medium px-1">
                              Move to state:
                            </p>
                            <div className="max-h-48 overflow-y-auto scrollbar-dark space-y-1">
                              {allStates
                                .filter((s) => s.id !== state.id)
                                .map((targetState) => (
                                  <button
                                    key={targetState.id}
                                    className="w-full text-left px-2 py-1.5 text-xs text-text-secondary hover:bg-brand-primary/20 hover:text-brand-primary rounded transition-colors"
                                    onClick={() => {
                                      moveStateImage(index, targetState.id);
                                    }}
                                  >
                                    {targetState.name || targetState.id}
                                  </button>
                                ))}
                            </div>
                            {allStates.filter((s) => s.id !== state.id)
                              .length === 0 && (
                              <p className="text-xs text-text-muted italic px-1">
                                No other states available
                              </p>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                        onClick={() => removeStateImage(index)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>

                    {/* Summary info and pattern count */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">
                        {(stateImage.patterns || []).length} pattern
                        {(stateImage.patterns || []).length !== 1 ? "s" : ""}
                      </span>
                      {(() => {
                        const totalSearchRegions = (
                          stateImage.patterns || []
                        ).reduce(
                          (sum, pattern) =>
                            sum + (pattern.searchRegions?.length || 0),
                          0
                        );
                        return (
                          totalSearchRegions > 0 && (
                            <span className="text-text-muted">
                              {totalSearchRegions} search region
                              {totalSearchRegions > 1 ? "s" : ""}
                            </span>
                          )
                        );
                      })()}
                    </div>

                    {/* StateImage Options */}
                    {(stateImage.patterns || []).length > 1 && (
                      <div className="pt-2 border-t border-brand-primary/20">
                        <details className="group">
                          <summary className="flex items-center justify-between cursor-pointer text-xs text-text-secondary hover:text-brand-primary transition-colors list-none mb-2">
                            <span className="font-medium">
                              RAG Find Options
                            </span>
                            <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                          </summary>
                          <div className="space-y-2 pl-2">
                            <div className="space-y-1">
                              <Label className="text-xs text-text-muted">
                                Multi-Pattern Search Mode
                              </Label>
                              <Select
                                value={
                                  stateImage.ragMultiPatternMode || "default"
                                }
                                onValueChange={(value) => {
                                  updateStateImage(index, {
                                    ragMultiPatternMode:
                                      value === "default"
                                        ? undefined
                                        : (value as "all" | "combined"),
                                  });
                                }}
                              >
                                <SelectTrigger className="bg-transparent border-border-default h-7 text-xs">
                                  <SelectValue placeholder="Use project default" />
                                </SelectTrigger>
                                <SelectContent className="bg-surface-raised border-border-default">
                                  <SelectItem value="default">
                                    Use Project Default
                                  </SelectItem>
                                  <SelectItem value="all">
                                    Search All Patterns
                                  </SelectItem>
                                  <SelectItem value="combined">
                                    Search Combined Vector
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-text-muted">
                                Default mode for RAG Find when this StateImage
                                has multiple patterns. Can be overridden per
                                action.
                              </p>
                            </div>
                          </div>
                        </details>
                      </div>
                    )}

                    {/* Patterns List */}
                    <div className="pt-2 border-t border-brand-primary/20">
                      <details className="group" open>
                        <summary className="flex items-center justify-between cursor-pointer text-xs text-text-secondary hover:text-brand-primary transition-colors list-none mb-2">
                          <span className="font-medium">
                            Patterns ({(stateImage.patterns || []).length})
                          </span>
                          <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                        </summary>
                        <div className="space-y-2">
                          {(stateImage.patterns || []).map((pattern, pIdx) => (
                            <div
                              key={pattern.id}
                              className="p-2 bg-surface-canvas/50 border border-border-default rounded space-y-1.5"
                            >
                              {/* Pattern header with image */}
                              <div className="flex items-start gap-2">
                                {/* Pattern image */}
                                <div
                                  className="w-24 h-16 bg-surface-raised rounded overflow-hidden flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-brand-primary transition-all"
                                  onClick={() =>
                                    setOpenImageSelectorId(
                                      `${stateImage.id}_pattern_${pIdx}`
                                    )
                                  }
                                  title="Click to select image for this pattern"
                                  style={{
                                    background:
                                      "linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)",
                                    backgroundSize: "8px 8px",
                                    backgroundPosition:
                                      "0 0, 0 4px, 4px -4px, -4px 0px",
                                    backgroundColor: "#444",
                                  }}
                                >
                                  {(() => {
                                    const imageData =
                                      resolvePatternImage(pattern);
                                    return imageData ? (
                                      <StateImageViewer
                                        image={imageData.url}
                                        mask={imageData.mask}
                                        mode={
                                          imageData.mask
                                            ? "with-mask"
                                            : "normal"
                                        }
                                        alt={
                                          pattern.name || `Pattern ${pIdx + 1}`
                                        }
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
                                      const updatedPatterns = [
                                        ...(stateImage.patterns || []),
                                      ];
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
                                    imageDataUrl={
                                      resolvePatternImage(pattern)?.url || null
                                    }
                                  />
                                  {(pattern.searchRegions?.length || 0) > 0 && (
                                    <div className="text-xs text-text-muted mt-0.5">
                                      {pattern.searchRegions!.length} search
                                      region
                                      {pattern.searchRegions!.length > 1
                                        ? "s"
                                        : ""}
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
                                      const updatedPatterns = (
                                        stateImage.patterns || []
                                      ).filter((_, idx) => idx !== pIdx);
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
                                      const updatedPatterns = [
                                        ...(stateImage.patterns || []),
                                      ];
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
                                          Search Regions (
                                          {(pattern.searchRegions || []).length}
                                          )
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
                                      {(pattern.searchRegions || []).length >
                                      0 ? (
                                        <div className="space-y-1">
                                          {pattern.searchRegions!.map(
                                            (sr, srIdx) => {
                                              // Check if this search region has a linked reference image
                                              const hasLinkedPosition =
                                                !!sr.referenceImageId;
                                              let linkedInfo = null;

                                              if (hasLinkedPosition) {
                                                // Find the state and image that this region is linked to
                                                const linkedState =
                                                  allStates.find((s) =>
                                                    s.stateImages?.some(
                                                      (img) =>
                                                        img.id ===
                                                        sr.referenceImageId
                                                    )
                                                  );
                                                const linkedImage =
                                                  linkedState?.stateImages?.find(
                                                    (img) =>
                                                      img.id ===
                                                      sr.referenceImageId
                                                  );
                                                linkedInfo = {
                                                  stateName:
                                                    linkedState?.name ||
                                                    "Unknown State",
                                                  imageName:
                                                    linkedImage?.name ||
                                                    "Unknown Image",
                                                };
                                              }

                                              return (
                                                <div
                                                  key={srIdx}
                                                  className="flex items-center justify-between gap-2 py-1 px-2 bg-surface-canvas/50 border border-brand-secondary/30 rounded text-xs"
                                                >
                                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                                    {hasLinkedPosition &&
                                                    linkedInfo ? (
                                                      <span className="text-text-secondary truncate flex items-center gap-1.5">
                                                        <Link2 className="w-3 h-3 flex-shrink-0" />
                                                        {linkedInfo.stateName} →{" "}
                                                        {linkedInfo.imageName}
                                                      </span>
                                                    ) : (
                                                      <>
                                                        <span className="text-text-muted">
                                                          ↖
                                                        </span>
                                                        <span className="text-text-secondary">
                                                          {sr.x},{sr.y}
                                                        </span>
                                                        <span className="text-text-muted">
                                                          ↔
                                                        </span>
                                                        <span className="text-text-secondary">
                                                          {sr.width}
                                                        </span>
                                                        <span className="text-text-muted">
                                                          ↕
                                                        </span>
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
                                                        ...(stateImage.patterns ||
                                                          []),
                                                      ];
                                                      const currentPattern =
                                                        updatedPatterns[pIdx];
                                                      if (currentPattern) {
                                                        updatedPatterns[pIdx] =
                                                          {
                                                            ...currentPattern,
                                                            searchRegions:
                                                              currentPattern.searchRegions.filter(
                                                                (_, idx) =>
                                                                  idx !== srIdx
                                                              ),
                                                          };
                                                      }
                                                      updateStateImage(index, {
                                                        patterns:
                                                          updatedPatterns,
                                                      });
                                                    }}
                                                  >
                                                    <Trash2 className="w-3 h-3" />
                                                  </Button>
                                                </div>
                                              );
                                            }
                                          )}
                                        </div>
                                      ) : (
                                        <div className="text-xs text-text-muted italic py-2 px-2 bg-surface-canvas/30 rounded border border-dashed border-border-default">
                                          No search regions defined. Add regions
                                          in Create Regions & Locations.
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
                                                {(
                                                  pattern.similarity * 100
                                                ).toFixed(0)}
                                                %
                                              </span>
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-4 w-4 p-0 text-text-muted hover:text-red-400"
                                                onClick={() => {
                                                  const updatedPatterns = [
                                                    ...(stateImage.patterns ||
                                                      []),
                                                  ];
                                                  const pattern =
                                                    updatedPatterns[pIdx];
                                                  if (pattern) {
                                                    const {
                                                      similarity: _similarity,
                                                      ...rest
                                                    } = pattern;
                                                    updatedPatterns[pIdx] =
                                                      rest as Pattern;
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
                                              {stateImage.probability !==
                                              undefined
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
                                              const updatedPatterns = [
                                                ...(stateImage.patterns || []),
                                              ];
                                              const currentPattern =
                                                updatedPatterns[pIdx];
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
                                            Minimum match confidence for this
                                            pattern
                                          </p>
                                        </>
                                      ) : (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="w-full h-6 text-xs text-brand-primary hover:text-brand-primary/80 hover:bg-brand-primary/10"
                                          onClick={() => {
                                            const updatedPatterns = [
                                              ...(stateImage.patterns || []),
                                            ];
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
                                  const updatedPatterns = [
                                    ...(stateImage.patterns || []),
                                  ];
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
                                    const filteredPatterns =
                                      updatedPatterns.filter(
                                        (_, idx) => idx !== pIdx
                                      );
                                    updateStateImage(index, {
                                      patterns: filteredPatterns,
                                    });
                                  }
                                }}
                                images={images}
                                placeholder="Select image"
                                open={
                                  openImageSelectorId ===
                                  `${stateImage.id}_pattern_${pIdx}`
                                }
                                onOpenChange={(open) => {
                                  if (!open) {
                                    setOpenImageSelectorId(null);
                                  }
                                }}
                                hideTrigger={true}
                              />
                            </div>
                          ))}

                          {/* Add pattern button */}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full h-7 text-xs text-brand-primary hover:text-brand-primary/80 hover:bg-brand-primary/10 border border-dashed border-brand-primary/30"
                            onClick={() => {
                              const newPattern = {
                                id: `pattern_${Date.now()}`,
                                imageId: undefined, // Library is source of truth - no embedded data
                                searchRegions: [],
                                fixed: false,
                              };
                              const updatedPatterns = [
                                ...(stateImage.patterns || []),
                                newPattern,
                              ];
                              updateStateImage(index, {
                                patterns: updatedPatterns,
                              });
                            }}
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            Add Pattern Variation
                          </Button>
                        </div>
                      </details>
                    </div>

                    {/* Shared Status Message */}
                    {isShared && (
                      <div className="flex items-start gap-2 p-1.5 bg-blue-500/10 border border-blue-500/30 rounded mt-2">
                        <Info className="w-3 h-3 text-blue-400 flex-shrink-0 mt-0.5" />
                        <span className="text-xs text-blue-300">
                          One or more patterns appear in other states
                        </span>
                      </div>
                    )}

                    {/* Advanced Properties Section (Collapsible) */}
                    <div className="pt-1.5 border-t border-brand-primary/20">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full h-7 flex items-center justify-between text-xs text-text-secondary hover:text-brand-primary hover:bg-brand-primary/10 px-2"
                        onClick={() => {
                          setExpandedAdvancedSections((prev) => {
                            const newSet = new Set(prev);
                            if (newSet.has(stateImage.id)) {
                              newSet.delete(stateImage.id);
                            } else {
                              newSet.add(stateImage.id);
                            }
                            return newSet;
                          });
                        }}
                      >
                        <span className="font-medium">Advanced Properties</span>
                        {isAdvancedExpanded ? (
                          <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronRight className="w-3 h-3" />
                        )}
                      </Button>

                      {isAdvancedExpanded && (
                        <div className="space-y-2 mt-2 p-2 bg-surface-raised/50 border border-border-default rounded">
                          {/* StateImage-level Search Regions */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-text-secondary">
                                StateImage Search Regions
                              </Label>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 px-2 text-xs text-brand-primary hover:text-brand-primary/80"
                                onClick={() =>
                                  setShowAddSearchRegionDialog({
                                    stateImageIndex: index,
                                  })
                                }
                              >
                                <Plus className="w-3 h-3 mr-1" />
                                Add
                              </Button>
                            </div>
                            {(stateImage.searchRegions?.length || 0) > 0 ? (
                              <div className="space-y-1 mt-1">
                                {stateImage.searchRegions!.map((sr, srIdx) => {
                                  const hasLinkedPosition =
                                    !!sr.referenceImageId;
                                  const linkedInfo = hasLinkedPosition
                                    ? (() => {
                                        const refImageId = state.regions?.find(
                                          (r) => r.id === sr.id
                                        )?.referenceImageId;
                                        const refImage = refImageId
                                          ? state.stateImages?.find(
                                              (img) => img.id === refImageId
                                            )
                                          : null;
                                        return refImage
                                          ? {
                                              stateName: state.name,
                                              imageName:
                                                refImage.name || "Unnamed",
                                            }
                                          : null;
                                      })()
                                    : null;

                                  return (
                                    <div
                                      key={sr.id}
                                      className="flex items-center justify-between p-1.5 bg-surface-canvas/50 rounded border border-border-default"
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs text-text-secondary truncate">
                                          {sr.name}
                                        </div>
                                        {hasLinkedPosition && linkedInfo ? (
                                          <div className="text-xs text-text-muted mt-1 flex items-center gap-1.5">
                                            <Link2 className="w-3 h-3 flex-shrink-0" />
                                            {linkedInfo.stateName} →{" "}
                                            {linkedInfo.imageName}
                                          </div>
                                        ) : (
                                          <div className="text-xs text-text-muted mt-1">
                                            ↖ {sr.x},{sr.y} ↔ {sr.width} ↕{" "}
                                            {sr.height}
                                          </div>
                                        )}
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-5 w-5 p-0 text-red-400 hover:text-red-300 flex-shrink-0"
                                        onClick={() => {
                                          const updatedSearchRegions = (
                                            stateImage.searchRegions || []
                                          ).filter((_, idx) => idx !== srIdx);
                                          updateStateImage(index, {
                                            searchRegions: updatedSearchRegions,
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
                              <div className="text-xs text-text-muted italic p-2 bg-surface-canvas/30 rounded">
                                No search regions (searches whole screen)
                              </div>
                            )}
                            <div className="text-xs text-text-muted bg-surface-canvas/50 p-2 rounded border border-border-default mt-1">
                              <div className="font-medium text-text-muted mb-1">
                                Search Region Hierarchy:
                              </div>
                              <div className="space-y-0.5 pl-2">
                                <div>1. Options (highest priority)</div>
                                <div>2. Pattern-specific</div>
                                <div>3. StateImage-level</div>
                                <div>4. Whole screen</div>
                              </div>
                            </div>
                          </div>

                          {/* Search Mode */}
                          <div className="space-y-1 pb-2 border-b border-border-default">
                            <Label className="text-xs text-text-secondary">
                              Search Mode
                            </Label>
                            <Select
                              value={stateImage.searchMode || "default"}
                              onValueChange={(value) =>
                                updateStateImage(index, {
                                  searchMode: value as
                                    | "default"
                                    | "rag"
                                    | "template"
                                    | "accessibility",
                                })
                              }
                            >
                              <SelectTrigger className="bg-surface-canvas border-border-subtle text-xs h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-surface-raised border-border-default">
                                <SelectItem value="default">
                                  Default (Image Pattern)
                                </SelectItem>
                                <SelectItem value="rag">
                                  RAG (Vector Search)
                                </SelectItem>
                                <SelectItem value="template">
                                  Template Matching
                                </SelectItem>
                                <SelectItem value="accessibility">
                                  Accessibility (Ref-based)
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-text-muted italic">
                              {stateImage.searchMode === "accessibility"
                                ? "Using accessibility ref for element targeting"
                                : stateImage.searchMode === "rag"
                                  ? "Using vector similarity search"
                                  : stateImage.searchMode === "template"
                                    ? "Using template matching"
                                    : "Using default image pattern matching"}
                            </p>
                          </div>

                          {/* Accessibility Selector (only show if accessibility mode) */}
                          {stateImage.searchMode === "accessibility" && (
                            <div className="space-y-2 pb-2 border-b border-purple-500/30 bg-purple-500/5 p-2 rounded">
                              <div className="flex items-center gap-2">
                                <Accessibility className="w-3 h-3 text-purple-500" />
                                <Label className="text-xs text-purple-400">
                                  Accessibility Selector
                                </Label>
                              </div>
                              <div className="space-y-2">
                                <div className="space-y-1">
                                  <Label className="text-xs text-text-muted">
                                    Ref (e.g., @e1, @e2)
                                  </Label>
                                  <Input
                                    placeholder="@e1"
                                    value={
                                      stateImage.accessibilitySelector?.ref ||
                                      ""
                                    }
                                    onChange={(e) =>
                                      updateStateImage(index, {
                                        accessibilitySelector: {
                                          ...stateImage.accessibilitySelector,
                                          ref: e.target.value || undefined,
                                        },
                                      })
                                    }
                                    className="h-7 text-xs bg-surface-canvas font-mono"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs text-text-muted">
                                    Role (e.g., button, textbox)
                                  </Label>
                                  <Input
                                    placeholder="button"
                                    value={
                                      Array.isArray(
                                        stateImage.accessibilitySelector?.role
                                      )
                                        ? stateImage.accessibilitySelector.role.join(
                                            ", "
                                          )
                                        : stateImage.accessibilitySelector
                                            ?.role || ""
                                    }
                                    onChange={(e) =>
                                      updateStateImage(index, {
                                        accessibilitySelector: {
                                          ...stateImage.accessibilitySelector,
                                          role: e.target.value || undefined,
                                        },
                                      })
                                    }
                                    className="h-7 text-xs bg-surface-canvas"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs text-text-muted">
                                    Name (exact match)
                                  </Label>
                                  <Input
                                    placeholder="Submit"
                                    value={
                                      stateImage.accessibilitySelector?.name ||
                                      ""
                                    }
                                    onChange={(e) =>
                                      updateStateImage(index, {
                                        accessibilitySelector: {
                                          ...stateImage.accessibilitySelector,
                                          name: e.target.value || undefined,
                                        },
                                      })
                                    }
                                    className="h-7 text-xs bg-surface-canvas"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs text-text-muted">
                                    Name Contains
                                  </Label>
                                  <Input
                                    placeholder="Log"
                                    value={
                                      stateImage.accessibilitySelector
                                        ?.nameContains || ""
                                    }
                                    onChange={(e) =>
                                      updateStateImage(index, {
                                        accessibilitySelector: {
                                          ...stateImage.accessibilitySelector,
                                          nameContains:
                                            e.target.value || undefined,
                                        },
                                      })
                                    }
                                    className="h-7 text-xs bg-surface-canvas"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs text-text-muted">
                                    Automation ID (data-testid)
                                  </Label>
                                  <Input
                                    placeholder="submit-button"
                                    value={
                                      stateImage.accessibilitySelector
                                        ?.automationId || ""
                                    }
                                    onChange={(e) =>
                                      updateStateImage(index, {
                                        accessibilitySelector: {
                                          ...stateImage.accessibilitySelector,
                                          automationId:
                                            e.target.value || undefined,
                                        },
                                      })
                                    }
                                    className="h-7 text-xs bg-surface-canvas"
                                  />
                                </div>
                              </div>
                            </div>
                          )}

                          {/* StateImage-level Similarity Override (optional) */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-text-secondary">
                                StateImage Similarity Override
                              </Label>
                              <div className="flex items-center gap-2">
                                {stateImage.probability !== undefined ? (
                                  <>
                                    <span className="text-xs text-text-muted">
                                      {(stateImage.probability * 100).toFixed(
                                        0
                                      )}
                                      %
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-5 w-5 p-0 text-text-muted hover:text-red-400"
                                      onClick={() => {
                                        const {
                                          probability: _probability,
                                          ...rest
                                        } = stateImage;
                                        updateStateImage(
                                          index,
                                          rest as Omit<
                                            typeof stateImage,
                                            "probability"
                                          >
                                        );
                                      }}
                                      title="Remove override (use project default)"
                                    >
                                      ×
                                    </Button>
                                  </>
                                ) : (
                                  <span className="text-xs text-text-muted">
                                    (using project default)
                                  </span>
                                )}
                              </div>
                            </div>
                            {stateImage.probability !== undefined && (
                              <>
                                <Slider
                                  min={0}
                                  max={100}
                                  step={1}
                                  value={[
                                    (stateImage.probability ?? 0.85) * 100,
                                  ]}
                                  onValueChange={(values) => {
                                    updateStateImage(index, {
                                      probability: values[0]! / 100,
                                    });
                                  }}
                                  className="w-full"
                                />
                                <p className="text-xs text-text-muted italic">
                                  Override for all patterns in this StateImage
                                  (pattern-specific overrides take precedence)
                                </p>
                              </>
                            )}
                            {stateImage.probability === undefined && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full h-6 text-xs text-brand-primary hover:text-brand-primary/80 hover:bg-brand-primary/10"
                                onClick={() => {
                                  updateStateImage(index, {
                                    probability: 0.85,
                                  });
                                }}
                              >
                                <Plus className="w-3 h-3 mr-1" />
                                Set StateImage Override
                              </Button>
                            )}
                          </div>

                          {/* Similarity Hierarchy Info */}
                          <div className="text-xs text-text-muted bg-surface-canvas/50 p-2 rounded border border-border-default">
                            <div className="font-medium text-text-muted mb-1">
                              Similarity Hierarchy:
                            </div>
                            <div className="space-y-0.5 pl-2">
                              <div>1. Options (highest priority)</div>
                              <div>2. Pattern-specific</div>
                              <div>3. StateImage override</div>
                              <div>4. Project default (in Settings)</div>
                            </div>
                          </div>

                          {/* Monitor Assignment */}
                          <div className="space-y-1 pt-2 border-t border-border-default">
                            <MonitorSelector
                              monitors={stateImage.monitors || [0]}
                              onChange={(monitors) =>
                                updateStateImage(index, { monitors })
                              }
                              label="Monitors for this StateImage"
                              showLabel={true}
                              showConnectionStatus={true}
                            />
                            <p className="text-xs text-text-muted italic">
                              Which monitors to search for this image
                            </p>
                          </div>
                          {/* Pattern-level similarity overrides */}
                          {(stateImage.patterns || []).some(
                            (p) => p.similarity !== undefined
                          ) && (
                            <div className="space-y-1 pt-2 border-t border-border-default">
                              <Label className="text-xs text-text-muted font-medium">
                                Pattern-Specific Overrides:
                              </Label>
                              {(stateImage.patterns || []).map(
                                (pattern, pIdx) => {
                                  if (pattern.similarity === undefined)
                                    return null;
                                  return (
                                    <div
                                      key={pattern.id}
                                      className="flex items-center justify-between text-xs"
                                    >
                                      <span className="text-text-muted">
                                        {pattern.name || `Pattern ${pIdx + 1}`}:
                                      </span>
                                      <div className="flex items-center gap-2">
                                        <span className="text-text-secondary">
                                          {(pattern.similarity * 100).toFixed(
                                            0
                                          )}
                                          %
                                        </span>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-5 w-5 p-0 text-text-muted hover:text-red-400"
                                          onClick={() => {
                                            const updatedPatterns = [
                                              ...(stateImage.patterns || []),
                                            ];
                                            const pattern =
                                              updatedPatterns[pIdx];
                                            if (pattern) {
                                              const {
                                                similarity: _similarity,
                                                ...rest
                                              } = pattern;
                                              updatedPatterns[pIdx] =
                                                rest as Pattern;
                                            }
                                            updateStateImage(index, {
                                              patterns: updatedPatterns,
                                            });
                                          }}
                                          title="Remove override (use StateImage or project default)"
                                        >
                                          ×
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                }
                              )}
                              <p className="text-xs text-text-muted italic mt-1">
                                Set in Pattern Options above
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </TabsContent>

      {/* Add Search Region Dialog */}
      {showAddSearchRegionDialog !== null && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowAddSearchRegionDialog(null)}
        >
          <div
            className="bg-surface-raised border border-border-default rounded-lg p-6 max-w-md w-full max-h-[80vh] overflow-y-auto scrollbar-dark"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-text-secondary mb-4">
              Add Search Region
            </h3>
            <p className="text-sm text-text-muted mb-4">
              Select a StateRegion from this state to add as a search region to
              this{" "}
              {showAddSearchRegionDialog.patternIndex !== undefined
                ? "pattern"
                : "StateImage"}
            </p>

            {state.regions && state.regions.length > 0 ? (
              <div className="space-y-2">
                {state.regions.map((region) => {
                  const stateImage =
                    state.stateImages?.[
                      showAddSearchRegionDialog.stateImageIndex
                    ];
                  const pattern =
                    showAddSearchRegionDialog.patternIndex !== undefined
                      ? stateImage?.patterns?.[
                          showAddSearchRegionDialog.patternIndex
                        ]
                      : undefined;
                  const alreadyAdded =
                    showAddSearchRegionDialog.patternIndex !== undefined
                      ? pattern?.searchRegions?.some(
                          (sr) => sr.id === region.id
                        )
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

                        if (
                          showAddSearchRegionDialog.patternIndex !== undefined
                        ) {
                          // Add to Pattern-level search regions
                          const updatedPatterns = [
                            ...(stateImage.patterns || []),
                          ];

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
                            updatedPatterns[
                              showAddSearchRegionDialog.patternIndex
                            ];
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
      )}
    </>
  );
}
