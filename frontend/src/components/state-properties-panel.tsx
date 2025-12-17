"use client";

import React, { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Map,
  MapPin,
  Type,
  Image as ImageIcon,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronRight,
  Link2,
  Target,
  Sparkles,
} from "lucide-react";
import { ImageSelector } from "@/components/image-selector";
import { ImageStatsDisplay } from "@/components/image-stats-display";
import {
  SpecialKeysSelector,
  SpecialKeyDisplay,
} from "@/components/special-keys-selector";
import { StateImageViewer } from "@/components/state-image-viewer";
import { MonitorSelector } from "@/components/monitor-selector";
import { useImages } from "@/hooks/automation";
import type {
  State,
  StateRegion,
  StateLocation,
  StateString,
  StateImage,
  Pattern,
  IncomingTransition,
  Transition,
} from "@/stores/automation";
import type { Workflow } from "@/lib/action-schema/action-types";
import { createFindAnyStateImageWorkflow } from "@/lib/workflow-helpers";

interface StatePropertiesPanelProps {
  state: State;
  allStates: State[];
  images: Array<{ id: string; name: string; url: string }>;
  incomingTransitions: IncomingTransition[];
  workflows: Workflow[];
  updateState: (updates: Partial<State>) => void;
  addTransition: (transition: Transition) => void;
  updateTransition: (transition: Transition) => void;
  deleteTransition: (transitionId: string) => void;
  addWorkflow: (workflow: Workflow) => void;
  addStateImage: () => void;
  updateStateImage: (index: number, updates: Partial<StateImage>) => void;
  removeStateImage: (index: number) => void;
  addRegion: () => void;
  updateRegion: (
    index: number,
    field: keyof StateRegion,
    value: string | number | number[]
  ) => void;
  removeRegion: (index: number) => void;
  addLocation: () => void;
  updateLocation: (
    index: number,
    field: keyof StateLocation,
    value: string | number | number[]
  ) => void;
  removeLocation: (index: number) => void;
  addString: () => void;
  updateString: (
    index: number,
    field: keyof StateString,
    value: string | boolean | number[]
  ) => void;
  removeString: (index: number) => void;
}

export function StatePropertiesPanel({
  state,
  allStates,
  images,
  incomingTransitions,
  workflows,
  updateState,
  addTransition,
  updateTransition,
  addWorkflow,
  addStateImage,
  updateStateImage,
  removeStateImage,
  removeRegion,
  removeLocation,
  addString,
  updateString,
  removeString,
  updateRegion,
  updateLocation,
  addRegion,
  addLocation,
  deleteTransition,
}: StatePropertiesPanelProps) {
  const { resolvePatternImage } = useImages();

  const stringTextAreaRefs = useRef<{
    [key: string]: HTMLTextAreaElement | null;
  }>({});
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
  const [expandedTransitionId, setExpandedTransitionId] = useState<
    string | null
  >(null);
  const [workflowCategoryFilters, setWorkflowCategoryFilters] = useState<{
    [key: string]: string;
  }>({});

  // Function to set a ref for a specific string's textarea
  const setStringTextAreaRef =
    (stringId: string) => (el: HTMLTextAreaElement | null) => {
      stringTextAreaRefs.current[stringId] = el;
    };

  // Track when a new StateImage is added to auto-open its first pattern's selector
  const prevStateId = useRef<string | null>(null);
  const prevStateImagesLength = useRef<number>(0);
  const prevPatternsCount = useRef<{ [key: string]: number }>({});

  useEffect(() => {
    // If the state ID changed, we&apos;re looking at a different state
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

  // Handler to create and add helper workflow for finding any state image
  const handleAddFindAnyImageHelper = async (
    transition: IncomingTransition
  ) => {
    try {
      // Generate the helper workflow
      const helperWorkflow = createFindAnyStateImageWorkflow(state);

      // Add helper workflow to global workflows database
      addWorkflow(helperWorkflow);

      // Check if this transition exists in the database
      const existingTransition = incomingTransitions.find(
        (t) => t.id === transition.id
      );

      // Add helper workflow ID to transition's workflows array
      const newWorkflows = [...(transition.workflows || []), helperWorkflow.id];

      if (existingTransition) {
        // Update existing transition
        updateTransition({ ...transition, workflows: newWorkflows });
      } else {
        // Create new transition with the helper workflow reference
        addTransition({ ...transition, workflows: newWorkflows });
      }
    } catch (error) {
      console.error("Failed to create helper workflow:", error);
    }
  };

  return (
    <Card className="border-gray-700 bg-[#27272A] h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <CardTitle className="text-sm font-medium text-[#00D9FF]">
          State Properties
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4 overflow-hidden px-6 pt-2 pb-6">
        <div className="space-y-2 flex-shrink-0">
          <Label className="text-xs text-gray-400">State Name</Label>
          <Input
            value={state.name}
            onChange={(e) => updateState({ name: e.target.value })}
            className="bg-transparent border-gray-700"
          />
        </div>

        <details className="group flex-shrink-0">
          <summary className="flex items-center justify-between cursor-pointer text-xs text-gray-300 hover:text-[#00D9FF] transition-colors list-none py-1 px-2 bg-gray-800/30 rounded">
            <span className="font-medium">Options</span>
            <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
          </summary>
          <div className="mt-2 space-y-3 pl-2 border-l-2 border-gray-700">
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Description</Label>
              <Textarea
                value={state.description}
                onChange={(e) => updateState({ description: e.target.value })}
                className="bg-transparent border-gray-700"
                rows={2}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="initial-state"
                checked={state.initial || false}
                onCheckedChange={(checked) =>
                  updateState({ initial: checked as boolean })
                }
                className="border-gray-600 data-[state=checked]:bg-[#00D9FF] data-[state=checked]:border-[#00D9FF]"
              />
              <Label
                htmlFor="initial-state"
                className="text-xs text-gray-400 cursor-pointer"
              >
                Initial State (Expected at start)
              </Label>
            </div>
          </div>
        </details>

        <Tabs
          defaultValue="images"
          className="flex-1 flex flex-col min-h-0 border border-gray-700 rounded-lg bg-[#1A1A1B] overflow-hidden"
        >
          <TabsList className="grid w-full grid-cols-5 h-10 bg-[#1A1A1B] border-b border-gray-700 p-1 rounded-none">
            <TabsTrigger
              value="images"
              className="text-xs flex items-center justify-center data-[state=active]:bg-[#00D9FF]/20 data-[state=active]:text-[#00D9FF] data-[state=active]:border data-[state=active]:border-[#00D9FF]/50 data-[state=inactive]:text-gray-400 transition-all"
            >
              <ImageIcon className="w-4 h-4" />
            </TabsTrigger>
            <TabsTrigger
              value="regions"
              className="text-xs flex items-center justify-center data-[state=active]:bg-[#BD00FF]/20 data-[state=active]:text-[#BD00FF] data-[state=active]:border data-[state=active]:border-[#BD00FF]/50 data-[state=inactive]:text-gray-400 transition-all"
            >
              <Map className="w-4 h-4" />
            </TabsTrigger>
            <TabsTrigger
              value="locations"
              className="text-xs flex items-center justify-center data-[state=active]:bg-[#00FF88]/20 data-[state=active]:text-[#00FF88] data-[state=active]:border data-[state=active]:border-[#00FF88]/50 data-[state=inactive]:text-gray-400 transition-all"
            >
              <MapPin className="w-4 h-4" />
            </TabsTrigger>
            <TabsTrigger
              value="strings"
              className="text-xs flex items-center justify-center data-[state=active]:bg-[#FFD700]/20 data-[state=active]:text-[#FFD700] data-[state=active]:border data-[state=active]:border-[#FFD700]/50 data-[state=inactive]:text-gray-400 transition-all"
            >
              <Type className="w-4 h-4" />
            </TabsTrigger>
            <TabsTrigger
              value="transitions"
              className="text-xs flex items-center justify-center data-[state=active]:bg-[#00FF88]/20 data-[state=active]:text-[#00FF88] data-[state=active]:border data-[state=active]:border-[#00FF88]/50 data-[state=inactive]:text-gray-400 transition-all"
            >
              <Target className="w-4 h-4" />
            </TabsTrigger>
          </TabsList>

          {/* Images Tab */}
          <TabsContent
            value="images"
            className="flex-1 flex flex-col min-h-0 p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-[#00D9FF]">StateImages</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={addStateImage}
                className="text-[#00D9FF] hover:text-[#00D9FF]/80"
              >
                <Plus className="w-3 h-3" />
              </Button>
            </div>

            {!state.stateImages || state.stateImages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center border border-dashed border-gray-600 rounded">
                <p className="text-sm text-gray-500">No images configured</p>
              </div>
            ) : (
              <div className="flex-1 space-y-2 overflow-y-auto pr-2">
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
                      className="p-2 bg-[#00D9FF]/10 border border-[#00D9FF]/30 rounded"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Input
                            value={stateImage.name}
                            onChange={(e) =>
                              updateStateImage(index, { name: e.target.value })
                            }
                            className="flex-1 h-6 bg-gray-900 border-gray-600 text-gray-200 text-xs px-2"
                            placeholder="StateImage name"
                          />
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
                          <span className="text-gray-400">
                            {(stateImage.patterns || []).length} pattern
                            {(stateImage.patterns || []).length !== 1
                              ? "s"
                              : ""}
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
                                <span className="text-gray-400">
                                  {totalSearchRegions} search region
                                  {totalSearchRegions > 1 ? "s" : ""}
                                </span>
                              )
                            );
                          })()}
                        </div>

                        {/* StateImage Options */}
                        {(stateImage.patterns || []).length > 1 && (
                          <div className="pt-2 border-t border-[#00D9FF]/20">
                            <details className="group">
                              <summary className="flex items-center justify-between cursor-pointer text-xs text-gray-300 hover:text-[#00D9FF] transition-colors list-none mb-2">
                                <span className="font-medium">
                                  RAG Find Options
                                </span>
                                <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                              </summary>
                              <div className="space-y-2 pl-2">
                                <div className="space-y-1">
                                  <Label className="text-xs text-gray-400">
                                    Multi-Pattern Search Mode
                                  </Label>
                                  <Select
                                    value={
                                      stateImage.ragMultiPatternMode ||
                                      "default"
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
                                    <SelectTrigger className="bg-transparent border-gray-700 h-7 text-xs">
                                      <SelectValue placeholder="Use project default" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#27272A] border-gray-700">
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
                                  <p className="text-xs text-gray-500">
                                    Default mode for RAG Find when this
                                    StateImage has multiple patterns. Can be
                                    overridden per action.
                                  </p>
                                </div>
                              </div>
                            </details>
                          </div>
                        )}

                        {/* Patterns List */}
                        <div className="pt-2 border-t border-[#00D9FF]/20">
                          <details className="group" open>
                            <summary className="flex items-center justify-between cursor-pointer text-xs text-gray-300 hover:text-[#00D9FF] transition-colors list-none mb-2">
                              <span className="font-medium">
                                Patterns ({(stateImage.patterns || []).length})
                              </span>
                              <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                            </summary>
                            <div className="space-y-2">
                              {(stateImage.patterns || []).map(
                                (pattern, pIdx) => (
                                  <div
                                    key={pattern.id}
                                    className="p-2 bg-gray-900/50 border border-gray-700 rounded space-y-1.5"
                                  >
                                    {/* Pattern header with image */}
                                    <div className="flex items-start gap-2">
                                      {/* Pattern image */}
                                      <div
                                        className="w-24 h-16 bg-gray-800 rounded overflow-hidden flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-[#00D9FF] transition-all"
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
                                                pattern.name ||
                                                `Pattern ${pIdx + 1}`
                                              }
                                              className="w-full h-full"
                                            />
                                          ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                              <ImageIcon className="w-4 h-4 text-gray-600" />
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
                                          className="h-6 bg-gray-800 border-gray-600 text-gray-200 text-xs px-2 mb-1"
                                          placeholder={`Pattern ${pIdx + 1}`}
                                        />
                                        <ImageStatsDisplay
                                          imageDataUrl={
                                            resolvePatternImage(pattern)?.url ||
                                            null
                                          }
                                        />
                                        {(pattern.searchRegions?.length || 0) >
                                          0 && (
                                          <div className="text-xs text-gray-500 mt-0.5">
                                            {pattern.searchRegions!.length}{" "}
                                            search region
                                            {pattern.searchRegions!.length > 1
                                              ? "s"
                                              : ""}
                                          </div>
                                        )}
                                      </div>

                                      {/* Delete pattern button */}
                                      {(stateImage.patterns || []).length >
                                        1 && (
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
                                          className="border-gray-600 data-[state=checked]:bg-[#00D9FF] data-[state=checked]:border-[#00D9FF]"
                                        />
                                        <Label
                                          htmlFor={`pattern-fixed-${pattern.id}`}
                                          className="text-xs text-gray-300 cursor-pointer"
                                        >
                                          Fixed Position
                                        </Label>
                                      </div>

                                      {/* Options - Collapsible section */}
                                      <details className="group">
                                        <summary className="flex items-center justify-between cursor-pointer text-xs text-gray-300 hover:text-[#00D9FF] transition-colors list-none py-1 px-2 bg-gray-800/30 rounded">
                                          <span className="font-medium">
                                            Options
                                          </span>
                                          <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
                                        </summary>
                                        <div className="mt-2 space-y-3 pl-2 border-l-2 border-gray-700">
                                          {/* Search Regions section */}
                                          <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                              <Label className="text-xs text-gray-300 font-medium">
                                                Search Regions (
                                                {
                                                  (pattern.searchRegions || [])
                                                    .length
                                                }
                                                )
                                              </Label>
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-5 px-2 text-xs text-[#BD00FF] hover:text-[#BD00FF]/80"
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
                                            {(pattern.searchRegions || [])
                                              .length > 0 ? (
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
                                                        className="flex items-center justify-between gap-2 py-1 px-2 bg-gray-900/50 border border-[#BD00FF]/30 rounded text-xs"
                                                      >
                                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                                          {hasLinkedPosition &&
                                                          linkedInfo ? (
                                                            <span className="text-gray-300 truncate flex items-center gap-1.5">
                                                              <Link2 className="w-3 h-3 flex-shrink-0" />
                                                              {
                                                                linkedInfo.stateName
                                                              }{" "}
                                                              →{" "}
                                                              {
                                                                linkedInfo.imageName
                                                              }
                                                            </span>
                                                          ) : (
                                                            <>
                                                              <span className="text-gray-400">
                                                                ↖
                                                              </span>
                                                              <span className="text-gray-300">
                                                                {sr.x},{sr.y}
                                                              </span>
                                                              <span className="text-gray-400">
                                                                ↔
                                                              </span>
                                                              <span className="text-gray-300">
                                                                {sr.width}
                                                              </span>
                                                              <span className="text-gray-400">
                                                                ↕
                                                              </span>
                                                              <span className="text-gray-300">
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
                                                            const updatedPatterns =
                                                              [
                                                                ...(stateImage.patterns ||
                                                                  []),
                                                              ];
                                                            const currentPattern =
                                                              updatedPatterns[
                                                                pIdx
                                                              ];
                                                            if (
                                                              currentPattern
                                                            ) {
                                                              updatedPatterns[
                                                                pIdx
                                                              ] = {
                                                                ...currentPattern,
                                                                searchRegions:
                                                                  currentPattern.searchRegions.filter(
                                                                    (_, idx) =>
                                                                      idx !==
                                                                      srIdx
                                                                  ),
                                                              };
                                                            }
                                                            updateStateImage(
                                                              index,
                                                              {
                                                                patterns:
                                                                  updatedPatterns,
                                                              }
                                                            );
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
                                              <div className="text-xs text-gray-500 italic py-2 px-2 bg-gray-900/30 rounded border border-dashed border-gray-700">
                                                No search regions defined. Add
                                                regions in Create Regions &
                                                Locations.
                                              </div>
                                            )}
                                          </div>

                                          {/* Similarity slider - optional */}
                                          <div className="space-y-1 pt-2 border-t border-gray-700">
                                            <div className="flex items-center justify-between">
                                              <Label className="text-xs text-gray-300">
                                                Pattern Similarity Override
                                              </Label>
                                              <div className="flex items-center gap-2">
                                                {pattern.similarity !==
                                                undefined ? (
                                                  <>
                                                    <span className="text-xs text-gray-400">
                                                      {(
                                                        pattern.similarity * 100
                                                      ).toFixed(0)}
                                                      %
                                                    </span>
                                                    <Button
                                                      variant="ghost"
                                                      size="sm"
                                                      className="h-4 w-4 p-0 text-gray-500 hover:text-red-400"
                                                      onClick={() => {
                                                        const updatedPatterns =
                                                          [
                                                            ...(stateImage.patterns ||
                                                              []),
                                                          ];
                                                        const pattern =
                                                          updatedPatterns[pIdx];
                                                        if (pattern) {
                                                          const {
                                                            similarity,
                                                            ...rest
                                                          } = pattern;
                                                          updatedPatterns[
                                                            pIdx
                                                          ] = rest as unknown;
                                                        }
                                                        updateStateImage(
                                                          index,
                                                          {
                                                            patterns:
                                                              updatedPatterns,
                                                          }
                                                        );
                                                      }}
                                                      title="Remove override"
                                                    >
                                                      ×
                                                    </Button>
                                                  </>
                                                ) : (
                                                  <span className="text-xs text-gray-500">
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
                                            {pattern.similarity !==
                                            undefined ? (
                                              <>
                                                <Slider
                                                  min={0}
                                                  max={100}
                                                  step={1}
                                                  value={[
                                                    pattern.similarity * 100,
                                                  ]}
                                                  onValueChange={(values) => {
                                                    const updatedPatterns = [
                                                      ...(stateImage.patterns ||
                                                        []),
                                                    ];
                                                    const currentPattern =
                                                      updatedPatterns[pIdx];
                                                    if (currentPattern) {
                                                      updatedPatterns[pIdx] = {
                                                        ...currentPattern,
                                                        similarity:
                                                          values[0]! / 100,
                                                      };
                                                      updateStateImage(index, {
                                                        patterns:
                                                          updatedPatterns,
                                                      });
                                                    }
                                                  }}
                                                  className="w-full"
                                                />
                                                <p className="text-xs text-gray-500 italic">
                                                  Minimum match confidence for
                                                  this pattern
                                                </p>
                                              </>
                                            ) : (
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                className="w-full h-6 text-xs text-[#00D9FF] hover:text-[#00D9FF]/80 hover:bg-[#00D9FF]/10"
                                                onClick={() => {
                                                  const updatedPatterns = [
                                                    ...(stateImage.patterns ||
                                                      []),
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
                                )
                              )}

                              {/* Add pattern button */}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full h-7 text-xs text-[#00D9FF] hover:text-[#00D9FF]/80 hover:bg-[#00D9FF]/10 border border-dashed border-[#00D9FF]/30"
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
                        <div className="pt-1.5 border-t border-[#00D9FF]/20">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full h-7 flex items-center justify-between text-xs text-gray-300 hover:text-[#00D9FF] hover:bg-[#00D9FF]/10 px-2"
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
                            <span className="font-medium">
                              Advanced Properties
                            </span>
                            {isAdvancedExpanded ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronRight className="w-3 h-3" />
                            )}
                          </Button>

                          {isAdvancedExpanded && (
                            <div className="space-y-2 mt-2 p-2 bg-gray-800/50 border border-gray-700 rounded">
                              {/* StateImage-level Search Regions */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <Label className="text-xs text-gray-300">
                                    StateImage Search Regions
                                  </Label>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 px-2 text-xs text-[#00D9FF] hover:text-[#00D9FF]/80"
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
                                    {stateImage.searchRegions!.map(
                                      (sr, srIdx) => {
                                        const hasLinkedPosition =
                                          !!sr.referenceImageId;
                                        const linkedInfo = hasLinkedPosition
                                          ? (() => {
                                              const refImageId =
                                                state.regions?.find(
                                                  (r) => r.id === sr.id
                                                )?.referenceImageId;
                                              const refImage = refImageId
                                                ? state.stateImages?.find(
                                                    (img) =>
                                                      img.id === refImageId
                                                  )
                                                : null;
                                              return refImage
                                                ? {
                                                    stateName: state.name,
                                                    imageName:
                                                      refImage.name ||
                                                      "Unnamed",
                                                  }
                                                : null;
                                            })()
                                          : null;

                                        return (
                                          <div
                                            key={sr.id}
                                            className="flex items-center justify-between p-1.5 bg-gray-900/50 rounded border border-gray-700"
                                          >
                                            <div className="flex-1 min-w-0">
                                              <div className="text-xs text-gray-300 truncate">
                                                {sr.name}
                                              </div>
                                              {hasLinkedPosition &&
                                              linkedInfo ? (
                                                <div className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
                                                  <Link2 className="w-3 h-3 flex-shrink-0" />
                                                  {linkedInfo.stateName} →{" "}
                                                  {linkedInfo.imageName}
                                                </div>
                                              ) : (
                                                <div className="text-xs text-gray-400 mt-1">
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
                                                ).filter(
                                                  (_, idx) => idx !== srIdx
                                                );
                                                updateStateImage(index, {
                                                  searchRegions:
                                                    updatedSearchRegions,
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
                                  <div className="text-xs text-gray-500 italic p-2 bg-gray-900/30 rounded">
                                    No search regions (searches whole screen)
                                  </div>
                                )}
                                <div className="text-xs text-gray-500 bg-gray-900/50 p-2 rounded border border-gray-700 mt-1">
                                  <div className="font-medium text-gray-400 mb-1">
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

                              {/* Search Mode (only show if 2+ patterns) */}
                              {(stateImage.patterns || []).length >= 2 && (
                                <div className="space-y-1 pb-2 border-b border-gray-700">
                                  <Label className="text-xs text-gray-300">
                                    Pattern Search Mode
                                  </Label>
                                  <Select
                                    value={stateImage.searchMode || "separate"}
                                    onValueChange={(
                                      value: "separate" | "combined"
                                    ) =>
                                      updateStateImage(index, {
                                        searchMode: value,
                                      })
                                    }
                                  >
                                    <SelectTrigger className="bg-gray-900 border-gray-600 text-xs h-8">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#27272A] border-gray-700">
                                      <SelectItem value="separate">
                                        Search patterns separately
                                      </SelectItem>
                                      <SelectItem value="combined">
                                        Search using combined vector
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <p className="text-xs text-gray-500 italic">
                                    {stateImage.searchMode === "combined"
                                      ? "RAG will search using a single combined embedding of all patterns"
                                      : "RAG will search for each pattern individually (default)"}
                                  </p>
                                </div>
                              )}

                              {/* StateImage-level Similarity Override (optional) */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <Label className="text-xs text-gray-300">
                                    StateImage Similarity Override
                                  </Label>
                                  <div className="flex items-center gap-2">
                                    {stateImage.probability !== undefined ? (
                                      <>
                                        <span className="text-xs text-gray-400">
                                          {(
                                            stateImage.probability * 100
                                          ).toFixed(0)}
                                          %
                                        </span>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-5 w-5 p-0 text-gray-500 hover:text-red-400"
                                          onClick={() => {
                                            const { probability, ...rest } =
                                              stateImage;
                                            updateStateImage(
                                              index,
                                              rest as any
                                            );
                                          }}
                                          title="Remove override (use project default)"
                                        >
                                          ×
                                        </Button>
                                      </>
                                    ) : (
                                      <span className="text-xs text-gray-500">
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
                                    <p className="text-xs text-gray-500 italic">
                                      Override for all patterns in this
                                      StateImage (pattern-specific overrides
                                      take precedence)
                                    </p>
                                  </>
                                )}
                                {stateImage.probability === undefined && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="w-full h-6 text-xs text-[#00D9FF] hover:text-[#00D9FF]/80 hover:bg-[#00D9FF]/10"
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
                              <div className="text-xs text-gray-500 bg-gray-900/50 p-2 rounded border border-gray-700">
                                <div className="font-medium text-gray-400 mb-1">
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
                              <div className="space-y-1 pt-2 border-t border-gray-700">
                                <MonitorSelector
                                  monitors={stateImage.monitors || [0]}
                                  onChange={(monitors) =>
                                    updateStateImage(index, { monitors })
                                  }
                                  label="Monitors for this StateImage"
                                  showLabel={true}
                                  showConnectionStatus={true}
                                />
                                <p className="text-xs text-gray-500 italic">
                                  Which monitors to search for this image
                                </p>
                              </div>
                              {/* Pattern-level similarity overrides */}
                              {(stateImage.patterns || []).some(
                                (p) => p.similarity !== undefined
                              ) && (
                                <div className="space-y-1 pt-2 border-t border-gray-700">
                                  <Label className="text-xs text-gray-400 font-medium">
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
                                          <span className="text-gray-400">
                                            {pattern.name ||
                                              `Pattern ${pIdx + 1}`}
                                            :
                                          </span>
                                          <div className="flex items-center gap-2">
                                            <span className="text-gray-300">
                                              {(
                                                pattern.similarity * 100
                                              ).toFixed(0)}
                                              %
                                            </span>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-5 w-5 p-0 text-gray-500 hover:text-red-400"
                                              onClick={() => {
                                                const updatedPatterns = [
                                                  ...(stateImage.patterns ||
                                                    []),
                                                ];
                                                const pattern =
                                                  updatedPatterns[pIdx];
                                                if (pattern) {
                                                  const {
                                                    similarity,
                                                    ...rest
                                                  } = pattern;
                                                  updatedPatterns[pIdx] =
                                                    rest as unknown;
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
                                  <p className="text-xs text-gray-500 italic mt-1">
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

          {/* Regions Tab */}
          <TabsContent
            value="regions"
            className="flex-1 flex flex-col min-h-0 p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-gray-400">State Regions</Label>
              <Info
                className="w-4 h-4 text-gray-500"
                aria-label="Regions are created in Create Regions & Locations tab"
              />
            </div>
            {state.regions?.length === 0 ? (
              <div className="flex-1 flex items-center justify-center border border-dashed border-gray-600 rounded">
                <p className="text-sm text-gray-500">
                  No regions defined. Use Create Regions & Locations tab.
                </p>
              </div>
            ) : (
              <div className="flex-1 space-y-2 overflow-y-auto pr-2">
                {state.regions?.map((region, index) => {
                  // Check if this region has a linked reference image
                  const hasLinkedPosition = !!region.referenceImageId;
                  let linkedInfo = null;

                  if (hasLinkedPosition) {
                    // Find the state and image that this region is linked to
                    const linkedState = allStates.find((s) =>
                      s.stateImages?.some(
                        (img) => img.id === region.referenceImageId
                      )
                    );
                    const linkedImage = linkedState?.stateImages?.find(
                      (img) => img.id === region.referenceImageId
                    );
                    linkedInfo = {
                      stateName: linkedState?.name || "Unknown State",
                      imageName: linkedImage?.name || "Unknown Image",
                    };
                  }

                  return (
                    <div
                      key={region.id}
                      className="space-y-2 p-3 bg-gray-800/50 border border-gray-700 rounded"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-gray-200">
                            {region.name}
                          </div>
                          {hasLinkedPosition && linkedInfo ? (
                            <div className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
                              <Link2 className="w-3 h-3 flex-shrink-0" />
                              {linkedInfo.stateName} → {linkedInfo.imageName}
                            </div>
                          ) : (
                            <div className="text-xs text-gray-400 mt-1">
                              ↖ {region.x},{region.y} ↔ {region.width} ↕{" "}
                              {region.height}
                            </div>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                          onClick={() => removeRegion(index)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                      <MonitorSelector
                        monitors={region.monitors || [0]}
                        onChange={(monitors) =>
                          updateRegion(index, "monitors", monitors)
                        }
                        label="Monitors"
                        showLabel={true}
                        showConnectionStatus={false}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Locations Tab */}
          <TabsContent
            value="locations"
            className="flex-1 flex flex-col min-h-0 p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-gray-400">State Locations</Label>
              <Info
                className="w-4 h-4 text-gray-500"
                aria-label="Locations are created in Create Regions & Locations tab"
              />
            </div>
            {state.locations?.length === 0 ? (
              <div className="flex-1 flex items-center justify-center border border-dashed border-gray-600 rounded">
                <p className="text-sm text-gray-500">
                  No locations defined. Use Create Regions & Locations tab.
                </p>
              </div>
            ) : (
              <div className="flex-1 space-y-2 overflow-y-auto pr-2">
                {state.locations?.map((location, index) => (
                  <div
                    key={location.id}
                    className="space-y-2 p-3 bg-[#00FF88]/10 border border-[#00FF88]/30 rounded"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-200">
                          {location.name}
                        </div>
                        {!location.referenceImageId && (
                          <div className="text-xs text-gray-400 mt-1">
                            <span>
                              ↖ {location.x},{location.y}
                            </span>
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                        onClick={() => removeLocation(index)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>

                    {/* Relative positioning details */}
                    {location.referenceImageId && (
                      <details className="text-xs text-gray-400 pl-2 border-l-2 border-[#00FF88]/30 mt-1">
                        <summary className="cursor-pointer hover:text-gray-300 list-none flex items-center gap-1">
                          <ImageIcon className="w-3 h-3" />
                          <span>Relative to image</span>
                        </summary>
                        <div className="mt-2 space-y-1">
                          <div>
                            Reference:{" "}
                            {(() => {
                              // First check if it&apos;s in the current state
                              const imageInCurrentState =
                                state.stateImages?.find(
                                  (img) => img.id === location.referenceImageId
                                );
                              if (imageInCurrentState)
                                return imageInCurrentState.name;

                              // Then check in the referenceStateId if it exists
                              if (location.referenceImageId) {
                                // First check current state
                                const imageInState = state.stateImages?.find(
                                  (img) => img.id === location.referenceImageId
                                );
                                if (imageInState) return imageInState.name;

                                // Then check all states
                                for (const s of allStates) {
                                  const img = s.stateImages?.find(
                                    (img) =>
                                      img.id === location.referenceImageId
                                  );
                                  if (img) return img.name;
                                }
                              }
                              return "Unknown";
                            })()}
                          </div>
                          {location.anchorType && (
                            <div>Position: {location.anchorType}</div>
                          )}
                          {(location.percentW !== undefined ||
                            location.percentH !== undefined) && (
                            <div>
                              Offset: {(location.percentW ?? 0) * 100}% W,{" "}
                              {(location.percentH ?? 0) * 100}% H
                            </div>
                          )}
                          {(location.offsetX !== undefined &&
                            location.offsetX !== 0) ||
                          (location.offsetY !== undefined &&
                            location.offsetY !== 0) ? (
                            <div>
                              Offsets: {location.offsetX || 0},{" "}
                              {location.offsetY || 0}
                            </div>
                          ) : null}
                        </div>
                      </details>
                    )}

                    {/* Anchor info */}
                    {location.anchor && (
                      <details className="text-xs text-gray-400 pl-2 border-l-2 border-[#00FF88]/50 mt-1">
                        <summary className="cursor-pointer hover:text-gray-300 list-none">
                          <span className="inline flex items-center gap-1 text-[#00FF88]">
                            ⚓ Anchor
                          </span>
                        </summary>
                        <div className="mt-2 space-y-1 text-gray-500">
                          <div>
                            Defines:{" "}
                            {location.anchorType
                              ?.replace(/_/g, " ")
                              .replace(/\b\w/g, (l) => l.toUpperCase()) ||
                              "Center"}
                          </div>
                        </div>
                      </details>
                    )}
                    <MonitorSelector
                      monitors={location.monitors || [0]}
                      onChange={(monitors) =>
                        updateLocation(index, "monitors", monitors)
                      }
                      label="Monitors"
                      showLabel={true}
                      showConnectionStatus={false}
                    />
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Strings Tab */}
          <TabsContent
            value="strings"
            className="flex-1 flex flex-col min-h-0 p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-gray-400">State Strings</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={addString}
                className="text-gray-400 hover:text-gray-300"
              >
                <Plus className="w-3 h-3" />
              </Button>
            </div>
            {state.strings?.length === 0 ? (
              <div className="flex-1 flex items-center justify-center border border-dashed border-gray-600 rounded">
                <p className="text-sm text-gray-500">No strings defined</p>
              </div>
            ) : (
              <div className="flex-1 space-y-2 overflow-y-auto pr-2">
                {state.strings?.map((string, index) => {
                  // Get active flags for badge display
                  const activeFlags = [
                    string.identifier && {
                      label: "Identifier",
                      color: "bg-blue-500/20 text-blue-400 border-blue-500/50",
                    },
                    string.inputText && {
                      label: "Input Text",
                      color:
                        "bg-green-500/20 text-green-400 border-green-500/50",
                    },
                    string.expectedText && {
                      label: "Expected",
                      color:
                        "bg-purple-500/20 text-purple-400 border-purple-500/50",
                    },
                    string.regexPattern && {
                      label: "Regex",
                      color:
                        "bg-orange-500/20 text-orange-400 border-orange-500/50",
                    },
                  ].filter(Boolean) as Array<{ label: string; color: string }>;

                  return (
                    <div
                      key={string.id}
                      className="space-y-2 p-2 bg-gray-800/50 border border-gray-700 rounded"
                    >
                      {/* Name and Delete */}
                      <div className="flex items-center gap-2">
                        <Input
                          value={string.name}
                          onChange={(e) =>
                            updateString(index, "name", e.target.value)
                          }
                          className="flex-1 h-7 bg-gray-900 border-gray-600 text-gray-200 text-xs"
                          placeholder="String name"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                          onClick={() => removeString(index)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>

                      {/* Active Flags Badges */}
                      {activeFlags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {activeFlags.map((flag) => (
                            <Badge
                              key={flag.label}
                              variant="outline"
                              className={`text-xs px-2 py-0.5 ${flag.color} border`}
                            >
                              {flag.label}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {/* Type Flags Checkboxes */}
                      <div className="space-y-1.5 pt-1 border-t border-gray-700">
                        <Label className="text-xs text-gray-400 font-semibold">
                          Type Flags
                        </Label>
                        <div className="grid grid-cols-2 gap-2">
                          {/* Identifier Checkbox */}
                          <div
                            className="flex items-center space-x-1.5"
                            title="Use for OCR verification - the string will be searched for in the image"
                          >
                            <Checkbox
                              id={`string-identifier-${string.id}`}
                              checked={string.identifier || false}
                              onCheckedChange={(checked) =>
                                updateString(
                                  index,
                                  "identifier",
                                  checked as boolean
                                )
                              }
                              className="border-gray-600 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                            />
                            <Label
                              htmlFor={`string-identifier-${string.id}`}
                              className="text-xs text-gray-300 cursor-pointer"
                            >
                              Identifier
                            </Label>
                            <Info className="w-3 h-3 text-gray-500" />
                          </div>

                          {/* Input Text Checkbox (DEFAULT) */}
                          <div
                            className="flex items-center space-x-1.5"
                            title="Text to be typed - will be typed into the active field"
                          >
                            <Checkbox
                              id={`string-inputtext-${string.id}`}
                              checked={
                                string.inputText !== undefined
                                  ? string.inputText
                                  : true
                              }
                              onCheckedChange={(checked) =>
                                updateString(
                                  index,
                                  "inputText",
                                  checked as boolean
                                )
                              }
                              className="border-gray-600 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500"
                            />
                            <Label
                              htmlFor={`string-inputtext-${string.id}`}
                              className="text-xs text-gray-300 cursor-pointer"
                            >
                              Input Text
                            </Label>
                            <Info className="w-3 h-3 text-gray-500" />
                          </div>

                          {/* Expected Text Checkbox */}
                          <div
                            className="flex items-center space-x-1.5"
                            title="Expected text for validation - used to verify expected content"
                          >
                            <Checkbox
                              id={`string-expected-${string.id}`}
                              checked={string.expectedText || false}
                              onCheckedChange={(checked) =>
                                updateString(
                                  index,
                                  "expectedText",
                                  checked as boolean
                                )
                              }
                              className="border-gray-600 data-[state=checked]:bg-purple-500 data-[state=checked]:border-purple-500"
                            />
                            <Label
                              htmlFor={`string-expected-${string.id}`}
                              className="text-xs text-gray-300 cursor-pointer"
                            >
                              Expected Text
                            </Label>
                            <Info className="w-3 h-3 text-gray-500" />
                          </div>

                          {/* Regex Pattern Checkbox */}
                          <div
                            className="flex items-center space-x-1.5"
                            title="Regex pattern - the value will be treated as a regular expression"
                          >
                            <Checkbox
                              id={`string-regex-${string.id}`}
                              checked={string.regexPattern || false}
                              onCheckedChange={(checked) =>
                                updateString(
                                  index,
                                  "regexPattern",
                                  checked as boolean
                                )
                              }
                              className="border-gray-600 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                            />
                            <Label
                              htmlFor={`string-regex-${string.id}`}
                              className="text-xs text-gray-300 cursor-pointer"
                            >
                              Regex Pattern
                            </Label>
                            <Info className="w-3 h-3 text-gray-500" />
                          </div>
                        </div>

                        {/* Regex Warning Message */}
                        {string.regexPattern && (
                          <div className="flex items-start gap-2 p-2 bg-orange-500/10 border border-orange-500/30 rounded mt-2">
                            <AlertTriangle className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
                            <div className="text-xs text-orange-300">
                              <div className="font-semibold mb-0.5">
                                Regex Mode Active
                              </div>
                              <div className="text-orange-400/80">
                                The value will be interpreted as a regular
                                expression pattern. Special characters like .,
                                *, +, ?, etc. have special meaning.
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* String Value */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-gray-400">Value</Label>
                          <SpecialKeysSelector
                            onInsertKey={(newText) =>
                              updateString(index, "value", newText)
                            }
                            textAreaRef={
                              stringTextAreaRefs.current[string.id]
                                ? {
                                    current:
                                      stringTextAreaRefs.current[string.id]!,
                                  }
                                : undefined
                            }
                          />
                        </div>
                        <Textarea
                          ref={setStringTextAreaRef(string.id)}
                          value={string.value}
                          onChange={(e) =>
                            updateString(index, "value", e.target.value)
                          }
                          className="w-full min-h-[60px] bg-gray-900 border-gray-600 text-gray-200 text-xs font-mono"
                          placeholder="String value"
                          rows={2}
                        />
                        {string.value && (
                          <div className="p-2 bg-gray-900/50 rounded-md border border-gray-700">
                            <div className="text-xs text-gray-500 mb-1">
                              Preview:
                            </div>
                            <div className="text-xs font-mono text-gray-300 break-all">
                              <SpecialKeyDisplay text={string.value} />
                            </div>
                          </div>
                        )}
                      </div>
                      <MonitorSelector
                        monitors={string.monitors || [0]}
                        onChange={(monitors) =>
                          updateString(index, "monitors", monitors)
                        }
                        label="Monitors"
                        showLabel={true}
                        showConnectionStatus={false}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Transitions Tab */}
          <TabsContent
            value="transitions"
            className="flex-1 flex flex-col min-h-0 p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-[#00FF88]">
                Incoming Transition
              </Label>
              <Badge className="bg-[#00FF88] text-black text-xs px-2">1</Badge>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto pr-2">
              {(() => {
                // Get or create the incoming transition for this state
                const transition = incomingTransitions[0] || {
                  id: `incoming-${state.id}`,
                  type: "IncomingTransition" as const,
                  toState: state.id,
                  workflows: [],
                  timeout: 10000,
                  retryCount: 3,
                };

                const isExpanded = expandedTransitionId === transition.id;
                const categoryFilter =
                  workflowCategoryFilters[transition.id] || "Incoming Transitions";
                const availableWorkflows = workflows.filter((w) => {
                  const category = w.category || "Main";
                  const matchesCategory =
                    categoryFilter === "All" || category === categoryFilter;
                  // Check if this workflow is already referenced in the transition
                  const alreadyAdded = transition.workflows?.includes(w.id);
                  return !alreadyAdded && matchesCategory;
                });

                return (
                  <div
                    key={transition.id}
                    className="p-3 bg-gray-800/50 border border-[#00FF88]/30 rounded space-y-2"
                  >
                    {/* Transition Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            setExpandedTransitionId(
                              isExpanded ? null : transition.id
                            )
                          }
                          className="hover:text-[#00FF88] transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-[#00FF88]" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-gray-400" />
                          )}
                        </button>
                        <span className="text-xs text-gray-400">
                          {(transition.workflows?.length || 0) === 0
                            ? "returns true"
                            : `${transition.workflows.length} workflow${transition.workflows.length !== 1 ? "s" : ""}`}
                        </span>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="space-y-3 pt-2 border-t border-gray-700">
                        {/* Workflows List */}
                        {transition.workflows &&
                          transition.workflows.length > 0 && (
                            <div className="space-y-1.5">
                              <Label className="text-xs text-gray-400">
                                Workflows (execute in order):
                              </Label>
                              <div className="space-y-1">
                                {transition.workflows.map((workflowId, idx) => {
                                  const workflow = workflows.find(
                                    (w) => w.id === workflowId
                                  );
                                  const workflowName =
                                    workflow?.name || "Unknown Workflow";
                                  const isHelper =
                                    workflowId.startsWith("wf-helper-");

                                  return (
                                    <div
                                      key={workflowId}
                                      className="flex items-center gap-2 text-xs text-gray-300 p-2 bg-gray-900/50 rounded"
                                    >
                                      <Badge className="bg-[#00D9FF] text-black text-xs px-1.5">
                                        {idx + 1}
                                      </Badge>
                                      <span className="flex-1">
                                        {workflowName}
                                      </span>

                                      {/* Helper badge for auto-generated workflows */}
                                      {isHelper ? (
                                        <Badge className="bg-[#00FF88]/20 text-[#00FF88] border-[#00FF88]/30 text-xs px-1.5">
                                          Helper
                                        </Badge>
                                      ) : (
                                        workflow?.category && (
                                          <Badge
                                            variant="outline"
                                            className="text-xs"
                                          >
                                            {workflow.category}
                                          </Badge>
                                        )
                                      )}

                                      {/* Delete Button */}
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-5 w-5 p-0 text-red-400 hover:text-red-300"
                                        onClick={() => {
                                          const newWorkflows =
                                            transition.workflows.filter(
                                              (_, i) => i !== idx
                                            );
                                          updateTransition({
                                            ...transition,
                                            workflows: newWorkflows,
                                          });
                                        }}
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </Button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                        {/* Quick Helper Button */}
                        <div className="space-y-2 pb-2 border-b border-gray-700">
                          <Label className="text-xs text-gray-400">
                            Quick Helper:
                          </Label>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full h-8 text-xs bg-[#00FF88]/10 border-[#00FF88]/30 text-[#00FF88] hover:bg-[#00FF88]/20 hover:text-[#00FF88] hover:border-[#00FF88]/50 transition-colors"
                            onClick={() =>
                              handleAddFindAnyImageHelper(transition)
                            }
                            disabled={
                              !state.stateImages ||
                              state.stateImages.length === 0
                            }
                          >
                            <Sparkles className="w-3 h-3 mr-2" />
                            Add "Find Any State Image"
                          </Button>
                          {(!state.stateImages ||
                            state.stateImages.length === 0) && (
                            <p className="text-xs text-gray-500 italic">
                              Add state images first to use this helper
                            </p>
                          )}
                        </div>

                        {/* Add Workflow */}
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-400">
                            Filter by Category:
                          </Label>
                          <Select
                            value={categoryFilter}
                            onValueChange={(value) => {
                              setWorkflowCategoryFilters((prev) => ({
                                ...prev,
                                [transition.id]: value,
                              }));
                            }}
                          >
                            <SelectTrigger className="bg-gray-900 border-gray-600 text-xs h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-[#27272A] border-gray-700">
                              <SelectItem value="All">
                                All Categories
                              </SelectItem>
                              <SelectItem value="Incoming Transitions">
                                Incoming Transitions
                              </SelectItem>
                              <SelectItem value="Outgoing Transitions">
                                Outgoing Transitions
                              </SelectItem>
                              <SelectItem value="Main">Main</SelectItem>
                              {Array.from(
                                new Set(
                                  workflows.map((w) => w.category || "Main")
                                )
                              )
                                .filter(
                                  (c) => c !== "Main" && c !== "Transitions" && c !== "Incoming Transitions" && c !== "Outgoing Transitions"
                                )
                                .map((category) => (
                                  <SelectItem key={category} value={category}>
                                    {category}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {availableWorkflows.length > 0 ? (
                          <div className="space-y-2">
                            <Label className="text-xs text-gray-400">
                              Add Workflow:
                            </Label>
                            <Select
                              value=""
                              onValueChange={(workflowId) => {
                                const newWorkflows = [
                                  ...(transition.workflows || []),
                                  workflowId,
                                ];
                                updateTransition({
                                  ...transition,
                                  workflows: newWorkflows,
                                });
                              }}
                            >
                              <SelectTrigger className="bg-gray-900 border-gray-600 text-xs h-8">
                                <SelectValue placeholder="Select workflow to add..." />
                              </SelectTrigger>
                              <SelectContent className="bg-[#27272A] border-gray-700">
                                {availableWorkflows.map((workflow) => (
                                  <SelectItem
                                    key={workflow.id}
                                    value={workflow.id}
                                    className="text-xs"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span>{workflow.name}</span>
                                      {workflow.category && (
                                        <Badge
                                          variant="outline"
                                          className="text-xs"
                                        >
                                          {workflow.category}
                                        </Badge>
                                      )}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500 text-center py-2">
                            {categoryFilter === "Incoming Transitions"
                              ? "No workflows in Incoming Transitions category. Use the Quick Helper or try 'All Categories'."
                              : "No available workflows in this category"}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>

      {/* Add Search Region Dialog */}
      {showAddSearchRegionDialog !== null && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowAddSearchRegionDialog(null)}
        >
          <div
            className="bg-[#27272A] border border-gray-700 rounded-lg p-6 max-w-md w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-200 mb-4">
              Add Search Region
            </h3>
            <p className="text-sm text-gray-400 mb-4">
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
                          ? "border-gray-700 bg-gray-800/30 text-gray-500 cursor-not-allowed"
                          : "border-gray-600 hover:border-[#BD00FF] hover:bg-gray-800/50 text-gray-200"
                      }`}
                    >
                      <div className="font-medium">{region.name}</div>
                      <div className="text-xs text-gray-400 mt-1">
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
                        <div className="text-xs text-gray-500 mt-1">
                          Already added
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-gray-500 text-center py-8">
                No StateRegions available in this state. Create regions in the
                Create Regions & Locations tab.
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <Button
                variant="ghost"
                onClick={() => setShowAddSearchRegionDialog(null)}
                className="text-gray-400 hover:text-gray-200"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
