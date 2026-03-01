"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Link2,
  Accessibility,
} from "lucide-react";
import { MonitorSelector } from "@/components/monitor-selector";
import type { State, StateImage, Pattern } from "@/stores/automation";

export interface AdvancedSettingsSectionProps {
  stateImage: StateImage;
  stateImageIndex: number;
  state: State;
  isAdvancedExpanded: boolean;
  setExpandedAdvancedSections: React.Dispatch<
    React.SetStateAction<Set<string>>
  >;
  setShowAddSearchRegionDialog: (
    value: { stateImageIndex: number; patternIndex?: number } | null
  ) => void;
  updateStateImage: (index: number, updates: Partial<StateImage>) => void;
}

export function AdvancedSettingsSection({
  stateImage,
  stateImageIndex: index,
  state,
  isAdvancedExpanded,
  setExpandedAdvancedSections,
  setShowAddSearchRegionDialog,
  updateStateImage,
}: AdvancedSettingsSectionProps) {
  return (
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
                  const hasLinkedPosition = !!sr.referenceImageId;
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
                              imageName: refImage.name || "Unnamed",
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
                            {linkedInfo.stateName} → {linkedInfo.imageName}
                          </div>
                        ) : (
                          <div className="text-xs text-text-muted mt-1">
                            ↖ {sr.x},{sr.y} ↔ {sr.width} ↕ {sr.height}
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
            <Label className="text-xs text-text-secondary">Search Mode</Label>
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
                <SelectItem value="default">Default (Image Pattern)</SelectItem>
                <SelectItem value="rag">RAG (Vector Search)</SelectItem>
                <SelectItem value="template">Template Matching</SelectItem>
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
                    value={stateImage.accessibilitySelector?.ref || ""}
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
                      Array.isArray(stateImage.accessibilitySelector?.role)
                        ? stateImage.accessibilitySelector.role.join(", ")
                        : stateImage.accessibilitySelector?.role || ""
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
                    value={stateImage.accessibilitySelector?.name || ""}
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
                    value={stateImage.accessibilitySelector?.nameContains || ""}
                    onChange={(e) =>
                      updateStateImage(index, {
                        accessibilitySelector: {
                          ...stateImage.accessibilitySelector,
                          nameContains: e.target.value || undefined,
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
                    value={stateImage.accessibilitySelector?.automationId || ""}
                    onChange={(e) =>
                      updateStateImage(index, {
                        accessibilitySelector: {
                          ...stateImage.accessibilitySelector,
                          automationId: e.target.value || undefined,
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
                      {(stateImage.probability * 100).toFixed(0)}%
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-text-muted hover:text-red-400"
                      onClick={() => {
                        const { probability: _probability, ...rest } =
                          stateImage;
                        updateStateImage(
                          index,
                          rest as Omit<typeof stateImage, "probability">
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
                  value={[(stateImage.probability ?? 0.85) * 100]}
                  onValueChange={(values) => {
                    updateStateImage(index, {
                      probability: values[0]! / 100,
                    });
                  }}
                  className="w-full"
                />
                <p className="text-xs text-text-muted italic">
                  Override for all patterns in this StateImage (pattern-specific
                  overrides take precedence)
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
              onChange={(monitors) => updateStateImage(index, { monitors })}
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
              {(stateImage.patterns || []).map((pattern, pIdx) => {
                if (pattern.similarity === undefined) return null;
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
                        {(pattern.similarity * 100).toFixed(0)}%
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 text-text-muted hover:text-red-400"
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
                        title="Remove override (use StateImage or project default)"
                      >
                        ×
                      </Button>
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-text-muted italic mt-1">
                Set in Pattern Options above
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
