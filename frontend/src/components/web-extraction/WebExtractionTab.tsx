/**
 * Web Extraction Tab Component
 *
 * Main component that orchestrates the web extraction workflow:
 * 1. Configure extraction settings (URLs, viewports, options) - persisted until logout
 * 2. Create and start extraction session
 * 3. Monitor extraction progress
 * 4. View and select discovered states
 * 5. Import states into project
 */

"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useProjectLoader } from "@/hooks/use-project-loader";
import {
  useExtractions,
  useCreateExtraction,
  useDeleteExtraction,
} from "@/hooks/use-extractions";
import { extractionService } from "@/services/service-factory";
import { ExtractionConfigPanel } from "./ExtractionConfigPanel";
import { ExtractionProgressBar } from "./ExtractionProgressBar";
import { StateExplorerView } from "./StateExplorerView";
import { PageAnalysisView } from "./PageAnalysisView";
import { TransitionsView } from "./TransitionsView";
import { PlaywrightCollectorConfig } from "./PlaywrightCollectorConfig";
import type { PlaywrightCollectorConfigState } from "./PlaywrightCollectorConfig";
import { PlaywrightResultsView } from "./PlaywrightResultsView";
import { PlaywrightStateExplorerView } from "./PlaywrightStateExplorerView";
import { usePlaywrightExtraction } from "@/hooks/use-playwright-extraction";
import { EdgeDetectionView } from "../vision-extraction/EdgeDetectionView";
import { SAM3SegmentationView } from "../vision-extraction/SAM3SegmentationView";
import { OCRDetectionView } from "../vision-extraction/OCRDetectionView";
import {
  getVisionExtractionService,
  type VisionExtractionResponse,
} from "@/services/vision-extraction-service";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  AlertCircle,
  Trash2,
  Layers,
  FileImage,
  GitBranch,
  Grid3X3,
  ScanLine,
  Type,
  Play,
  Clock,
  CheckCircle2,
  XCircle,
  MousePointerClick,
  Globe,
} from "lucide-react";
import { toast } from "sonner";
import { runnerClient } from "@/lib/runner-client";
import { useAuth } from "@/contexts/auth-context";
import { useExtractionConfig } from "@/hooks/use-extraction-config";
import { useRunnerMonitors } from "@/hooks/useRunnerMonitors";
import type {
  ExtractionSessionCreate,
  ExtractionSessionDetail,
  ExtractionAnnotation,
} from "@/services/extraction-service";
import type {
  StateMachineState,
  StateMachineStateImage,
  ElementAnnotation,
  InferredTransition,
} from "@/types/extraction";

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

export default function WebExtractionTab() {
  const { projectId } = useProjectLoader();
  const { data: extractions } = useExtractions(projectId || "", !!projectId);
  const createExtraction = useCreateExtraction();
  const deleteExtraction = useDeleteExtraction();
  const { getAccessToken } = useAuth();

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
      console.log("--- WebExtraction Layout Debug REFACTORED ---");
      console.log("Window height:", window.innerHeight);
      console.log("Root content height:", rootRef.current?.clientHeight);
      console.log("Main container height:", containerRef.current?.clientHeight);
      console.log("Tabs height:", tabsRef.current?.clientHeight);
      console.log("Content height:", contentRef.current?.clientHeight);

      if (contentRef.current) {
        const style = window.getComputedStyle(contentRef.current);
        console.log("Content computed height:", style.height);
        console.log("Content overflow:", style.overflow);
        console.log("Content display:", style.display);
      }
    };

    logHeights();
    window.addEventListener("resize", logHeights);
    return () => window.removeEventListener("resize", logHeights);
  }, [mainTab, configSubTab, resultsSubTab]);

  // Get vision results from annotations (populated by runner during extraction)
  // Aggregate results from all annotations that have vision_results
  const annotationVisionResults = useMemo(() => {
    if (!annotations || annotations.length === 0) return null;

    // Find first annotation with vision results (typically all will have them or none)
    const annotationWithVision = annotations.find((a) => a.vision_results);
    if (!annotationWithVision?.vision_results) return null;

    // Aggregate all vision results from all annotations
    const aggregated: VisionExtractionResponse = {
      screenshot_id: annotationWithVision.screenshot_id,
      image_width: annotationWithVision.viewport_width,
      image_height: annotationWithVision.viewport_height,
      edge_results: [],
      sam3_results: [],
      ocr_results: [],
      merged_candidates: [],
      edge_overlay: null,
      sam3_overlay: null,
      ocr_overlay: null,
      techniques_run: [],
      processing_time_ms: 0,
    };

    for (const annotation of annotations) {
      if (!annotation.vision_results) continue;
      const vr = annotation.vision_results;

      // Add results (with prefixed IDs to avoid collisions)
      // Cast to the expected types since vision_results comes from JSON storage
      if (vr.edge_results) {
        for (const r of vr.edge_results) {
          aggregated.edge_results.push({
            ...r,
            id: `${annotation.screenshot_id}-${r.id || Math.random().toString(36).slice(2)}`,
          } as (typeof aggregated.edge_results)[number]);
        }
      }
      if (vr.sam3_results) {
        for (const r of vr.sam3_results) {
          aggregated.sam3_results.push({
            ...r,
            id: `${annotation.screenshot_id}-${r.id || Math.random().toString(36).slice(2)}`,
          } as (typeof aggregated.sam3_results)[number]);
        }
      }
      if (vr.ocr_results) {
        for (const r of vr.ocr_results) {
          aggregated.ocr_results.push({
            ...r,
            id: `${annotation.screenshot_id}-${r.id || Math.random().toString(36).slice(2)}`,
          } as (typeof aggregated.ocr_results)[number]);
        }
      }
      if (vr.merged_candidates) {
        aggregated.merged_candidates.push(
          ...(vr.merged_candidates as unknown as typeof aggregated.merged_candidates)
        );
      }

      // Use first available overlay
      if (!aggregated.edge_overlay && vr.edge_overlay) {
        aggregated.edge_overlay = vr.edge_overlay;
      }
      if (!aggregated.sam3_overlay && vr.sam3_overlay) {
        aggregated.sam3_overlay = vr.sam3_overlay;
      }
      if (!aggregated.ocr_overlay && vr.ocr_overlay) {
        aggregated.ocr_overlay = vr.ocr_overlay;
      }

      // Aggregate techniques and time
      if (vr.techniques_run) {
        for (const t of vr.techniques_run) {
          if (!aggregated.techniques_run.includes(t)) {
            aggregated.techniques_run.push(t);
          }
        }
      }
      if (vr.duration_ms) {
        aggregated.processing_time_ms += vr.duration_ms;
      }
    }

    return aggregated;
  }, [annotations]);

  // Prefer annotation vision results, fall back to manually run results
  const visionResults = annotationVisionResults || manualVisionResults;

  // Get states from state_machine (pre-built by runner), or fallback to annotation states
  const stateMachineStates: StateMachineState[] = useMemo(() => {
    // First try: use pre-built state machine from runner
    if (extractionDetail?.state_machine?.states?.length) {
      // Process pre-built states to ensure unique stateImage IDs
      // The runner may create stateImages with duplicate IDs when the same element
      // appears on multiple screenshots. We need to make IDs unique.
      let globalImageIndex = 0;

      const processedStates = extractionDetail.state_machine.states.map(
        (state) => ({
          ...state,
          stateImages: state.stateImages.map((img) => {
            globalImageIndex++;
            // Create a truly unique ID by combining state id, image index, and global counter
            const uniqueId = `${state.id}-img-${globalImageIndex}`;
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

    // Fallback: convert annotation states to StateMachineState format
    // Group states by NAME (not ID) to deduplicate across pages
    // Use elements within each state as separate stateImages
    if (annotations.length > 0) {
      // Track state occurrences grouped by name
      interface StateOccurrence {
        stateId: string;
        stateName: string;
        stateBbox: { x: number; y: number; width: number; height: number };
        elements: ElementAnnotation[];
        screenshotId: string;
        sourceUrl: string;
      }

      const statesByName = new Map<string, StateOccurrence[]>();

      for (const annotation of annotations) {
        // Build element lookup for this annotation
        const elementMap = new Map<string, ElementAnnotation>();
        for (const element of annotation.elements || []) {
          elementMap.set(element.id, element);
        }

        for (const state of annotation.states || []) {
          const stateName = state.name || "Unknown State";

          // Get elements for this state
          const stateElements: ElementAnnotation[] = [];
          for (const elementId of state.element_ids || []) {
            const element = elementMap.get(elementId);
            if (element) {
              stateElements.push(element);
            }
          }

          // Add to grouped states
          if (!statesByName.has(stateName)) {
            statesByName.set(stateName, []);
          }
          statesByName.get(stateName)!.push({
            stateId: state.id,
            stateName,
            stateBbox: state.bbox || { x: 0, y: 0, width: 200, height: 80 },
            elements: stateElements,
            screenshotId: annotation.screenshot_id,
            sourceUrl: annotation.source_url,
          });
        }
      }

      // Convert grouped states to StateMachineState format
      const result: StateMachineState[] = [];
      let stateIndex = 0;

      for (const [stateName, occurrences] of statesByName) {
        // Use the first occurrence as the representative state
        const firstOccurrence = occurrences[0];
        if (!firstOccurrence) continue;

        const stateBbox = firstOccurrence.stateBbox;

        // Collect all unique elements across all occurrences as stateImages
        const stateImages: StateMachineStateImage[] = [];
        const seenElementNames = new Set<string>();

        for (const occurrence of occurrences) {
          if (occurrence.elements.length > 0) {
            // Use elements as individual images within the state
            for (const element of occurrence.elements) {
              const elementName =
                element.name ||
                element.text ||
                element.element_type ||
                "Element";

              // Skip duplicates by name within the same screenshot
              // (same element on different screenshots needs separate entries with correct bboxes)
              const dedupeKey = `${occurrence.screenshotId}-${elementName}`;
              if (seenElementNames.has(dedupeKey)) continue;
              seenElementNames.add(dedupeKey);

              const elementBbox = element.bbox || stateBbox;
              // Use screenshotId in IDs to ensure uniqueness across screenshots
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

        // If no elements found, use the state bbox as the only image
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
  }, [extractionDetail?.state_machine?.states, annotations]);

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
        console.log("[WebExtractionTab] annotations loaded:", annots.length);
        console.log(
          "[WebExtractionTab] annotation screenshot_ids:",
          annots.map((a) => a.screenshot_id)
        );
        setAnnotations(annots);
        // Load transitions from detail (if available)
        setTransitions(detail.transitions || []);
      }
    } catch (error) {
      console.error("Failed to load extraction detail:", error);
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
      const extractionConfig = config.config ?? {};
      console.log(
        "[WebExtractionTab] Starting extraction with config:",
        extractionConfig
      );
      const authToken = await getAccessToken();
      const runnerResult = await runnerClient.startExtraction({
        urls: config.source_urls,
        viewports: extractionConfig.viewports ?? [[1920, 1080]],
        capture_hover_states: extractionConfig.capture_hover_states ?? true,
        capture_focus_states: extractionConfig.capture_focus_states ?? true,
        max_depth: extractionConfig.max_depth ?? 5,
        max_pages: extractionConfig.max_pages ?? 100,
        session_id: result.id,
        backend_url: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
        auth_token: authToken || undefined,
      });

      if (!runnerResult.success) {
        console.error("Runner extraction failed:", runnerResult.error);
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
          console.error("Failed to update extraction status:", updateError);
        }
        return;
      }

      toast.success("Extraction started successfully");
    } catch (error) {
      console.error("Failed to start extraction:", error);
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
      console.error("Failed to delete extraction:", error);
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
      console.error("Failed to delete all extractions:", error);
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
      console.error("Failed to start Playwright extraction:", error);
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
      console.error("Vision extraction failed:", error);
      toast.error(
        "Vision extraction failed. Re-run the extraction with Desktop Runner for automatic vision processing."
      );
    } finally {
      setIsRunningVision(false);
    }
  };

  // Helper function to render extraction history sidebar
  const renderExtractionHistory = () => (
    <div className="explorer-panel explorer-panel-primary h-full">
      <div className="explorer-panel-header">
        <div className="flex items-center gap-2 flex-1">
          <Clock className="h-4 w-4 text-brand-primary" />
          <span className="explorer-panel-header-title">History</span>
        </div>
        {extractions && extractions.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDeleteAllExtractions}
            disabled={isDeletingAll}
            className="text-red-400/60 hover:text-red-400 hover:bg-red-500/10 h-8 px-2 text-[10px] font-mono"
          >
            {isDeletingAll ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3 mr-1" />
            )}
            PURGE
          </Button>
        )}
      </div>

      <ScrollArea className="explorer-panel-content">
        <div className="p-4 space-y-3">
          {extractions && extractions.length > 0 ? (
            <div className="space-y-2">
              {extractions.map((extraction) => {
                const isSelected = activeExtractionId === extraction.id;
                const status = extraction.status;
                return (
                  <div
                    key={extraction.id}
                    className={`
                      p-3 rounded-lg border transition-all cursor-pointer group relative
                      ${
                        isSelected
                          ? "explorer-panel-item-selected"
                          : "explorer-panel-item"
                      }
                    `}
                    onClick={() =>
                      handleSelectPreviousExtraction(extraction.id)
                    }
                  >
                    <div className="flex items-start justify-between mb-2 gap-2">
                      <div
                        className={`font-mono text-xs truncate transition-colors ${isSelected ? "text-brand-primary" : "text-text-secondary group-hover:text-brand-primary"}`}
                      >
                        {extraction.source_urls[0]}
                        {extraction.source_urls.length > 1 &&
                          ` +${extraction.source_urls.length - 1}`}
                      </div>
                      <div className="shrink-0">
                        {status === "completed" ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-brand-success" />
                        ) : status === "failed" ? (
                          <XCircle className="w-3.5 h-3.5 text-red-500" />
                        ) : (
                          <Loader2 className="w-3.5 h-3.5 text-brand-primary animate-spin" />
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 mb-2">
                      <span className="badge badge-primary text-[9px] px-1.5 py-0">
                        {extraction.stats.pages_extracted || 0} PG
                      </span>
                      <span className="badge badge-secondary text-[9px] px-1.5 py-0">
                        {extraction.stats.states_found || 0} ST
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="text-caption font-mono italic">
                        {new Date(extraction.created_at).toLocaleDateString(
                          [],
                          { month: "short", day: "numeric" }
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteExtraction(extraction.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <Clock className="empty-state-icon" />
              <p className="text-caption font-mono uppercase tracking-widest">
                Archive Empty
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );

  if (!projectId) {
    return (
      <div className="p-8">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please select a project to use web extraction.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Check if there's an active or completed extraction to show results
  const hasActiveExtraction = !!activeExtractionId;
  const extractionIsComplete = extractionDetail?.status === "completed";

  return (
    <div
      ref={rootRef}
      className="layout-full-height bg-surface-canvas relative web-extraction-root"
    >
      {/* Background dot grid pattern */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle, oklch(0.3 0.1 270) 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
        }}
      />

      {/* Main content */}
      <div className="relative z-10 layout-full-height">
        {/* Header */}
        <header className="border-b border-brand-primary/20 bg-surface-canvas/90 backdrop-blur-sm shrink-0">
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-brand-primary/60 font-mono uppercase tracking-widest pt-1">
                Web Extraction
              </span>
            </div>
          </div>
        </header>

        {/* Tabs & Content */}
        <div
          ref={containerRef}
          className="container mx-auto px-6 py-6 layout-full-height"
        >
          <Tabs
            ref={tabsRef}
            value={mainTab}
            onValueChange={(v) => setMainTab(v as MainTab)}
            className="w-full layout-full-height"
          >
            <div className="flex items-center gap-3 mb-6 shrink-0">
              <TabsList className="bg-surface-raised/80 border border-brand-primary/20 p-1 backdrop-blur-sm h-11">
                <TabsTrigger
                  value="configuration"
                  className="data-[state=active]:bg-brand-primary/20 data-[state=active]:text-brand-primary data-[state=active]:shadow-[0_0_20px_rgba(0,217,255,0.3)] font-mono px-6 h-9 transition-all"
                >
                  Configuration
                </TabsTrigger>
                <TabsTrigger
                  value="results"
                  className="data-[state=active]:bg-brand-secondary/20 data-[state=active]:text-brand-secondary data-[state=active]:shadow-[0_0_20px_rgba(189,0,255,0.3)] font-mono px-6 h-9 transition-all"
                >
                  Results
                  {hasActiveExtraction && extractionDetail && (
                    <Badge
                      variant={
                        extractionDetail?.status === "completed"
                          ? "default"
                          : extractionDetail?.status === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                      className="ml-2 scale-75 origin-left"
                    >
                      {extractionDetail?.status}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              <Button
                onClick={handleInitiateGlobalExtraction}
                disabled={createExtraction.isPending}
                className="bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/20 border border-brand-primary/40 font-mono h-11 px-6 shadow-[0_0_15px_rgba(0,217,255,0.1)] hover:shadow-[0_0_20px_rgba(0,217,255,0.2)] transition-all"
              >
                {createExtraction.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    EXTRACTING...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2 fill-current" />
                    Start Extraction
                  </>
                )}
              </Button>
            </div>

            {/* Configuration Tab */}
            <TabsContent
              value="configuration"
              className="mt-0 layout-full-height data-[state=inactive]:hidden"
            >
              {/* Configuration Sub-tabs */}
              <Tabs
                ref={contentRef}
                value={configSubTab}
                onValueChange={(v) => setConfigSubTab(v as ConfigSubTab)}
                className="layout-full-height"
              >
                <TabsList className="bg-surface-raised/80 border border-brand-primary/20 p-1 backdrop-blur-sm w-fit mb-4 shrink-0">
                  <TabsTrigger
                    value="dom-extraction"
                    className="data-[state=active]:bg-brand-primary/20 data-[state=active]:text-brand-primary font-mono flex items-center gap-2"
                  >
                    <Globe className="h-4 w-4" />
                    DOM Extraction
                  </TabsTrigger>
                  <TabsTrigger
                    value="playwright-collector"
                    className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400 font-mono flex items-center gap-2"
                  >
                    <MousePointerClick className="h-4 w-4" />
                    State Collector
                    {playwrightJob && (
                      <Badge
                        variant={
                          playwrightJob.status === "completed"
                            ? "default"
                            : playwrightJob.status === "failed"
                              ? "destructive"
                              : "secondary"
                        }
                        className="ml-1 scale-75"
                      >
                        {playwrightJob.status}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>

                {/* DOM Extraction Config Sub-tab */}
                <TabsContent
                  value="dom-extraction"
                  className="flex-1 h-full flex flex-col mt-0 min-h-0 overflow-hidden data-[state=inactive]:hidden"
                >
                  <div className="grid grid-cols-1 lg:grid-cols-3 grid-rows-[1fr] gap-6 h-full">
                    {/* Left: Configuration Panel (2 columns) */}
                    <div className="lg:col-span-2 h-full min-h-0">
                      <ScrollArea className="h-full pr-4">
                        <ExtractionConfigPanel
                          extractionConfig={extractionConfig}
                        />
                      </ScrollArea>
                    </div>

                    {/* Right: Previous Extractions Sidebar (1 column) */}
                    <div className="lg:col-span-1 min-h-0 overflow-hidden">
                      {renderExtractionHistory()}
                    </div>
                  </div>
                </TabsContent>

                {/* Playwright State Collector Config Sub-tab */}
                <TabsContent
                  value="playwright-collector"
                  className="flex-1 h-full flex flex-col mt-0 min-h-0 overflow-hidden data-[state=inactive]:hidden"
                >
                  <div className="grid grid-cols-1 lg:grid-cols-3 grid-rows-[1fr] gap-6 h-full">
                    {/* Left: Playwright Config Panel (2 columns) */}
                    <div className="lg:col-span-2 h-full min-h-0">
                      <ScrollArea className="h-full pr-4 text-green-400">
                        <PlaywrightCollectorConfig
                          onStartExtraction={handleStartPlaywrightExtraction}
                          isLoading={
                            isStartingPlaywright || isPollingPlaywright
                          }
                        />
                      </ScrollArea>
                    </div>

                    {/* Right: Info Panel (1 column) */}
                    <div className="lg:col-span-1 min-h-0 overflow-hidden">
                      <Card className="bg-surface-raised/60 border-green-500/20 backdrop-blur-sm h-full overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-green-500/10 shrink-0">
                          <div className="flex items-center gap-2">
                            <MousePointerClick className="h-4 w-4 text-green-400" />
                            <Label className="text-green-400 text-base font-mono font-semibold uppercase tracking-wider">
                              About State Collector
                            </Label>
                          </div>
                        </div>
                        <ScrollArea className="flex-1 min-h-0">
                          <div className="p-4 space-y-4 text-sm text-muted-foreground">
                            <p>
                              The Playwright State Collector uses DOM-based
                              detection to identify clickable elements (buttons,
                              links, menu items) and safely navigates through
                              your web application.
                            </p>
                            <div className="space-y-2">
                              <p className="font-medium text-green-400">
                                Safety Features:
                              </p>
                              <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>
                                  Blocks dangerous actions (delete, purchase,
                                  logout)
                                </li>
                                <li>Auto-dismisses confirmation dialogs</li>
                                <li>Customizable keyword blocklist</li>
                                <li>Dry run mode for safe exploration</li>
                              </ul>
                            </div>
                            <div className="space-y-2">
                              <p className="font-medium text-green-400">
                                Verification:
                              </p>
                              <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>
                                  Pattern matching validates extracted images
                                </li>
                                <li>
                                  Only verified elements are recommended for use
                                </li>
                                <li>Confidence scores indicate reliability</li>
                              </ul>
                            </div>
                            <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
                              <p className="text-xs text-yellow-400">
                                <strong>Note:</strong> This feature requires the
                                runner to be running on port 9876.
                              </p>
                            </div>
                          </div>
                        </ScrollArea>
                      </Card>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </TabsContent>

            {/* Results Tab */}
            <TabsContent
              value="results"
              className="mt-0 layout-full-height gap-4 data-[state=inactive]:hidden"
            >
              {!hasActiveExtraction ? (
                <div className="py-12">
                  <Alert className="bg-surface-raised/60 border-brand-secondary/30 backdrop-blur-sm shadow-[0_0_15px_rgba(189,0,255,0.05)]">
                    <AlertCircle className="h-4 w-4 text-brand-secondary" />
                    <AlertDescription className="text-text-secondary font-mono">
                      PROCESS HALTED: No active extraction detected. Initialize
                      a scan or select a previous entry from the archive.
                    </AlertDescription>
                  </Alert>
                </div>
              ) : isLoadingDetail ? (
                <div className="flex items-center justify-center py-24">
                  <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-12 w-12 animate-spin text-brand-secondary" />
                    <p className="text-brand-secondary font-mono animate-pulse uppercase tracking-widest text-xs">
                      Synchronizing Buffer...
                    </p>
                  </div>
                </div>
              ) : !extractionDetail ? (
                <Alert className="bg-red-500/10 border-red-500/30">
                  <AlertCircle className="h-4 w-4 text-red-500" />
                  <AlertDescription className="text-red-400 font-mono">
                    ERROR: Failed to retrieve extraction telemetry.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  {/* Extraction Progress Bar - single horizontal line */}
                  <ExtractionProgressBar session={extractionDetail} />

                  {/* Results Sub-tabs */}
                  {extractionIsComplete && (
                    <Tabs
                      value={resultsSubTab}
                      onValueChange={(v) =>
                        setResultsSubTab(v as ResultsSubTab)
                      }
                      className="layout-full-height"
                    >
                      <TabsList className="bg-surface-raised/80 border border-brand-success/20 p-1 backdrop-blur-sm w-fit mb-4">
                        <TabsTrigger
                          value="state-explorer"
                          className="data-[state=active]:bg-brand-primary/20 data-[state=active]:text-brand-primary font-mono flex items-center gap-2"
                        >
                          <Layers className="h-4 w-4" />
                          DOM States
                        </TabsTrigger>
                        <TabsTrigger
                          value="page-analysis"
                          className="data-[state=active]:bg-brand-success/20 data-[state=active]:text-brand-success font-mono flex items-center gap-2"
                        >
                          <FileImage className="h-4 w-4" />
                          DOM Elements
                        </TabsTrigger>
                        <TabsTrigger
                          value="transitions"
                          className="data-[state=active]:bg-brand-secondary/20 data-[state=active]:text-brand-secondary font-mono flex items-center gap-2"
                        >
                          <GitBranch className="h-4 w-4" />
                          Transitions
                          {transitions.length > 0 && (
                            <Badge
                              variant="outline"
                              className="ml-2 bg-brand-secondary/5 text-brand-secondary border-brand-secondary/20"
                            >
                              {transitions.length}
                            </Badge>
                          )}
                        </TabsTrigger>
                        <TabsTrigger
                          value="sam3"
                          className="data-[state=active]:bg-brand-success/10 font-mono flex items-center gap-2"
                        >
                          <Grid3X3 className="h-4 w-4" />
                          SAM3
                          {visionResults && (
                            <Badge
                              variant="outline"
                              className="ml-2 bg-brand-success/5 text-brand-success border-brand-success/20"
                            >
                              {visionResults.sam3_results.length}
                            </Badge>
                          )}
                        </TabsTrigger>
                        <TabsTrigger
                          value="edge"
                          className="data-[state=active]:bg-brand-success/10 font-mono flex items-center gap-2"
                        >
                          <ScanLine className="h-4 w-4" />
                          Edge
                          {visionResults && (
                            <Badge
                              variant="outline"
                              className="ml-2 bg-brand-success/5 text-brand-success border-brand-success/20"
                            >
                              {visionResults.edge_results.length}
                            </Badge>
                          )}
                        </TabsTrigger>
                        <TabsTrigger
                          value="ocr"
                          className="data-[state=active]:bg-brand-success/10 font-mono flex items-center gap-2"
                        >
                          <Type className="h-4 w-4" />
                          OCR
                          {visionResults && (
                            <Badge
                              variant="outline"
                              className="ml-2 bg-brand-success/5 text-brand-success border-brand-success/20"
                            >
                              {visionResults.ocr_results.length}
                            </Badge>
                          )}
                        </TabsTrigger>
                        <TabsTrigger
                          value="playwright"
                          className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400 font-mono flex items-center gap-2"
                        >
                          <MousePointerClick className="h-4 w-4" />
                          State Collector
                          {playwrightJob && (
                            <Badge
                              variant={
                                playwrightJob.status === "completed"
                                  ? "default"
                                  : playwrightJob.status === "failed"
                                    ? "destructive"
                                    : "secondary"
                              }
                              className="ml-1 scale-75"
                            >
                              {playwrightJob.status}
                            </Badge>
                          )}
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent
                        value="state-explorer"
                        className="flex-1 flex flex-col min-h-0 mt-0 data-[state=inactive]:hidden"
                      >
                        <StateExplorerView
                          states={stateMachineStates}
                          annotations={annotations}
                          extractionId={
                            extractionDetail?.stats?.screenshot_extraction_id ||
                            activeExtractionId ||
                            undefined
                          }
                        />
                      </TabsContent>

                      <TabsContent
                        value="page-analysis"
                        className="flex-1 flex flex-col min-h-0 mt-0 data-[state=inactive]:hidden"
                      >
                        <PageAnalysisView
                          states={stateMachineStates}
                          annotations={annotations}
                          extractionId={
                            extractionDetail?.stats?.screenshot_extraction_id ||
                            activeExtractionId ||
                            undefined
                          }
                        />
                      </TabsContent>

                      <TabsContent
                        value="transitions"
                        className="flex-1 flex flex-col min-h-0 mt-0 data-[state=inactive]:hidden"
                      >
                        <TransitionsView
                          transitions={transitions}
                          states={stateMachineStates}
                        />
                      </TabsContent>

                      <TabsContent value="sam3" className="flex-1 min-h-0 mt-0">
                        {visionResults ? (
                          <SAM3SegmentationView
                            screenshotSource={selectedScreenshotForVision || ""}
                            segments={visionResults.sam3_results}
                            maskOverlayImage={visionResults.sam3_overlay}
                            imageWidth={visionResults.image_width}
                            imageHeight={visionResults.image_height}
                          />
                        ) : (
                          <VisionExtractionPrompt
                            isRunning={isRunningVision}
                            onRunExtraction={handleRunVisionExtraction}
                            extractionId={
                              extractionDetail?.stats
                                ?.screenshot_extraction_id ||
                              activeExtractionId ||
                              undefined
                            }
                            technique="SAM3 Segmentation"
                          />
                        )}
                      </TabsContent>

                      <TabsContent value="edge" className="flex-1 min-h-0 mt-0">
                        {visionResults ? (
                          <EdgeDetectionView
                            screenshotSource={selectedScreenshotForVision || ""}
                            results={visionResults.edge_results}
                            edgeOverlayImage={visionResults.edge_overlay}
                            imageWidth={visionResults.image_width}
                            imageHeight={visionResults.image_height}
                          />
                        ) : (
                          <VisionExtractionPrompt
                            isRunning={isRunningVision}
                            onRunExtraction={handleRunVisionExtraction}
                            extractionId={
                              extractionDetail?.stats
                                ?.screenshot_extraction_id ||
                              activeExtractionId ||
                              undefined
                            }
                            technique="Edge Detection"
                          />
                        )}
                      </TabsContent>

                      <TabsContent
                        value="ocr"
                        className="layout-full-height mt-0"
                      >
                        {visionResults ? (
                          <OCRDetectionView
                            screenshotSource={selectedScreenshotForVision || ""}
                            results={visionResults.ocr_results}
                            ocrOverlayImage={visionResults.ocr_overlay}
                            imageWidth={visionResults.image_width}
                            imageHeight={visionResults.image_height}
                          />
                        ) : (
                          <VisionExtractionPrompt
                            isRunning={isRunningVision}
                            onRunExtraction={handleRunVisionExtraction}
                            extractionId={
                              extractionDetail?.stats
                                ?.screenshot_extraction_id ||
                              activeExtractionId ||
                              undefined
                            }
                            technique="OCR"
                          />
                        )}
                      </TabsContent>

                      <TabsContent
                        value="playwright"
                        className="mt-0 layout-full-height data-[state=inactive]:hidden"
                      >
                        {playwrightJob?.status === "completed" &&
                        playwrightResults ? (
                          <PlaywrightStateExplorerView
                            results={playwrightResults}
                          />
                        ) : playwrightJob ? (
                          <PlaywrightResultsView
                            job={playwrightJob}
                            results={playwrightResults}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
                            <MousePointerClick className="h-16 w-16 text-green-400/30" />
                            <div className="text-center">
                              <h3 className="text-lg font-medium mb-2 text-green-400">
                                No State Collector Results
                              </h3>
                              <p className="text-sm text-muted-foreground mb-4 max-w-md">
                                Run the Playwright State Collector from the
                                Configuration tab to extract clickable elements
                                and build states for your automation.
                              </p>
                              <Button
                                variant="outline"
                                className="border-green-500/30 text-green-400 hover:bg-green-500/10"
                                onClick={() => {
                                  setMainTab("configuration");
                                  setConfigSubTab("playwright-collector");
                                }}
                              >
                                <MousePointerClick className="h-4 w-4 mr-2" />
                                Go to State Collector
                              </Button>
                            </div>
                          </div>
                        )}
                      </TabsContent>
                    </Tabs>
                  )}

                  {/* Show message if no state machine available */}
                  {extractionIsComplete && stateMachineStates.length === 0 && (
                    <div className="mt-4">
                      <Alert className="bg-surface-raised/60 border-brand-primary/30 backdrop-blur-sm">
                        <AlertCircle className="h-4 w-4 text-brand-primary" />
                        <AlertDescription className="text-text-secondary font-mono">
                          WARNING: State Machine empty. Telmetry might be
                          delayed or unavailable for this session.
                        </AlertDescription>
                      </Alert>
                    </div>
                  )}
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

/**
 * Prompt component for vision extraction when no results available.
 * Allows user to select a screenshot and run vision extraction.
 */
interface VisionExtractionPromptProps {
  isRunning: boolean;
  onRunExtraction: (screenshotBase64: string) => void;
  extractionId?: string;
  technique: string;
}

function VisionExtractionPrompt({
  isRunning,
  onRunExtraction,
  extractionId,
  technique,
}: VisionExtractionPromptProps) {
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(
    null
  );
  const [loadingScreenshot, setLoadingScreenshot] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load screenshot from extraction
  const handleLoadScreenshot = async (screenshotId: string) => {
    if (!extractionId) return;
    setLoadingScreenshot(true);
    try {
      const result = await runnerClient.getExtractionScreenshot(
        extractionId,
        screenshotId
      );
      if (result.success && result.blob) {
        // Convert blob to base64
        const reader = new FileReader();
        reader.onloadend = () => {
          setSelectedScreenshot(reader.result as string);
        };
        reader.readAsDataURL(result.blob);
      } else {
        toast.error(result.error || "Failed to load screenshot");
      }
    } catch (error) {
      console.error("Failed to load screenshot:", error);
      toast.error("Failed to load screenshot");
    } finally {
      setLoadingScreenshot(false);
    }
  };

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      setSelectedScreenshot(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="text-center">
        <h3 className="text-lg font-medium mb-2">Run {technique}</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Select a screenshot to analyze with {technique.toLowerCase()}. Vision
          extraction runs on your desktop via the Runner.
        </p>
      </div>

      {selectedScreenshot ? (
        <div className="flex flex-col items-center gap-4">
          <div className="border rounded-lg overflow-hidden max-w-[600px] max-h-[300px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selectedScreenshot}
              alt="Selected screenshot"
              className="object-contain w-full h-full"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setSelectedScreenshot(null)}
            >
              Clear
            </Button>
            <Button
              onClick={() => onRunExtraction(selectedScreenshot)}
              disabled={isRunning}
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Run {technique}
                </>
              )}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileUpload}
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={loadingScreenshot}
            >
              <FileImage className="mr-2 h-4 w-4" />
              Upload Screenshot
            </Button>
            {extractionId && (
              <Button
                variant="outline"
                onClick={() => handleLoadScreenshot("0")}
                disabled={loadingScreenshot}
              >
                {loadingScreenshot ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileImage className="mr-2 h-4 w-4" />
                )}
                Load from Extraction
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Upload an image or load from the current extraction
          </p>
        </div>
      )}
    </div>
  );
}
