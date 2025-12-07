"use client";

/**
 * Project Overview Page
 *
 * Visualize states by showing their StateImages positioned at their fixed locations
 * on a 1920x1080 canvas. Allows selecting individual states to view.
 */

import { useState, useMemo, Suspense } from "react";
import { useAutomation } from "@/contexts/automation-context";
import { ActiveStatesCanvas } from "@/components/workflow-viz/ActiveStatesCanvas";
import { RequireProject } from "@/components/require-project";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  Layers,
  Eye,
  EyeOff,
  CheckSquare,
  Square,
} from "lucide-react";

export default function OverviewPage() {
  const { states } = useAutomation();
  const [selectedStateIds, setSelectedStateIds] = useState<string[]>([]);
  const [highlightedStateId, setHighlightedStateId] = useState<
    string | undefined
  >();

  // Filter to states that have visible elements (StateImages with fixed positions)
  const statesWithElements = useMemo(() => {
    return states.filter((state) => {
      const hasFixedImages = state.stateImages?.some((img) =>
        img.patterns?.some(
          (p) => p.fixed && p.offsetX !== undefined && p.offsetY !== undefined
        )
      );
      const hasRegions = (state.regions?.length ?? 0) > 0;
      const hasLocations = (state.locations?.length ?? 0) > 0;
      return hasFixedImages || hasRegions || hasLocations;
    });
  }, [states]);

  // Get selected states
  const selectedStates = useMemo(() => {
    return states.filter((s) => selectedStateIds.includes(s.id));
  }, [states, selectedStateIds]);

  // Toggle state selection
  const toggleState = (stateId: string) => {
    setSelectedStateIds((prev) =>
      prev.includes(stateId)
        ? prev.filter((id) => id !== stateId)
        : [...prev, stateId]
    );
  };

  // Select all states with elements
  const selectAll = () => {
    setSelectedStateIds(statesWithElements.map((s) => s.id));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedStateIds([]);
    setHighlightedStateId(undefined);
  };

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-[#00D9FF]" />
        </div>
      }
    >
      <RequireProject pageName="Project Overview">
        <div className="container mx-auto py-8 h-[calc(100vh-4rem)] flex flex-col">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
              <Layers className="h-8 w-8" />
              Project Overview
            </h1>
            <p className="text-muted-foreground">
              Visualize states with their elements positioned at fixed screen
              locations
            </p>
          </div>

          {/* Main Content */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-0">
            {/* Left Panel - State Selection */}
            <Card className="lg:col-span-1 flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between">
                  <span>States</span>
                  <Badge variant="outline">{statesWithElements.length}</Badge>
                </CardTitle>
                <CardDescription>
                  Select states to display on canvas
                </CardDescription>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={selectAll}>
                    <CheckSquare className="h-4 w-4 mr-1" />
                    All
                  </Button>
                  <Button size="sm" variant="outline" onClick={clearSelection}>
                    <Square className="h-4 w-4 mr-1" />
                    None
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex-1 min-h-0">
                <ScrollArea className="h-full">
                  {statesWithElements.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">
                      <Layers className="mx-auto h-8 w-8 mb-2 opacity-50" />
                      <p className="text-sm">
                        No states with positioned elements
                      </p>
                      <p className="text-xs mt-1">
                        Add fixed positions to StateImages
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {statesWithElements.map((state) => {
                        const isSelected = selectedStateIds.includes(state.id);
                        const isHighlighted = highlightedStateId === state.id;
                        const imageCount =
                          state.stateImages?.filter((img) =>
                            img.patterns?.some((p) => p.fixed)
                          ).length ?? 0;
                        const regionCount = state.regions?.length ?? 0;
                        const locationCount = state.locations?.length ?? 0;

                        return (
                          <div
                            key={state.id}
                            className={`
                              flex items-center gap-3 p-3 rounded-lg border cursor-pointer
                              transition-colors
                              ${isSelected ? "bg-primary/10 border-primary" : "hover:bg-muted/50"}
                              ${isHighlighted ? "ring-2 ring-primary" : ""}
                            `}
                            onClick={() => toggleState(state.id)}
                            onMouseEnter={() =>
                              isSelected && setHighlightedStateId(state.id)
                            }
                            onMouseLeave={() =>
                              setHighlightedStateId(undefined)
                            }
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleState(state.id)}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">
                                {state.name}
                              </div>
                              <div className="text-xs text-muted-foreground flex gap-2">
                                {imageCount > 0 && (
                                  <span>{imageCount} img</span>
                                )}
                                {regionCount > 0 && (
                                  <span>{regionCount} rgn</span>
                                )}
                                {locationCount > 0 && (
                                  <span>{locationCount} loc</span>
                                )}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isSelected) {
                                  setHighlightedStateId(
                                    highlightedStateId === state.id
                                      ? undefined
                                      : state.id
                                  );
                                }
                              }}
                              disabled={!isSelected}
                            >
                              {isHighlighted ? (
                                <Eye className="h-4 w-4" />
                              ) : (
                                <EyeOff className="h-4 w-4 opacity-50" />
                              )}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Right Panel - Canvas */}
            <Card className="lg:col-span-3 flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between">
                  <span>Canvas View</span>
                  <Badge variant="outline">
                    {selectedStates.length} selected
                  </Badge>
                </CardTitle>
                <CardDescription>
                  1920x1080 canvas showing state elements at their fixed
                  positions
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 min-h-0">
                <ActiveStatesCanvas
                  states={selectedStates}
                  highlightStateId={highlightedStateId}
                  className="h-full"
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </RequireProject>
    </Suspense>
  );
}
