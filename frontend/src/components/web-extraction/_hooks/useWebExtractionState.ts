"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { createLogger } from "@/lib/logger";
import { useProjectLoader } from "@/hooks/use-project-loader";
import {
  useExtractions,
  useCreateExtraction,
  useDeleteExtraction,
} from "@/hooks/use-extractions";
import { authService, extractionService } from "@/services/service-factory";
import { usePlaywrightExtraction } from "@/hooks/use-playwright-extraction";
import {
  getVisionExtractionService,
  type VisionExtractionResponse,
} from "@/services/vision-extraction-service";
import { toast } from "sonner";
import { runnerClient } from "@/lib/runner-client";
import { useExtractionConfig } from "@/hooks/use-extraction-config";
import { useRunnerMonitors } from "@/hooks/useRunnerMonitors";
import type {
  ExtractionSessionCreate,
  ExtractionSessionDetail,
  ExtractionAnnotation,
} from "@/services/extraction-service";
import type { StateMachineState, InferredTransition } from "@/types/extraction";
import type { PlaywrightCollectorConfigState } from "../PlaywrightCollectorConfig";
import {
  aggregateVisionResults,
  buildStateMachineStates,
} from "../web-extraction-utils";

type MainTab = "configuration" | "results";
type ConfigSubTab = "dom-extraction" | "playwright-collector";
type ResultsSubTab =
  | "state-explorer"
  | "page-analysis"
  | "transitions"
  | "playwright"
  | "sam3"
  | "edge"
  | "ocr";

const DEFAULT_VIEWPORT: [number, number] = [1920, 1080];

export type { MainTab, ConfigSubTab, ResultsSubTab };

const logger = createLogger("WebExtraction");

export function useWebExtractionState() {
  const { projectId } = useProjectLoader();
  const { data: extractions } = useExtractions(projectId || "", !!projectId);
  const createExtraction = useCreateExtraction();
  const deleteExtraction = useDeleteExtraction();

  // Persistent config from hook
  const extractionConfig = useExtractionConfig();
  const { monitors: runnerMonitors } = useRunnerMonitors();

  // State for delete all confirmation
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  // Main tab state - Configuration or Results
  const [mainTab, setMainTab] = useState<MainTab>("configuration");
  // Configuration sub-tab state
  const [configSubTab, setConfigSubTab] =
    useState<ConfigSubTab>("dom-extraction");
  // Results sub-tab state
  const [resultsSubTab, setResultsSubTab] =
    useState<ResultsSubTab>("state-explorer");

  // Playwright extraction state
  const {
    currentJob: playwrightJob,
    isStarting: isStartingPlaywright,
    isPolling: isPollingPlaywright,
    startExtraction: startPlaywrightExtraction,
    results: playwrightResults,
  } = usePlaywrightExtraction();

  const [activeExtractionId, setActiveExtractionId] = useState<string | null>(
    null
  );
  const [extractionDetail, setExtractionDetail] =
    useState<ExtractionSessionDetail | null>(null);
  const [annotations, setAnnotations] = useState<ExtractionAnnotation[]>([]);
  const [transitions, setTransitions] = useState<InferredTransition[]>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Vision extraction state - for manual runs
  const [manualVisionResults, setManualVisionResults] =
    useState<VisionExtractionResponse | null>(null);
  const [isRunningVision, setIsRunningVision] = useState(false);
  const [selectedScreenshotForVision, setSelectedScreenshotForVision] =
    useState<string | null>(null);

  // Debugging refs
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const logHeights = () => {
      logger.debug("Layout Debug REFACTORED", {
        windowHeight: window.innerHeight,
        rootContentHeight: rootRef.current?.clientHeight,
        mainContainerHeight: containerRef.current?.clientHeight,
        tabsHeight: tabsRef.current?.clientHeight,
        contentHeight: contentRef.current?.clientHeight,
      });

      if (contentRef.current) {
        const style = window.getComputedStyle(contentRef.current);
        logger.debug("Content computed styles:", {
          height: style.height,
          overflow: style.overflow,
          display: style.display,
        });
      }
    };

    logHeights();
    window.addEventListener("resize", logHeights);
    return () => window.removeEventListener("resize", logHeights);
  }, [mainTab, configSubTab, resultsSubTab]);

  // Aggregate vision results from annotations
  const annotationVisionResults = useMemo(
    () => aggregateVisionResults(annotations),
    [annotations]
  );

  // Prefer annotation vision results, fall back to manually run results
  const visionResults = annotationVisionResults || manualVisionResults;

  // Get states from state_machine (pre-built by runner), or fallback to annotation states
  const stateMachineStates: StateMachineState[] = useMemo(
    () => buildStateMachineStates(extractionDetail, annotations),
    // Only re-compute when the specific nested field changes, not the whole object
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extractionDetail?.state_machine?.states, annotations]
  );

  // Auto-select the most recent extraction when extractions load
  useEffect(() => {
    const firstExtraction = extractions?.[0];
    if (firstExtraction && !activeExtractionId) {
      // Select the most recent extraction (first in the list, assuming sorted by date desc)
      setActiveExtractionId(firstExtraction.id);
    }
  }, [extractions, activeExtractionId]);

  // Load extraction detail when an extraction is selected
  useEffect(() => {
    if (!activeExtractionId) {
      setExtractionDetail(null);
      setAnnotations([]);
      setTransitions([]);
      return;
    }

    loadExtractionDetail(activeExtractionId);
  }, [activeExtractionId]);

  // Poll for updates when extraction is running
  useEffect(() => {
    if (!activeExtractionId || !extractionDetail) return;
    if (
      extractionDetail.status !== "running" &&
      extractionDetail.status !== "pending"
    ) {
      return;
    }

    const interval = setInterval(() => {
      loadExtractionDetail(activeExtractionId, true); // silent poll
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExtractionId, extractionDetail?.status]);

  const loadExtractionDetail = async (extractionId: string, silent = false) => {
    try {
      // Only show loading spinner on initial load, not on polls
      if (!silent) {
        setIsLoadingDetail(true);
      }
      const detail = await extractionService.getExtractionDetail(extractionId);
      setExtractionDetail(detail);

      // Load annotations and transitions if extraction is completed
      if (detail.status === "completed") {
        const annots = await extractionService.getAnnotations(extractionId);
        // Debug: log annotation screenshot_ids
        logger.debug("annotations loaded:", annots.length);
        logger.debug(
          "annotation screenshot_ids:",
          annots.map((a) => a.screenshot_id)
        );
        setAnnotations(annots);
        // Load transitions from detail (if available)
        setTransitions(detail.transitions || []);
      }
    } catch (error) {
      logger.error("Failed to load extraction detail:", error);
      if (!silent) {
        toast.error("Failed to load extraction details");
      }
    } finally {
      if (!silent) {
        setIsLoadingDetail(false);
      }
    }
  };

  const handleStartExtraction = async (config: ExtractionSessionCreate) => {
    if (!projectId) {
      toast.error("No project selected");
      return;
    }

    try {
      // First check if runner is available
      const runnerAvailable = await runnerClient.isAvailable();
      if (!runnerAvailable) {
        toast.error(
          "Desktop Runner is not connected. Please start the qontinui-runner application to perform web extraction."
        );
        return;
      }

      // Create the session in the backend
      const result = await createExtraction.mutateAsync({
        projectId,
        data: config,
      });

      setActiveExtractionId(result.id);
      // Switch to Results tab when extraction starts
      setMainTab("results");

      // Now trigger the actual extraction on the runner
      const extractionCfg = config.config ?? {};
      logger.debug("Starting extraction with config:", extractionCfg);
      // Hand the runner the Cognito access token the app already holds; the
      // backend accepts it directly. `null` when unauthenticated → omitted.
      const authToken = authService.tokenManager.getAccessToken();
      const runnerResult = await runnerClient.startExtraction({
        urls: config.source_urls,
        viewports: extractionCfg.viewports ?? [[1920, 1080]],
        capture_hover_states: extractionCfg.capture_hover_states ?? true,
        capture_focus_states: extractionCfg.capture_focus_states ?? true,
        max_depth: extractionCfg.max_depth ?? 5,
        max_pages: extractionCfg.max_pages ?? 100,
        session_id: result.id,
        backend_url: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
        auth_token: authToken || undefined,
      });

      if (!runnerResult.success) {
        logger.error("Runner extraction failed:", runnerResult.error);
        toast.error(
          `Failed to start extraction on runner: ${runnerResult.error || "Unknown error"}`
        );
        // Mark session as failed since runner couldn't start it
        try {
          await extractionService.updateExtraction(result.id, {
            status: "failed",
            error_message:
              runnerResult.error || "Failed to start extraction on runner",
          });
        } catch (updateError) {
          logger.error("Failed to update extraction status:", updateError);
        }
        return;
      }

      toast.success("Extraction started successfully");
    } catch (error) {
      logger.error("Failed to start extraction:", error);
      toast.error("Failed to start extraction");
    }
  };

  const handleInitiateGlobalExtraction = () => {
    // Convert selected monitor indices to viewport dimensions
    const viewports = extractionConfig.config.selectedMonitors.map(
      (monitorIndex) => {
        const monitor = runnerMonitors.find((m) => m.index === monitorIndex);
        if (monitor) {
          return [monitor.width, monitor.height] as [number, number];
        }
        return DEFAULT_VIEWPORT;
      }
    );

    // URL Validation
    const validUrls = extractionConfig.config.urls.filter(
      (u) => u.trim() !== ""
    );
    if (validUrls.length === 0) {
      toast.error("Please add at least one URL to extract");
      setMainTab("configuration");
      return;
    }

    for (const url of validUrls) {
      try {
        new URL(url);
      } catch (_e) {
        toast.error(`Invalid URL detected: ${url}`);
        setMainTab("configuration");
        return;
      }
    }

    // Collect values from the persistent config hook
    const config: ExtractionSessionCreate = {
      source_urls: validUrls,
      config: {
        viewports,
        capture_hover_states: extractionConfig.config.captureHover,
        capture_focus_states: extractionConfig.config.captureFocus,
        max_depth: extractionConfig.config.maxDepth,
        max_pages: extractionConfig.config.maxPages,
        auth_cookies: {},
      },
    };

    handleStartExtraction(config);
  };

  const handleSelectPreviousExtraction = (extractionId: string) => {
    setActiveExtractionId(extractionId);
    setMainTab("results");
  };

  const handleDeleteExtraction = async (extractionId: string) => {
    if (!projectId) return;

    try {
      await deleteExtraction.mutateAsync({ extractionId, projectId });
      toast.success("Extraction deleted");
      if (activeExtractionId === extractionId) {
        setActiveExtractionId(null);
        setExtractionDetail(null);
        setAnnotations([]);
        setTransitions([]);
      }
    } catch (error) {
      logger.error("Failed to delete extraction:", error);
      toast.error("Failed to delete extraction");
    }
  };

  const handleDeleteAllExtractions = async () => {
    if (!projectId || !extractions || extractions.length === 0) return;

    setIsDeletingAll(true);
    try {
      // Delete all extractions in parallel
      await Promise.all(
        extractions.map((extraction) =>
          deleteExtraction.mutateAsync({
            extractionId: extraction.id,
            projectId,
          })
        )
      );
      toast.success(`Deleted ${extractions.length} extraction(s)`);
      // Clear active extraction state
      setActiveExtractionId(null);
      setExtractionDetail(null);
      setAnnotations([]);
      setTransitions([]);
    } catch (error) {
      logger.error("Failed to delete all extractions:", error);
      toast.error("Failed to delete some extractions");
    } finally {
      setIsDeletingAll(false);
    }
  };

  // Handle Playwright state collector extraction
  const handleStartPlaywrightExtraction = async (
    config: PlaywrightCollectorConfigState
  ) => {
    try {
      // Derive dry_run from maxRiskLevel
      const isDryRun = config.maxRiskLevel === "dry_run";
      // Map risk level: dry_run behaves like safe mode for element identification
      const riskLevel: "safe" | "caution" = isDryRun
        ? "safe"
        : config.maxRiskLevel === "caution"
          ? "caution"
          : "safe";

      await startPlaywrightExtraction({
        url: config.url,
        max_depth: config.maxDepth,
        max_elements_per_page: config.maxElementsPerPage,
        max_risk_level: riskLevel,
        dry_run: isDryRun,
        additional_blocked_keywords: config.dangerousKeywords,
        additional_safe_keywords: config.safeKeywords,
        blocked_selectors: config.blockedSelectors,
        verify_extractions: config.verifyExtractions,
        verification_threshold: config.verificationThreshold,
      });
      toast.success("Playwright extraction started");
      // Switch to results tab and playwright sub-tab
      setMainTab("results");
      setResultsSubTab("playwright");
    } catch (error) {
      logger.error("Failed to start Playwright extraction:", error);
      toast.error(
        "Failed to start Playwright extraction. Make sure the runner is running."
      );
    }
  };

  // Run vision extraction on a screenshot (manual fallback)
  const handleRunVisionExtraction = async (screenshotBase64: string) => {
    setIsRunningVision(true);
    setSelectedScreenshotForVision(screenshotBase64);
    try {
      const service = getVisionExtractionService();
      const results = await service.extract({
        screenshot: screenshotBase64,
        techniques: ["edge", "sam3", "ocr"],
      });
      setManualVisionResults(results);
      toast.success(
        `Vision extraction complete: ${results.edge_results.length} edges, ${results.sam3_results.length} segments, ${results.ocr_results.length} text regions`
      );
    } catch (error) {
      logger.error("Vision extraction failed:", error);
      toast.error(
        "Vision extraction failed. Re-run the extraction with Desktop Runner for automatic vision processing."
      );
    } finally {
      setIsRunningVision(false);
    }
  };

  return {
    projectId,
    extractions,
    createExtraction,
    extractionConfig,
    isDeletingAll,
    mainTab,
    setMainTab,
    configSubTab,
    setConfigSubTab,
    resultsSubTab,
    setResultsSubTab,
    playwrightJob: playwrightJob ?? null,
    isStartingPlaywright,
    isPollingPlaywright,
    playwrightResults,
    activeExtractionId,
    extractionDetail,
    annotations,
    transitions,
    isLoadingDetail,
    visionResults,
    isRunningVision,
    selectedScreenshotForVision,
    stateMachineStates,
    rootRef,
    containerRef,
    tabsRef,
    contentRef,
    handleStartExtraction,
    handleInitiateGlobalExtraction,
    handleSelectPreviousExtraction,
    handleDeleteExtraction,
    handleDeleteAllExtractions,
    handleStartPlaywrightExtraction,
    handleRunVisionExtraction,
  };
}

export type WebExtractionState = ReturnType<typeof useWebExtractionState>;
