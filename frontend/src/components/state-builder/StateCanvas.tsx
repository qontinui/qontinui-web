"use client";

import React from "react";
import { Plus, ImageIcon, ZoomIn, ZoomOut, Grid, Layout } from "lucide-react";
import type { State, Pattern } from "@/contexts/automation-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface StateCanvasProps {
  currentState: State | null;
  canvasZoom: number;
  canvasPan: { x: number; y: number };
  setCanvasZoom: React.Dispatch<React.SetStateAction<number>>;
  setCanvasPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  selectedImageIndex: number | null;
  setSelectedImageIndex: (idx: number | null) => void;
  resolvePatternImage: (
    pattern: Pattern
  ) => { url: string; mask?: string } | null;
  handleAddStateImage: () => void;
}

export function StateCanvas({
  currentState,
  canvasZoom,
  canvasPan,
  setCanvasZoom,
  setCanvasPan,
  selectedImageIndex,
  setSelectedImageIndex,
  resolvePatternImage,
  handleAddStateImage,
}: StateCanvasProps) {
  if (!currentState) {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent className="text-center text-muted-foreground">
          <Layout className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Select a state to view and edit</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{currentState.name}</CardTitle>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCanvasZoom((z) => Math.min(z + 0.1, 2))}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCanvasZoom((z) => Math.max(z - 0.1, 0.5))}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCanvasZoom(1);
                setCanvasPan({ x: 0, y: 0 });
              }}
            >
              <Grid className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto">
        <div
          style={{
            transform: `scale(${canvasZoom}) translate(${canvasPan.x}px, ${canvasPan.y}px)`,
            transformOrigin: "top left",
          }}
        >
          {/* StateImages Grid */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <Label className="text-xs font-semibold">StateImages</Label>
              <Button size="sm" variant="outline" onClick={handleAddStateImage}>
                <Plus className="h-3 w-3 mr-1" />
                Add Image
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {currentState.stateImages?.slice(0, 6).map((stateImage, idx) => {
                const firstPattern = stateImage.patterns?.[0];
                const imageData = firstPattern
                  ? resolvePatternImage(firstPattern)
                  : null;

                return (
                  <div
                    key={stateImage.id}
                    className={cn(
                      "relative border rounded p-2 cursor-pointer transition-colors",
                      selectedImageIndex === idx
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    )}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedImageIndex(idx)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedImageIndex(idx);
                      }
                    }}
                  >
                    {imageData ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageData.url}
                        alt={stateImage.name}
                        className="w-full h-24 object-cover rounded"
                      />
                    ) : (
                      <div className="w-full h-24 flex items-center justify-center bg-muted rounded">
                        <ImageIcon className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                    <p className="text-xs mt-1 truncate">{stateImage.name}</p>
                    <Badge
                      variant="secondary"
                      className="absolute top-1 right-1 text-xs"
                    >
                      {stateImage.patterns?.length || 0}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Regions Preview */}
          {currentState.regions && currentState.regions.length > 0 && (
            <div className="mb-6">
              <Label className="text-xs font-semibold mb-3 block">
                Regions
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {currentState.regions.map((region) => (
                  <div
                    key={region.id}
                    className="border rounded p-2 text-xs space-y-1"
                  >
                    <div className="font-medium">{region.name}</div>
                    <div className="text-muted-foreground">
                      {region.width} x {region.height}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Locations Preview */}
          {currentState.locations && currentState.locations.length > 0 && (
            <div>
              <Label className="text-xs font-semibold mb-3 block">
                Locations
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {currentState.locations.map((location) => (
                  <div
                    key={location.id}
                    className="border rounded p-2 text-xs space-y-1"
                  >
                    <div className="font-medium">{location.name}</div>
                    <div className="text-muted-foreground">
                      ({location.x}, {location.y})
                      {location.anchor && " - Anchor"}
                      {location.fixed && " - Fixed"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
