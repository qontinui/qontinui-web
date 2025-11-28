/**
 * StateMetadataPanel Component
 *
 * Right sidebar panel showing detailed metadata about the selected state.
 *
 * Features:
 * - State name and ID
 * - Element counts and list
 * - Transition counts (incoming/outgoing)
 * - Element highlighting on hover
 * - Position display toggle
 * - Element details with coordinates
 */

import React, { useState } from "react";
import type { State } from "@/contexts/automation-context/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Eye,
  MapPin,
  Image as ImageIcon,
  Square,
  ArrowRight,
  ArrowLeft,
  Info,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

export interface StateMetadataPanelProps {
  state: State | null;
  transitionCounts: { incoming: number; outgoing: number };
  showPositions: boolean;
  onTogglePositions: () => void;
  highlightElementId?: string;
  onHighlightElement: (elementId: string | undefined) => void;
}

export function StateMetadataPanel({
  state,
  transitionCounts,
  showPositions,
  onTogglePositions,
  highlightElementId,
  onHighlightElement,
}: StateMetadataPanelProps) {
  const [expandedSections, setExpandedSections] = useState({
    images: true,
    regions: true,
    locations: true,
  });

  if (!state) {
    return (
      <Card className="flex flex-col h-full">
        <CardHeader>
          <CardTitle>State Details</CardTitle>
          <CardDescription>Select a state to view details</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <Info className="mx-auto h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">No state selected</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const imageCount =
    state.stateImages?.filter((img) =>
      img.patterns?.some(
        (p) => p.fixed && p.offsetX !== undefined && p.offsetY !== undefined
      )
    ).length || 0;
  const regionCount = state.regions?.length || 0;
  const locationCount = state.locations?.length || 0;
  const totalElements = imageCount + regionCount + locationCount;

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">State Details</CardTitle>
        <CardDescription className="break-words">{state.name}</CardDescription>

        {/* Toggle position display */}
        <div className="pt-2">
          <Button
            size="sm"
            variant={showPositions ? "default" : "outline"}
            onClick={onTogglePositions}
            className="w-full"
          >
            <MapPin className="h-4 w-4 mr-2" />
            {showPositions ? "Hide" : "Show"} Positions
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 flex flex-col gap-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-2">
          <div className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Elements</div>
            <div className="text-2xl font-bold">{totalElements}</div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">
              Transitions
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="flex items-center gap-1">
                <ArrowLeft className="h-3 w-3 text-green-500" />
                {transitionCounts.incoming}
              </span>
              <span className="flex items-center gap-1">
                <ArrowRight className="h-3 w-3 text-blue-500" />
                {transitionCounts.outgoing}
              </span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Element Lists */}
        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-3">
            {/* StateImages */}
            {imageCount > 0 && (
              <Collapsible
                open={expandedSections.images}
                onOpenChange={() => toggleSection("images")}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="w-full justify-between p-2 h-auto font-semibold"
                  >
                    <span className="flex items-center gap-2">
                      <ImageIcon className="h-4 w-4 text-blue-500" />
                      State Images
                      <Badge variant="outline">{imageCount}</Badge>
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${
                        expandedSections.images ? "transform rotate-180" : ""
                      }`}
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 mt-2">
                  {state.stateImages
                    ?.filter((img) =>
                      img.patterns?.some(
                        (p) =>
                          p.fixed &&
                          p.offsetX !== undefined &&
                          p.offsetY !== undefined
                      )
                    )
                    .map((img) => {
                      const pattern = img.patterns?.find(
                        (p) =>
                          p.fixed &&
                          p.offsetX !== undefined &&
                          p.offsetY !== undefined
                      );
                      if (!pattern) return null;

                      const isHighlighted = highlightElementId === img.id;

                      return (
                        <div
                          key={img.id}
                          className={`
                            border rounded-lg p-2 cursor-pointer transition-colors text-sm
                            ${
                              isHighlighted
                                ? "bg-primary/10 border-primary"
                                : "hover:bg-muted/50"
                            }
                          `}
                          onMouseEnter={() => onHighlightElement(img.id)}
                          onMouseLeave={() => onHighlightElement(undefined)}
                        >
                          <div className="font-medium truncate">{img.name}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            Position: ({pattern.offsetX}, {pattern.offsetY})
                          </div>
                          {img.shared && (
                            <Badge variant="secondary" className="mt-1 text-xs">
                              Shared
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Regions */}
            {regionCount > 0 && (
              <Collapsible
                open={expandedSections.regions}
                onOpenChange={() => toggleSection("regions")}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="w-full justify-between p-2 h-auto font-semibold"
                  >
                    <span className="flex items-center gap-2">
                      <Square className="h-4 w-4 text-green-500" />
                      Regions
                      <Badge variant="outline">{regionCount}</Badge>
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${
                        expandedSections.regions ? "transform rotate-180" : ""
                      }`}
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 mt-2">
                  {state.regions?.map((region) => {
                    const isHighlighted = highlightElementId === region.id;

                    return (
                      <div
                        key={region.id}
                        className={`
                          border rounded-lg p-2 cursor-pointer transition-colors text-sm
                          ${
                            isHighlighted
                              ? "bg-primary/10 border-primary"
                              : "hover:bg-muted/50"
                          }
                        `}
                        onMouseEnter={() => onHighlightElement(region.id)}
                        onMouseLeave={() => onHighlightElement(undefined)}
                      >
                        <div className="font-medium truncate">
                          {region.name}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Position: ({region.x}, {region.y})
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Size: {region.width} × {region.height}
                        </div>
                        {region.isSearchRegion && (
                          <Badge variant="secondary" className="mt-1 text-xs">
                            Search Region
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Locations */}
            {locationCount > 0 && (
              <Collapsible
                open={expandedSections.locations}
                onOpenChange={() => toggleSection("locations")}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="w-full justify-between p-2 h-auto font-semibold"
                  >
                    <span className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-orange-500" />
                      Locations
                      <Badge variant="outline">{locationCount}</Badge>
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${
                        expandedSections.locations ? "transform rotate-180" : ""
                      }`}
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 mt-2">
                  {state.locations?.map((location) => {
                    const isHighlighted = highlightElementId === location.id;

                    return (
                      <div
                        key={location.id}
                        className={`
                          border rounded-lg p-2 cursor-pointer transition-colors text-sm
                          ${
                            isHighlighted
                              ? "bg-primary/10 border-primary"
                              : "hover:bg-muted/50"
                          }
                        `}
                        onMouseEnter={() => onHighlightElement(location.id)}
                        onMouseLeave={() => onHighlightElement(undefined)}
                      >
                        <div className="font-medium truncate">
                          {location.name}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Position: ({location.x}, {location.y})
                        </div>
                        <div className="flex gap-1 mt-1">
                          {location.fixed && (
                            <Badge variant="secondary" className="text-xs">
                              Fixed
                            </Badge>
                          )}
                          {location.anchor && (
                            <Badge variant="secondary" className="text-xs">
                              Anchor
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* No elements message */}
            {totalElements === 0 && (
              <div className="text-center text-muted-foreground py-8">
                <Eye className="mx-auto h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">No positioned elements</p>
                <p className="text-xs mt-1">
                  Add StateImages, regions, or locations to visualize this state
                </p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* State Info */}
        {state.description && (
          <>
            <Separator />
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">
                Description
              </div>
              <div className="text-sm text-muted-foreground">
                {state.description}
              </div>
            </div>
          </>
        )}

        <div className="text-xs text-muted-foreground">
          <span className="font-semibold">ID:</span>{" "}
          <span className="font-mono">{state.id}</span>
        </div>
      </CardContent>
    </Card>
  );
}
