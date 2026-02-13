import { useState } from "react";

export function useViewConfig() {
  const [viewMode, setViewMode] = useState<"all" | "selected" | "state">("all");
  const [rightPanelTab, setRightPanelTab] = useState<"stateimage" | "state">(
    "stateimage"
  );
  const [canvasScale, setCanvasScale] = useState(1);
  const [canvasImageSize, setCanvasImageSize] = useState({
    width: 0,
    height: 0,
  });

  return {
    viewMode,
    setViewMode,
    rightPanelTab,
    setRightPanelTab,
    canvasScale,
    setCanvasScale,
    canvasImageSize,
    setCanvasImageSize,
  };
}
