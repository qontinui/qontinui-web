import { useState } from "react";
import type { SegmentWithMatches, RAGFindMatch } from "@/types/rag-testing";
import type { RAGElement } from "@/types/rag-builder";

export function useRAGAnalysis() {
  // Analysis results
  const [segments, setSegments] = useState<SegmentWithMatches[]>([]);
  const [allMatches, setAllMatches] = useState<RAGFindMatch[]>([]);
  const [processingTime, setProcessingTime] = useState(0);

  // Selection state
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    null
  );
  const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null);

  // UI state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [ragElements, setRagElements] = useState<RAGElement[]>([]);
  const [loadingElements, setLoadingElements] = useState(false);
  const [elementSelectorOpen, setElementSelectorOpen] = useState(false);

  // Preloaded mask images for rendering
  const [maskImages, setMaskImages] = useState<Map<string, HTMLImageElement>>(
    new Map()
  );

  // Segmentation-only mode (no RAG elements available for matching)
  const isSegmentationOnly = ragElements.length === 0 && !loadingElements;

  const resetResults = () => {
    setSegments([]);
    setAllMatches([]);
    setSelectedSegmentId(null);
    setMaskImages(new Map());
  };

  return {
    segments,
    setSegments,
    allMatches,
    setAllMatches,
    processingTime,
    setProcessingTime,
    selectedSegmentId,
    setSelectedSegmentId,
    hoveredSegmentId,
    setHoveredSegmentId,
    isAnalyzing,
    setIsAnalyzing,
    ragElements,
    setRagElements,
    loadingElements,
    setLoadingElements,
    elementSelectorOpen,
    setElementSelectorOpen,
    maskImages,
    setMaskImages,
    isSegmentationOnly,
    resetResults,
  };
}
