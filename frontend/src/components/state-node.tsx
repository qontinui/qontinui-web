"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImageIcon, Target, Play, MapPin, Square, Type } from "lucide-react";
import { StateImageViewer } from "@/components/state-image-viewer";
import { useAutomation } from "@/contexts/automation-context";
import type { Pattern } from "@/contexts/automation-context/types";

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

interface StateNodeData {
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
  isSelected: boolean;
  onSelect: (id: string, selected: boolean) => void;
}

export function StateNode({ data, selected }: NodeProps<StateNodeData>) {
  const {
    state,
    images = [],
    hasIncomingTransitions = false,
    incomingTransitions = [],
  } = data || {
    state: { id: "", name: "", description: "", stateImages: [] },
    images: [],
    hasIncomingTransitions: false,
    incomingTransitions: [],
    isSelected: false,
    onSelect: () => {},
  };
  const { resolvePatternImage } = useAutomation();

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
                {hasIncomingTransitions && incomingTransitions.length > 0 && (
                  <Badge
                    className="absolute -top-2 -right-2 bg-[#00FF88] text-black text-xs px-1.5 py-0.5 flex items-center gap-0.5"
                    title={`${incomingTransitions.length} IncomingTransition${incomingTransitions.length > 1 ? "s" : ""}`}
                  >
                    <Target className="w-3 h-3" />
                    {incomingTransitions.length > 1 && (
                      <span className="font-semibold">
                        {incomingTransitions.length}
                      </span>
                    )}
                  </Badge>
                )}
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
              <div className="grid grid-cols-3 gap-1 max-w-[150px] mx-auto">
                {state.stateImages.slice(0, 6).map((stateImage) => {
                  // Get first pattern's image from library
                  const firstPattern = stateImage.patterns?.[0];
                  const imageData = firstPattern
                    ? resolvePatternImage(firstPattern)
                    : null;
                  return (
                    <div
                      key={stateImage.id}
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
    </div>
  );
}
