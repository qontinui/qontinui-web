import { useState } from "react";
import type { SearchMode, MatchingStrategy } from "@/types/rag-testing";

export function useRAGSearchConfig() {
  const [searchMode, setSearchMode] = useState<SearchMode>("filtered");
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [matchingStrategy, setMatchingStrategy] =
    useState<MatchingStrategy>("average");
  const [similarityThreshold, setSimilarityThreshold] = useState(0.7);
  const [useOCR, setUseOCR] = useState(false);

  const toggleElementSelection = (elementId: string) => {
    setSelectedElementIds((prev) =>
      prev.includes(elementId)
        ? prev.filter((id) => id !== elementId)
        : [...prev, elementId]
    );
  };

  return {
    searchMode,
    setSearchMode,
    selectedElementIds,
    setSelectedElementIds,
    matchingStrategy,
    setMatchingStrategy,
    similarityThreshold,
    setSimilarityThreshold,
    useOCR,
    setUseOCR,
    toggleElementSelection,
  };
}
