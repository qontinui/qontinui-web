"use client";

import {
  Handle,
  Position,
  type NodeProps,
  type Node as ReactFlowNode,
} from "@xyflow/react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImageIcon, Play, MapPin, Square, Type } from "lucide-react";
import { StateImageViewer } from "@/components/state-image-viewer";
import { useImages, type Pattern } from "@/hooks/automation";

interface ImageAsset {
  id: string;
  name: string;
  url: string;
  size: number;
  uploadedAt: Date;
  usageCount: number;
}

interface StateImage {
  id: string;
  name: string;
  patterns: Pattern[];
  shared: boolean;
}

interface StateRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StateLocation {
  id: string;
  name: string;
  x: number;
  y: number;
}

interface StateString {
  id: string;
  name: string;
  value: string;
}

interface IncomingTransition {
  id: string;
  type: "IncomingTransition";
  toState: string;
  workflows: string[];
}

interface StateNodeData extends Record<string, unknown> {
  state: {
    id: string;
    name: string;
    description: string;
    initial?: boolean;
    stateImages: StateImage[];
    regions?: StateRegion[];
    locations?: StateLocation[];
    strings?: StateString[];
  };
  images?: ImageAsset[];
  hasIncomingTransitions?: boolean;
  incomingTransitions?: IncomingTransition[];
  hasOutgoingTransitions?: boolean;
  onAddOutgoingTransition?: (stateId: string) => void;
  onStartImageDrag?: (stateId: string, stateImageId: string) => void;
  isSelected: boolean;
  onSelect: (id: string, selected: boolean) => void;
}

// Size tiers for roughly square cards based on image count
// Each tier: { cardWidth, gridCols, gridMaxWidth, maxImages }
// Grid columns increased by 1 to account for text width
const SIZE_TIERS = {
  small: { cardWidth: 200, gridCols: 3, gridMaxWidth: 152, maxImages: 6 },
  medium: { cardWidth: 260, gridCols: 4, gridMaxWidth: 204, maxImages: 8 },
  large: { cardWidth: 320, gridCols: 5, gridMaxWidth: 256, maxImages: 15 },
  xlarge: { cardWidth: 380, gridCols: 6, gridMaxWidth: 308, maxImages: 18 },
};

function getCardSize(imageCount: number) {
  if (imageCount <= 2) return SIZE_TIERS.small;
  if (imageCount <= 6) return SIZE_TIERS.medium;
  if (imageCount <= 12) return SIZE_TIERS.large;
  return SIZE_TIERS.xlarge;
}

export function StateNode({
  data,
  selected,
}: NodeProps<ReactFlowNode<StateNodeData>>) {
  const state = data?.state ?? {
    id: "",
    name: "",
    description: "",
    stateImages: [],
  };
  const hasOutgoingTransitions = data?.hasOutgoingTransitions ?? false;
  const onAddOutgoingTransition = data?.onAddOutgoingTransition;
  const onStartImageDrag = data?.onStartImageDrag;
  // Use resolvePatternImage from Zustand store (via useImages hook) -
  // this ensures we use the same images that StateStructure loaded
  const { resolvePatternImage } = useImages();

  // Calculate card size based on image count for roughly square aspect ratio
  const imageCount = state.stateImages?.length ?? 0;
  const cardSize = getCardSize(imageCount);

  return (
    <div style={{ width: cardSize.cardWidth }}>
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-[var(--brand-primary)]"
      />

      <Card
        className={`transition-all cursor-pointer ${
          selected
            ? "border-[var(--brand-primary)] bg-[var(--brand-primary)]/10 shadow-lg shadow-[var(--brand-primary)]/20"
            : "border-border-default bg-surface-raised hover:border-border-default"
        }`}
      >
        <CardContent className="p-4">
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-center relative">
                <h3 className="font-semibold text-white text-xl text-center">
                  {state.name}
                </h3>
                {state.initial && (
                  <Badge
                    className="absolute -top-2 -left-2 bg-[#FFD700] text-black text-xs px-1.5 py-0.5"
                    title="Initial State"
                  >
                    <Play className="w-3 h-3" />
                  </Badge>
                )}
              </div>
              {state.description && (
                <p className="text-xs text-text-muted mt-2 text-center line-clamp-3 break-words">
                  {state.description}
                </p>
              )}
            </div>

            {/* State Images Thumbnail Grid */}
            {state.stateImages && state.stateImages.length > 0 && (
              <div
                className="grid gap-1 mx-auto pb-2"
                style={{
                  gridTemplateColumns: `repeat(${cardSize.gridCols}, 48px)`,
                  maxWidth: cardSize.gridMaxWidth,
                }}
              >
                {state.stateImages
                  .slice(0, cardSize.maxImages)
                  .map((stateImage: StateImage) => {
                    // Get first pattern's image from library
                    const firstPattern = stateImage.patterns?.[0];
                    const imageData = firstPattern
                      ? resolvePatternImage(firstPattern)
                      : null;

                    // Debug log for troubleshooting image display issues
                    if (!imageData) {
                      console.log("[StateNode] No imageData for stateImage:", {
                        stateId: state.id,
                        stateImageId: stateImage.id,
                        stateImageName: stateImage.name,
                        hasPatterns: !!stateImage.patterns,
                        patternsLength: stateImage.patterns?.length,
                        firstPatternId: firstPattern?.id,
                        firstPatternImageId: firstPattern?.imageId,
                      });
                    }
                    return (
                      <div key={stateImage.id} className="relative">
                        <div
                          className="w-12 h-12 rounded flex items-center justify-center relative overflow-hidden"
                          style={{
                            background:
                              "linear-gradient(45deg, #374151 25%, transparent 25%), linear-gradient(-45deg, #374151 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #374151 75%), linear-gradient(-45deg, transparent 75%, #374151 75%)",
                            backgroundSize: "6px 6px",
                            backgroundPosition:
                              "0 0, 0 3px, 3px -3px, -3px 0px",
                            backgroundColor: "#4B5563",
                          }}
                        >
                          {imageData ? (
                            <StateImageViewer
                              image={imageData.url}
                              mask={imageData.mask}
                              mode={imageData.mask ? "with-mask" : "normal"}
                              alt={stateImage.name}
                              className="w-full h-full"
                            />
                          ) : (
                            <ImageIcon className="w-4 h-4 text-text-muted" />
                          )}
                        </div>
                        {/* Draggable connection point for creating outgoing transitions or moving */}
                        {onStartImageDrag && imageData && (
                          <div
                            className="nodrag absolute -bottom-1.5 left-1/2 transform -translate-x-1/2 w-3 h-3 rounded-full bg-[var(--brand-secondary)]/70 hover:bg-[var(--brand-secondary)] cursor-grab hover:scale-125 transition-all z-10 border border-[var(--brand-secondary)]"
                            title={`Drag to create transition • Alt+drag to move`}
                            draggable
                            onDragStart={(e) => {
                              e.stopPropagation();
                              // Check if Alt key is pressed for move operation
                              const isMoveOperation = e.altKey;
                              // Set drag data for the state machine to handle
                              e.dataTransfer.setData(
                                "application/stateimage-drag",
                                JSON.stringify({
                                  sourceStateId: state.id,
                                  stateImageId: stateImage.id,
                                  stateImageName: stateImage.name,
                                  isMoveOperation,
                                })
                              );
                              e.dataTransfer.effectAllowed = isMoveOperation
                                ? "move"
                                : "link";
                              onStartImageDrag(state.id, stateImage.id);
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                {/* Show +N indicator if more images than displayed */}
                {state.stateImages.length > cardSize.maxImages && (
                  <div className="w-12 h-12 bg-surface-raised rounded border border-border-default flex items-center justify-center">
                    <span className="text-xs text-text-muted">
                      +{state.stateImages.length - cardSize.maxImages}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Element Counts */}
            <div className="flex items-center justify-center gap-3 flex-wrap">
              {state.regions && state.regions.length > 0 && (
                <div className="flex items-center gap-1">
                  <Square className="w-4 h-4 text-text-muted" />
                  <span className="text-sm text-text-secondary">
                    {state.regions.length}
                  </span>
                </div>
              )}
              {state.locations && state.locations.length > 0 && (
                <div className="flex items-center gap-1">
                  <MapPin className="w-4 h-4 text-text-muted" />
                  <span className="text-sm text-text-secondary">
                    {state.locations.length}
                  </span>
                </div>
              )}
              {state.strings && state.strings.length > 0 && (
                <div className="flex items-center gap-1">
                  <Type className="w-4 h-4 text-text-muted" />
                  <span className="text-sm text-text-secondary">
                    {state.strings.length}
                  </span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-[var(--brand-secondary)]"
      />

      {/* Green "Add Outgoing Transition" circle - only show if no outgoing transitions */}
      {!hasOutgoingTransitions && onAddOutgoingTransition && (
        <div
          role="button"
          tabIndex={0}
          className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 cursor-pointer hover:scale-110 transition-transform z-10"
          onClick={(e) => {
            e.stopPropagation();
            onAddOutgoingTransition(state.id);
          }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onAddOutgoingTransition(state.id); } }}
          title="Add Outgoing Transition"
        >
          <div className="w-8 h-8 rounded-full bg-[var(--brand-success)]/70 hover:bg-[var(--brand-success)] flex items-center justify-center shadow-lg">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M8 3 L8 13 M3 8 L13 8"
                stroke="black"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
