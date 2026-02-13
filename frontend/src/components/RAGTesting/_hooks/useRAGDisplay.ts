import { useState } from "react";

export function useRAGDisplay() {
  // Display options
  const [showSegmentation, setShowSegmentation] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [highlightMatches, setHighlightMatches] = useState(true);

  return {
    showSegmentation,
    setShowSegmentation,
    showLabels,
    setShowLabels,
    highlightMatches,
    setHighlightMatches,
  };
}
