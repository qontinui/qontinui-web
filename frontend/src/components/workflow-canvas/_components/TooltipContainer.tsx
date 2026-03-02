"use client";

import React, { useEffect, useState } from "react";
import { TooltipManager } from "../tooltip-manager";
import { TooltipState } from "../tooltip-types";

export function TooltipContainer() {
  const [state, setState] = useState<TooltipState | null>(null);

  useEffect(() => {
    return TooltipManager.subscribe(setState);
  }, []);

  if (!state) return null;

  return (
    <div
      className="fixed z-[10000] pointer-events-none"
      style={{
        left: `${state.position.x}px`,
        top: `${state.position.y}px`,
      }}
    >
      <div className="bg-surface-canvas text-text-secondary text-sm rounded-lg shadow-xl border border-border-default px-3 py-2 max-w-xs">
        {state.content}
      </div>
    </div>
  );
}
