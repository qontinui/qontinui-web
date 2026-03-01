"use client";

import React from "react";
import { Eye, Layers } from "lucide-react";
import type { CanvasMode, ActiveStateInfo } from "../ActiveStatesCanvas-types";

interface EmptyStateOverlayProps {
  mode: CanvasMode;
  activeStatesInfo: ActiveStateInfo[];
}

export function EmptyStateOverlay({
  mode,
  activeStatesInfo,
}: EmptyStateOverlayProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="text-center text-muted-foreground bg-background/80 backdrop-blur-sm rounded-lg p-6">
        {mode === "perception" ? (
          <>
            <Eye className="mx-auto h-12 w-12 mb-2 opacity-50" />
            <p className="font-medium">Perception Canvas</p>
            <p className="text-xs mt-1">
              Found images will appear here at their detected coordinates
            </p>
            {activeStatesInfo.length > 0 && (
              <p className="text-xs mt-2 text-muted-foreground/70">
                {activeStatesInfo.length} state(s) active, waiting for image
                detection...
              </p>
            )}
          </>
        ) : (
          <>
            <Layers className="mx-auto h-12 w-12 mb-2 opacity-50" />
            <p className="font-medium">No Elements to Display</p>
            <p className="text-xs mt-1">
              Select states with positioned elements to view
            </p>
          </>
        )}
      </div>
    </div>
  );
}
