"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Plus, Trash2, Info, ChevronRight, ArrowRightLeft } from "lucide-react";
import type { State, StateImage, Pattern } from "@/stores/automation";
import { PatternItem } from "./PatternItem";
import { AdvancedSettingsSection } from "./AdvancedSettingsSection";

export interface StateImageCardProps {
  stateImage: StateImage;
  index: number;
  state: State;
  allStates: State[];
  images: Array<{ id: string; name: string; url: string }>;
  isAdvancedExpanded: boolean;
  openImageSelectorId: string | null;
  setOpenImageSelectorId: (id: string | null) => void;
  setExpandedAdvancedSections: React.Dispatch<
    React.SetStateAction<Set<string>>
  >;
  setShowAddSearchRegionDialog: (
    value: { stateImageIndex: number; patternIndex?: number } | null
  ) => void;
  updateStateImage: (index: number, updates: Partial<StateImage>) => void;
  removeStateImage: (index: number) => void;
  moveStateImage: (stateImageIndex: number, targetStateId: string) => void;
  resolvePatternImage: (
    pattern: Pattern
  ) => { url: string; mask?: string } | null;
}

export function StateImageCard({
  stateImage,
  index,
  state,
  allStates,
  images,
  isAdvancedExpanded,
  openImageSelectorId,
  setOpenImageSelectorId,
  setExpandedAdvancedSections,
  setShowAddSearchRegionDialog,
  updateStateImage,
  removeStateImage,
  moveStateImage,
  resolvePatternImage,
}: StateImageCardProps) {
  // Auto-detect if any pattern in this StateImage is shared (appears in other states)
  const currentPatternImages = (stateImage.patterns || [])
    .map((p) => p.imageId)
    .filter((img) => img && img !== "");

  const otherStatesWithThesePatterns = allStates.filter(
    (s) =>
      s.id !== state.id &&
      s.stateImages?.some((img) =>
        img.patterns?.some(
          (p) => currentPatternImages.includes(p.imageId) && p.imageId !== ""
        )
      )
  );
  const isShared = otherStatesWithThesePatterns.length > 0;

  return (
    <div className="rounded-lg overflow-hidden border-l-4 border-l-brand-primary bg-brand-primary/[0.03]">
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
            onChange={(e) => updateStateImage(index, { name: e.target.value })}
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
                {allStates.filter((s) => s.id !== state.id).length === 0 && (
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
            const totalSearchRegions = (stateImage.patterns || []).reduce(
              (sum, pattern) => sum + (pattern.searchRegions?.length || 0),
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
                <span className="font-medium">RAG Find Options</span>
                <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
              </summary>
              <div className="space-y-2 pl-2">
                <div className="space-y-1">
                  <Label className="text-xs text-text-muted">
                    Multi-Pattern Search Mode
                  </Label>
                  <Select
                    value={stateImage.ragMultiPatternMode || "default"}
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
                      <SelectItem value="all">Search All Patterns</SelectItem>
                      <SelectItem value="combined">
                        Search Combined Vector
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-text-muted">
                    Default mode for RAG Find when this StateImage has multiple
                    patterns. Can be overridden per action.
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
                <PatternItem
                  key={pattern.id}
                  pattern={pattern}
                  patternIndex={pIdx}
                  stateImage={stateImage}
                  stateImageIndex={index}
                  allStates={allStates}
                  openImageSelectorId={openImageSelectorId}
                  setOpenImageSelectorId={setOpenImageSelectorId}
                  setShowAddSearchRegionDialog={setShowAddSearchRegionDialog}
                  images={images}
                  updateStateImage={updateStateImage}
                  resolvePatternImage={resolvePatternImage}
                />
              ))}

              {/* Add pattern button */}
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs text-brand-primary hover:text-brand-primary/80 hover:bg-brand-primary/10 border border-dashed border-brand-primary/30"
                onClick={() => {
                  const newPattern = {
                    id: `pattern_${Date.now()}`,
                    imageId: undefined,
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
        <AdvancedSettingsSection
          stateImage={stateImage}
          stateImageIndex={index}
          state={state}
          isAdvancedExpanded={isAdvancedExpanded}
          setExpandedAdvancedSections={setExpandedAdvancedSections}
          setShowAddSearchRegionDialog={setShowAddSearchRegionDialog}
          updateStateImage={updateStateImage}
        />
      </div>
    </div>
  );
}
