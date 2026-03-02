import React from "react";
import { TooltipPlacement, TooltipState } from "./tooltip-types";

let tooltipState: TooltipState | null = null;
let tooltipListeners: Array<(state: TooltipState | null) => void> = [];

export const TooltipManager = {
  show(
    content: React.ReactNode,
    position: { x: number; y: number },
    placement: TooltipPlacement = "auto"
  ) {
    tooltipState = { content, position, placement };
    tooltipListeners.forEach((listener) => listener(tooltipState));
  },

  hide() {
    tooltipState = null;
    tooltipListeners.forEach((listener) => listener(null));
  },

  subscribe(listener: (state: TooltipState | null) => void) {
    tooltipListeners.push(listener);
    return () => {
      tooltipListeners = tooltipListeners.filter((l) => l !== listener);
    };
  },

  getState() {
    return tooltipState;
  },
};
