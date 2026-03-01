import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  RAGFindRequest,
  RAGFindResponse,
  RAGFindMatch,
  SegmentWithMatches,
  SearchMode,
  MatchingStrategy,
} from "@/types/rag-testing";
import type { RAGElement } from "@/types/rag-builder";
import {
  RUNNER_URL,
  urlToBase64,
  processRunnerSegments,
  associateMatchesWithSegments,
} from "../rag-testing-utils";
import type { ScreenshotInfo } from "@/components/common/ScreenshotPicker";

interface UseRAGAnalysisParams {
  projectId: string | null | undefined;
  currentScreenshot: ScreenshotInfo | null;
  searchMode: SearchMode;
  selectedElementIds: string[];
  similarityThreshold: number;
  matchingStrategy: MatchingStrategy;
  useOCR: boolean;
}

export function useRAGAnalysis({
  projectId,
  currentScreenshot,
  searchMode,
  selectedElementIds,
  similarityThreshold,
  matchingStrategy,
  useOCR,
}: UseRAGAnalysisParams) {
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
  const [elementSelectorOpen, setElementSelectorOpen] = useState(false);

  // Preloaded mask images for rendering
  const [maskImages, setMaskImages] = useState<Map<string, HTMLImageElement>>(
    new Map()
  );

  // Load RAG elements when project changes
  const { data: ragElements = [], isLoading: loadingElements } = useQuery({
    queryKey: ["rag-elements", projectId],
    queryFn: async () => {
      const response = await fetch(
        `${RUNNER_URL}/api/rag/projects/${projectId}/elements`
      );
      if (!response.ok) {
        // 404 is expected when no RAG config exists - not an error, just no elements
        if (response.status === 404) return [];
        throw new Error(`Failed to fetch elements: ${response.statusText}`);
      }
      return (await response.json()) as RAGElement[];
    },
    enabled: !!projectId,
    retry: false,
    staleTime: 30000,
  });

  // Segmentation-only mode (no RAG elements available for matching)
  const isSegmentationOnly = ragElements.length === 0 && !loadingElements;

  // Get selected segment
  const selectedSegment = useMemo(() => {
    return segments.find((s) => s.id === selectedSegmentId);
  }, [segments, selectedSegmentId]);

  const resetResults = useCallback(() => {
    setSegments([]);
    setAllMatches([]);
    setSelectedSegmentId(null);
    setMaskImages(new Map());
  }, []);

  // Preload mask images when segments change
  useEffect(() => {
    const loadMasks = async () => {
      const newMaskImages = new Map<string, HTMLImageElement>();

      for (const segment of segments) {
        if (segment.mask_data) {
          try {
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () =>
                reject(new Error(`Failed to load mask for ${segment.id}`));
              img.src = segment.mask_data!;
            });
            newMaskImages.set(segment.id, img);
          } catch (err) {
            console.warn(`Failed to load mask for segment ${segment.id}:`, err);
          }
        }
      }

      setMaskImages(newMaskImages);
    };

    if (segments.length > 0) {
      loadMasks();
    }
  }, [segments]);

  // Run analysis using runner for SAM3 segmentation
  const runAnalysis = useCallback(async () => {
    if (!currentScreenshot?.url) {
      toast.error("Please select a screenshot first");
      return;
    }

    // In segmentation-only mode, we don't need a project ID
    if (!isSegmentationOnly && !projectId) {
      toast.error("Please select a project first");
      return;
    }

    setIsAnalyzing(true);
    setSegments([]);
    setAllMatches([]);
    setSelectedSegmentId(null);
    setMaskImages(new Map());

    try {
      // Convert URL to base64 data URL for the API
      const screenshotBase64 = await urlToBase64(currentScreenshot.url);

      // Step 1: Call runner for SAM3 segmentation
      let runnerSegments: Array<{
        id: string;
        bbox: number[];
        area: number;
        image_base64?: string;
      }> = [];

      try {
        const segmentResponse = await fetch(`${RUNNER_URL}/rag/segment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            screenshot_base64: screenshotBase64,
            min_area: 100,
          }),
        });

        if (!segmentResponse.ok) {
          const errorData = await segmentResponse.json().catch(() => ({}));
          throw new Error(
            errorData.error ||
              `Segmentation failed: ${segmentResponse.statusText}`
          );
        }

        const segmentResult = await segmentResponse.json();
        if (segmentResult.data?.success) {
          runnerSegments = segmentResult.data.segments || [];
          console.log(
            `SAM3 segmentation: ${runnerSegments.length} segments found`
          );
        } else if (segmentResult.data?.error) {
          throw new Error(segmentResult.data.error);
        }
      } catch (err) {
        // If runner is not available, show error and stop
        const message =
          err instanceof Error
            ? err.message
            : "Failed to connect to runner for segmentation";
        toast.error(
          `Runner segmentation failed: ${message}. Make sure the desktop runner is running.`
        );
        setIsAnalyzing(false);
        return;
      }

      // Convert runner segments to the expected format
      const processedSegments = processRunnerSegments(runnerSegments);

      // Step 2: If we have RAG elements, do matching via runner
      let matches: RAGFindMatch[] = [];
      let matchProcessingTime = 0;

      if (!isSegmentationOnly && projectId) {
        try {
          const request: RAGFindRequest = {
            screenshot_base64: screenshotBase64,
            element_ids:
              searchMode === "specific" && selectedElementIds.length > 0
                ? selectedElementIds
                : undefined,
            similarity_threshold: similarityThreshold,
            matching_strategy: matchingStrategy,
            use_ocr: useOCR,
            return_segments: false, // We already have segments from runner
            max_results: 50,
          };

          const fetchResponse = await fetch(
            `${RUNNER_URL}/api/rag/projects/${projectId}/find`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(request),
            }
          );

          if (fetchResponse.ok) {
            const response: RAGFindResponse = await fetchResponse.json();
            if (response.success) {
              matches = response.matches;
              matchProcessingTime = response.processing_time_ms;
            }
          }
        } catch (matchErr) {
          console.warn("RAG matching failed:", matchErr);
          // Continue without matching - segmentation still works
        }
      }

      // Associate matches with segments
      const segmentsWithMatches = associateMatchesWithSegments(
        processedSegments,
        matches
      );

      setSegments(segmentsWithMatches);
      setAllMatches(matches);
      setProcessingTime(matchProcessingTime);

      const matchCount = matches.length;
      const segmentCount = segmentsWithMatches.length;
      if (isSegmentationOnly) {
        toast.success(`Found ${segmentCount} segments`);
      } else {
        toast.success(
          `Found ${matchCount} matches in ${segmentCount} segments`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      toast.error(message);
    } finally {
      setIsAnalyzing(false);
    }
  }, [
    currentScreenshot?.url,
    isSegmentationOnly,
    projectId,
    searchMode,
    selectedElementIds,
    similarityThreshold,
    matchingStrategy,
    useOCR,
  ]);

  return {
    // Results
    segments,
    allMatches,
    processingTime,
    // Selection
    selectedSegmentId,
    setSelectedSegmentId,
    hoveredSegmentId,
    setHoveredSegmentId,
    selectedSegment,
    // UI
    isAnalyzing,
    elementSelectorOpen,
    setElementSelectorOpen,
    // Masks
    maskImages,
    // RAG elements
    ragElements,
    loadingElements,
    isSegmentationOnly,
    // Actions
    resetResults,
    runAnalysis,
  };
}
