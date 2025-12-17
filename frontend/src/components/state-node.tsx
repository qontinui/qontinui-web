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

  return (
    <div className="min-w-[200px]">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-[#00D9FF]"
      />

      <Card
        className={`transition-all cursor-pointer ${
          selected
            ? "border-[#00D9FF] bg-[#00D9FF]/10 shadow-lg shadow-[#00D9FF]/20"
            : "border-gray-600 bg-[#27272A] hover:border-gray-500"
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
                <p className="text-xs text-gray-400 mt-2 text-center line-clamp-2">
                  {state.description}
                </p>
              )}
            </div>

            {/* State Images Thumbnail Grid */}
            {state.stateImages && state.stateImages.length > 0 && (
              <div className="grid grid-cols-3 gap-1 max-w-[150px] mx-auto pb-2">
                {state.stateImages.slice(0, 6).map((stateImage: unknown) => {
                  // Get first pattern's image from library
                  const firstPattern = stateImage.patterns?.[0];
                  const imageData = firstPattern
                    ? resolvePatternImage(firstPattern)
                    : null;
                  return (
                    <div
                      key={stateImage.id}
                      className="relative"
                    >
                      <div
                        className="w-12 h-12 rounded flex items-center justify-center relative overflow-hidden"
                        style={{
                          background:
                            "linear-gradient(45deg, #374151 25%, transparent 25%), linear-gradient(-45deg, #374151 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #374151 75%), linear-gradient(-45deg, transparent 75%, #374151 75%)",
                          backgroundSize: "6px 6px",
                          backgroundPosition: "0 0, 0 3px, 3px -3px, -3px 0px",
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
                          <ImageIcon className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                      {/* Draggable connection point for creating outgoing transitions */}
                      {onStartImageDrag && imageData && (
                        <div
                          className="nodrag absolute -bottom-1.5 left-1/2 transform -translate-x-1/2 w-3 h-3 rounded-full bg-[#BD00FF]/70 hover:bg-[#BD00FF] cursor-grab hover:scale-125 transition-all z-10 border border-[#BD00FF]"
                          title={`Drag to create transition from ${stateImage.name}`}
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation();
                            // Set drag data for the state machine to handle
                            e.dataTransfer.setData("application/stateimage-drag", JSON.stringify({
                              sourceStateId: state.id,
                              stateImageId: stateImage.id,
                              stateImageName: stateImage.name,
                            }));
                            e.dataTransfer.effectAllowed = "link";
                            onStartImageDrag(state.id, stateImage.id);
                          }}
                        />
                      )}
                    </div>
                  );
                })}
                {/* Show +N indicator if more than 6 images */}
                {state.stateImages.length > 6 && (
                  <div className="w-12 h-12 bg-gray-700 rounded border border-gray-600 flex items-center justify-center">
                    <span className="text-xs text-gray-400">
                      +{state.stateImages.length - 6}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Element Counts */}
            <div className="flex items-center justify-center gap-3 flex-wrap">
              {state.stateImages && state.stateImages.length > 0 && (
                <div className="flex items-center gap-1">
                  <ImageIcon className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-300">
                    {state.stateImages.length}
                  </span>
                </div>
              )}
              {state.regions && state.regions.length > 0 && (
                <div className="flex items-center gap-1">
                  <Square className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-300">
                    {state.regions.length}
                  </span>
                </div>
              )}
              {state.locations && state.locations.length > 0 && (
                <div className="flex items-center gap-1">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-300">
                    {state.locations.length}
                  </span>
                </div>
              )}
              {state.strings && state.strings.length > 0 && (
                <div className="flex items-center gap-1">
                  <Type className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-300">
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
        className="w-3 h-3 bg-[#BD00FF]"
      />

      {/* Green "Add Outgoing Transition" circle - only show if no outgoing transitions */}
      {!hasOutgoingTransitions && onAddOutgoingTransition && (
        <div
          className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 cursor-pointer hover:scale-110 transition-transform z-10"
          onClick={(e) => {
            e.stopPropagation();
            onAddOutgoingTransition(state.id);
          }}
          title="Add Outgoing Transition"
        >
          <div className="w-8 h-8 rounded-full bg-[#00FF88]/70 hover:bg-[#00FF88] flex items-center justify-center shadow-lg">
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
