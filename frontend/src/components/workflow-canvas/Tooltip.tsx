"use client";

import React from "react";
import { useTooltipPosition } from "./_hooks/use-tooltip-position";
import { TooltipProps } from "./tooltip-types";

export type {
  TooltipPlacement,
  TooltipProps,
  NodeTooltipData,
  HandleTooltipData,
  EdgeTooltipData,
  TooltipState,
} from "./tooltip-types";

export { useTooltip } from "./_hooks/use-tooltip";
export { NodeTooltip } from "./_components/NodeTooltip";
export { HandleTooltip } from "./_components/HandleTooltip";
export { EdgeTooltip } from "./_components/EdgeTooltip";
export { ShortcutTooltip } from "./_components/ShortcutTooltip";
export { TooltipContainer } from "./_components/TooltipContainer";
export { TooltipManager } from "./tooltip-manager";

export function Tooltip({
  content,
  placement = "auto",
  delay = 500,
  offset = 8,
  children,
  disabled = false,
}: TooltipProps) {
  const {
    isVisible,
    position,
    tooltipRef,
    targetRef,
    showTooltip,
    hideTooltip,
  } = useTooltipPosition({ placement, offset, delay, disabled });

  return (
    <>
      <div
        ref={targetRef}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        className="inline-block"
      >
        {children}
      </div>

      {isVisible && position && (
        <div
          ref={tooltipRef}
          className="fixed z-[10000] pointer-events-none"
          style={{
            left: `${position.x}px`,
            top: `${position.y}px`,
          }}
        >
          <div
            className="bg-surface-canvas text-text-secondary text-sm rounded-lg shadow-xl border border-border-default px-3 py-2 max-w-xs"
            style={{
              animation: "tooltipFadeIn 150ms ease-out",
            }}
          >
            {content}
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes tooltipFadeIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </>
  );
}

export default Tooltip;
