import { useState } from "react";
import type { DisplayOptionsState } from "../semantic-analysis-types";

export function useDisplayOptions(): DisplayOptionsState {
  const [showLabels, setShowLabels] = useState(true);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);
  const [showMasks, setShowMasks] = useState(false);

  return {
    showLabels,
    setShowLabels,
    showBoundingBoxes,
    setShowBoundingBoxes,
    showMasks,
    setShowMasks,
  };
}
