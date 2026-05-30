import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { authService, extractionService } from "@/services/service-factory";
import { useExtractions, useCreateExtraction } from "@/hooks/use-extractions";
import { runnerClient } from "@/lib/runner-client";
import {
  useExtractionAnnotationStore,
  type AnnotatedElement,
} from "@/stores/extraction-annotation-store";
import type {
  StateMachineState,
  StateMachineStateImage,
  ElementAnnotation,
} from "@/types/extraction";
import type { ExtractionState } from "./useExtractionState";
import { createLogger } from "@/lib/logger";
const logger = createLogger("UseWebExtraction");

interface UseWebExtractionArgs {
  projectId: string | null;
  state: ExtractionState;
  configMethod: string;
  webConfig: {
    urls: string[];
    captureHover: boolean;
    captureFocus: boolean;
    maxDepth: number;
    maxPages: number;
  };
  isLoaded: boolean;
}

export function useWebExtraction({
  projectId,
  state,
  configMethod,
  webConfig,
  isLoaded: _isLoaded,
}: UseWebExtractionArgs) {
  const createExtraction = useCreateExtraction();
  const annotationStore = useExtractionAnnotationStore();

  // Keep a ref to state so callbacks can access setters without re-creating
  const stateRef = useRef(state);
  stateRef.current = state;

  const {
    data: extractionHistory = [],
    isLoading: isLoadingHistory,
    refetch: refetchHistory,
  } = useExtractions(projectId || "", !!projectId);

  // Count stale extractions (running/pending older than 1 hour)
  const staleExtractions = useMemo(() => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    return extractionHistory.filter(
      (ext) =>
        (ext.status === "running" || ext.status === "pending") &&
        new Date(ext.created_at).getTime() < oneHourAgo
    );
  }, [extractionHistory]);

  // Cleanup stale extractions
  const cleanupStaleExtractions = useCallback(async () => {
    if (staleExtractions.length === 0) {
      toast.info("No stale extractions to clean up");
      return;
    }

    stateRef.current.setIsCleaningUp(true);
    try {
      let cleaned = 0;
      for (const extraction of staleExtractions) {
        try {
          await extractionService.updateExtraction(extraction.id, {
            status: "failed",
            error_message: "Marked as failed - extraction was interrupted",
          });
          cleaned++;
        } catch (error) {
          logger.error(`Failed to cleanup extraction ${extraction.id}:`, error);
        }
      }
      toast.success(
        `Cleaned up ${cleaned} stale extraction${cleaned !== 1 ? "s" : ""}`
      );
      refetchHistory();
    } catch (error) {
      logger.error("Cleanup failed:", error);
      toast.error("Failed to clean up stale extractions");
    } finally {
      stateRef.current.setIsCleaningUp(false);
    }
  }, [staleExtractions, refetchHistory]);

  // Load extraction detail and annotations
  const loadExtractionDetail = useCallback(
    async (extractionId: string, silent = false) => {
      try {
        if (!silent) {
          stateRef.current.setIsLoadingDetail(true);
        }
        logger.info("[Extraction] Fetching detail for:", extractionId);
        const detail =
          await extractionService.getExtractionDetail(extractionId);
        logger.info("[Extraction] Detail received:", {
          id: detail.id,
          status: detail.status,
          hasStateMachine: !!detail.state_machine,
          statesCount: detail.state_machine?.states?.length ?? 0,
        });
        stateRef.current.setExtractionDetail(detail);

        logger.info("[Extraction] Fetching annotations...");
        const annots = await extractionService.getAnnotations(extractionId);
        logger.info("[Extraction] Annotations received:", {
          count: annots.length,
          firstAnnotation: annots[0]
            ? {
                screenshotId: annots[0].screenshot_id,
                statesCount: annots[0].states?.length ?? 0,
                elementsCount: annots[0].elements?.length ?? 0,
              }
            : null,
        });
        stateRef.current.setAnnotations(annots);
      } catch (error) {
        logger.error("[Extraction] Failed to load extraction detail:", error);
        if (!silent) {
          toast.error("Failed to load extraction details");
        }
      } finally {
        if (!silent) {
          stateRef.current.setIsLoadingDetail(false);
        }
      }
    },
    []
  );

  // Auto-load latest completed extraction on page load
  useEffect(() => {
    if (
      state.autoLoadedRef.current ||
      isLoadingHistory ||
      state.webExtractionProgress.status === "running"
    ) {
      return;
    }
    if (
      state.selectedHistoryExtractionId ||
      state.webExtractionProgress.extractionId
    ) {
      return;
    }
    const latestCompleted = extractionHistory.find(
      (ext) => ext.status === "completed" && ext.state_machine?.states?.length
    );
    if (latestCompleted) {
      logger.info(
        "[Extraction] Auto-loading latest completed extraction:",
        latestCompleted.id
      );
      state.autoLoadedRef.current = true;
      state.setSelectedHistoryExtractionId(latestCompleted.id);
      state.setWebExtractionProgress((prev) => ({
        ...prev,
        status: "completed",
        extractionId: latestCompleted.id,
        statesFound: latestCompleted.state_machine?.states?.length ?? 0,
        transitionsFound:
          latestCompleted.state_machine?.transitions?.length ?? 0,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable references
  }, [
    extractionHistory,
    isLoadingHistory,
    state.webExtractionProgress.status,
    state.webExtractionProgress.extractionId,
    state.selectedHistoryExtractionId,
  ]);

  // Load extraction details when history item is selected
  useEffect(() => {
    if (state.selectedHistoryExtractionId) {
      loadExtractionDetail(state.selectedHistoryExtractionId);
    }
  }, [state.selectedHistoryExtractionId, loadExtractionDetail]);

  // Convert extraction data to StateMachineState format
  const stateMachineStates: StateMachineState[] = useMemo(() => {
    if (state.extractionDetail?.state_machine?.states?.length) {
      let globalImageIndex = 0;
      const processedStates = state.extractionDetail.state_machine.states.map(
        (s) => ({
          ...s,
          stateImages: s.stateImages.map((img) => {
            globalImageIndex++;
            const uniqueId = `${s.id}-img-${globalImageIndex}`;
            return {
              ...img,
              id: uniqueId,
              patterns:
                img.patterns?.map((p, pIdx) => ({
                  ...p,
                  id: `${uniqueId}-pattern-${pIdx}`,
                })) || [],
            };
          }),
        })
      );
      return processedStates;
    }

    if (state.annotations.length > 0) {
      interface StateOccurrence {
        stateId: string;
        stateName: string;
        stateBbox: { x: number; y: number; width: number; height: number };
        elements: ElementAnnotation[];
        screenshotId: string;
        sourceUrl: string;
      }

      const statesByName = new Map<string, StateOccurrence[]>();

      for (const annotation of state.annotations) {
        const elementMap = new Map<string, ElementAnnotation>();
        for (const element of annotation.elements || []) {
          elementMap.set(element.id, element);
        }

        for (const st of annotation.states || []) {
          const stateName = st.name || "Unknown State";
          const stateElements: ElementAnnotation[] = [];
          for (const elementId of st.element_ids || []) {
            const element = elementMap.get(elementId);
            if (element) {
              stateElements.push(element);
            }
          }

          if (!statesByName.has(stateName)) {
            statesByName.set(stateName, []);
          }
          statesByName.get(stateName)!.push({
            stateId: st.id,
            stateName,
            stateBbox: st.bbox || { x: 0, y: 0, width: 200, height: 80 },
            elements: stateElements,
            screenshotId: annotation.screenshot_id,
            sourceUrl: annotation.source_url,
          });
        }
      }

      const result: StateMachineState[] = [];
      let stateIndex = 0;

      for (const [stateName, occurrences] of statesByName) {
        const firstOccurrence = occurrences[0];
        if (!firstOccurrence) continue;

        const stateBbox = firstOccurrence.stateBbox;
        const stateImages: StateMachineStateImage[] = [];
        const seenElementNames = new Set<string>();

        for (const occurrence of occurrences) {
          if (occurrence.elements.length > 0) {
            for (const element of occurrence.elements) {
              const elementName =
                element.name ||
                element.text ||
                element.element_type ||
                "Element";
              const dedupeKey = `${occurrence.screenshotId}-${elementName}`;
              if (seenElementNames.has(dedupeKey)) continue;
              seenElementNames.add(dedupeKey);

              const elementBbox = element.bbox || stateBbox;
              const uniqueId = `${occurrence.screenshotId}-${element.id}`;
              stateImages.push({
                id: `stateimage-${uniqueId}`,
                name: elementName,
                patterns: [
                  {
                    id: `pattern-${uniqueId}`,
                    name: elementName,
                    searchRegions: [elementBbox],
                    fixed: false,
                  },
                ],
                shared: false,
                searchRegions: [elementBbox],
                screenshotId: occurrence.screenshotId,
                sourceUrl: occurrence.sourceUrl,
              });
            }
          }
        }

        if (stateImages.length === 0) {
          stateImages.push({
            id: `stateimage-${firstOccurrence.stateId}`,
            name: stateName,
            patterns: [
              {
                id: `pattern-${firstOccurrence.stateId}`,
                name: stateName,
                searchRegions: [stateBbox],
                fixed: false,
              },
            ],
            shared: false,
            searchRegions: [stateBbox],
            screenshotId: firstOccurrence.screenshotId,
            sourceUrl: firstOccurrence.sourceUrl,
          });
        }

        result.push({
          id: firstOccurrence.stateId,
          name: stateName,
          description: `Extracted from ${firstOccurrence.sourceUrl || "page"}`,
          stateImages,
          regions: [],
          locations: [],
          strings: [],
          position: { x: stateBbox.x, y: stateBbox.y },
          initial: stateIndex === 0,
          isFinal: false,
        });

        stateIndex++;
      }

      return result;
    }

    return [];
  }, [state.extractionDetail?.state_machine?.states, state.annotations]);

  // Load web elements into annotation store
  const loadWebElementsToAnnotationStore = useCallback(() => {
    if (!state.annotations.length && !stateMachineStates.length) return;

    const extractionId = state.webExtractionProgress.extractionId;
    if (!extractionId) return;

    const firstAnnotation = state.annotations[0];
    const sourceUrl = firstAnnotation?.source_url;
    annotationStore.setSession(
      extractionId,
      firstAnnotation?.screenshot_id,
      sourceUrl
    );

    const elements: AnnotatedElement[] = [];

    for (const annotation of state.annotations) {
      if (annotation.elements) {
        for (const el of annotation.elements) {
          elements.push({
            id: el.id,
            bbox: el.bbox,
            label: el.name || el.text || "Element",
            elementType: el.element_type || "other",
            text: el.text || undefined,
            confidence: el.confidence || 0.5,
            isGroundTruth: false,
            isAutoDetected: true,
            detectionTechnique: "web-extraction",
          });
        }
      }
    }

    if (elements.length === 0 && stateMachineStates.length > 0) {
      for (const st of stateMachineStates) {
        for (const stateImage of st.stateImages || []) {
          if (stateImage.bbox) {
            elements.push({
              id: stateImage.id,
              bbox: stateImage.bbox,
              label: stateImage.name || `${st.name} Element`,
              elementType:
                stateImage.extractionCategory?.split(":")[0] || "other",
              confidence: 1.0,
              isGroundTruth: false,
              isAutoDetected: true,
              detectionTechnique:
                stateImage.extractionCategory || "state-machine",
            });
          }
        }
      }
    }

    if (elements.length > 0) {
      annotationStore.setElements(elements);

      if (firstAnnotation?.screenshot_id) {
        const screenshotUrl = `${process.env.NEXT_PUBLIC_API_URL}/api/v1/extractions/${extractionId}/screenshots/${firstAnnotation.screenshot_id}`;
        annotationStore.setScreenshot(
          screenshotUrl,
          firstAnnotation.viewport_width || 1920,
          firstAnnotation.viewport_height || 1080
        );
      }
    }
  }, [
    state.annotations,
    stateMachineStates,
    state.webExtractionProgress.extractionId,
    annotationStore,
  ]);

  // Poll for web extraction status from backend
  const pollWebExtractionStatus = useCallback(async () => {
    const extractionId = stateRef.current.webExtractionProgress.extractionId;
    if (!extractionId) return;

    try {
      const detail = await extractionService.getExtractionDetail(extractionId);
      logger.info(
        "[Extraction] Backend status:",
        detail.status,
        "stats:",
        detail.stats
      );

      if (detail.stats) {
        const stats = detail.stats as {
          states_found?: number;
          transitions_found?: number;
          pages_extracted?: number;
          errors?: number;
        };
        stateRef.current.setWebExtractionProgress((prev) => ({
          ...prev,
          statesFound: stats.states_found ?? prev.statesFound,
          transitionsFound: stats.transitions_found ?? prev.transitionsFound,
          pagesExtracted: stats.pages_extracted ?? prev.pagesExtracted,
          errors: stats.errors ?? prev.errors,
        }));
      }

      if (detail.status === "completed") {
        stateRef.current.setIsExtracting(false);
        if (stateRef.current.pollingRef.current) {
          clearInterval(stateRef.current.pollingRef.current);
          stateRef.current.pollingRef.current = null;
        }
        stateRef.current.setWebExtractionProgress((prev) => {
          const finalElapsedSeconds = prev.startTime
            ? Math.floor((Date.now() - prev.startTime) / 1000)
            : undefined;
          logger.info(
            "[Extraction] Completed - startTime:",
            prev.startTime,
            "finalElapsedSeconds:",
            finalElapsedSeconds
          );
          return {
            ...prev,
            status: "completed",
            elapsedSeconds: finalElapsedSeconds,
            startTime: undefined,
          };
        });
        toast.success("Web extraction completed successfully!");
      } else if (detail.status === "failed") {
        stateRef.current.setIsExtracting(false);
        if (stateRef.current.pollingRef.current) {
          clearInterval(stateRef.current.pollingRef.current);
          stateRef.current.pollingRef.current = null;
        }
        stateRef.current.setWebExtractionProgress((prev) => {
          const finalElapsedSeconds = prev.startTime
            ? Math.floor((Date.now() - prev.startTime) / 1000)
            : undefined;
          return {
            ...prev,
            status: "failed",
            errorMessage: detail.error_message || "Extraction failed",
            elapsedSeconds: finalElapsedSeconds,
            startTime: undefined,
          };
        });
        toast.error(
          `Extraction failed: ${detail.error_message || "Unknown error"}`
        );
      }
    } catch (error) {
      logger.error("Error polling web extraction status:", error);
    }
  }, []);

  // Load extraction detail when web extraction completes
  useEffect(() => {
    if (
      configMethod === "web" &&
      state.webExtractionProgress.status === "completed" &&
      state.webExtractionProgress.extractionId &&
      !state.extractionDetail
    ) {
      logger.info(
        "[Extraction] Loading detail for:",
        state.webExtractionProgress.extractionId
      );
      loadExtractionDetail(state.webExtractionProgress.extractionId);
    }
  }, [
    configMethod,
    state.webExtractionProgress.status,
    state.webExtractionProgress.extractionId,
    state.extractionDetail,
    loadExtractionDetail,
  ]);

  // Start web extraction
  const startWebExtraction = useCallback(async () => {
    if (!projectId) {
      toast.error("No project selected");
      return;
    }

    const validUrls = webConfig.urls.filter((u) => u.trim() !== "");
    if (validUrls.length === 0) {
      toast.error("Please add at least one URL to extract");
      return;
    }

    const runnerAvailable = await runnerClient.isAvailable();
    if (!runnerAvailable) {
      toast.error(
        "Desktop Runner is not connected. Please start the qontinui-runner application."
      );
      return;
    }

    stateRef.current.setExtractionDetail(null);
    stateRef.current.setAnnotations([]);
    stateRef.current.setSelectedHistoryExtractionId(null);

    const startTime = Date.now();
    logger.info("[Extraction] Started - set startTime:", startTime);

    stateRef.current.setWebExtractionProgress({
      status: "running",
      extractionId: null,
      statesFound: 0,
      transitionsFound: 0,
      pagesExtracted: 0,
      errors: 0,
      elapsedSeconds: 0,
      startTime,
    });

    const sessionResult = await createExtraction.mutateAsync({
      projectId,
      data: {
        source_urls: validUrls,
        config: {
          viewports: [[1920, 1080]],
          capture_hover_states: webConfig.captureHover,
          capture_focus_states: webConfig.captureFocus,
          max_depth: webConfig.maxDepth,
          max_pages: webConfig.maxPages,
        },
      },
    });

    stateRef.current.setWebExtractionProgress((prev) => ({
      ...prev,
      extractionId: sessionResult.id,
    }));

    // Hand the runner the Cognito access token the app already holds; the
    // backend accepts it directly. `null` when unauthenticated → omitted below.
    const authToken = authService.tokenManager.getAccessToken();

    const response = await runnerClient.startExtraction({
      urls: validUrls,
      viewports: [[1920, 1080]],
      capture_hover_states: webConfig.captureHover,
      capture_focus_states: webConfig.captureFocus,
      max_depth: webConfig.maxDepth,
      max_pages: webConfig.maxPages,
      session_id: sessionResult.id,
      backend_url: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
      auth_token: authToken || undefined,
    });

    if (!response.success) {
      try {
        await extractionService.updateExtraction(sessionResult.id, {
          status: "failed",
          error_message:
            response.error || "Failed to start extraction on runner",
        });
      } catch (updateError) {
        logger.error("Failed to update extraction status:", updateError);
      }
      throw new Error(response.error || "Failed to start web extraction");
    }

    toast.info("Starting web extraction...");
    stateRef.current.setIsExtracting(true);
    stateRef.current.setMainTab("results");
  }, [projectId, webConfig, createExtraction]);

  return {
    extractionHistory,
    isLoadingHistory,
    refetchHistory,
    staleExtractions,
    cleanupStaleExtractions,
    loadExtractionDetail,
    stateMachineStates,
    loadWebElementsToAnnotationStore,
    pollWebExtractionStatus,
    startWebExtraction,
    createExtraction,
    annotationStore,
  };
}
