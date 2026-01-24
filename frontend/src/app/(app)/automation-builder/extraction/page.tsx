"use client";

/**
 * Unified Discovery Page
 *
 * Supports multiple discovery/extraction methods:
 * - Web Extraction (DOM-based via Playwright)
 * - UI Bridge States (Co-occurrence analysis from render logs)
 * - UI-TARS Web (Vision-based for websites)
 * - UI-TARS Desktop (Vision-based for native apps)
 * - Image Extraction (Template matching)
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useProjectLoader } from "@/hooks/use-project-loader";
import { useUnifiedExtractionConfig } from "@/hooks/use-unified-extraction-config";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import type { ExtractionMethod } from "@/types/extraction-unified";
import { RequireProject } from "@/components/require-project";
import { runnerClient } from "@/lib/runner-client";
import { ExtractionMethodSelector } from "@/components/extraction/ExtractionMethodSelector";
import { UITarsConfigPanel } from "@/components/extraction/UITarsConfigPanel";
import {
  UITarsProgressPanel,
  type UITarsProgress,
} from "@/components/extraction/UITarsProgressPanel";
import { ExtractionConfigPanel } from "@/components/web-extraction/ExtractionConfigPanel";
import { StateExplorerView } from "@/components/web-extraction/StateExplorerView";
import { extractionService } from "@/services/service-factory";
import { useAuth } from "@/contexts/auth-context";
import { useCreateExtraction } from "@/hooks/use-extractions";
import { useUIBridgeExploration } from "@/hooks/useUIBridgeExploration";
import { ExplorationConfigPanel } from "@/components/ui-bridge/ExplorationConfigPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Loader2,
  Play,
  AlertCircle,
  Info,
  CheckCircle2,
  Layers,
  FileJson,
  Link,
  Save,
  FolderOpen,
  BookOpen,
  Plus,
  X,
  LinkIcon,
  Compass,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import type {
  ExtractionSessionDetail,
  ExtractionAnnotation,
  StateMachineState,
  StateMachineStateImage,
  ElementAnnotation,
} from "@/types/extraction";
import type { RunnerConnection } from "@/types/runner";

type MainTab = "configuration" | "results";

export default function UnifiedExtractionPage() {
  return (
    <RequireProject pageName="Discover">
      <UnifiedExtractionContent />
    </RequireProject>
  );
}

// UI Bridge types
interface UIBridgeElement {
  id: string;
  name: string;
  type: string;
  render_ids: string[];
  tag_name?: string;
  text_content?: string;
  component_name?: string;
}

interface DomainKnowledge {
  id: string;
  project_id: string | null;
  title: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

interface DiscoveredState {
  id: string;
  name: string;
  state_image_ids: string[];
  screenshot_ids: string[];
  confidence: number;
  description?: string;
  domain_knowledge?: DomainKnowledge[];
}

interface StateDiscoveryResult {
  states: DiscoveredState[];
  elements: UIBridgeElement[];
  element_to_renders: Record<string, string[]>;
  render_count: number;
  unique_element_count: number;
}

interface SavedConfig {
  id: string;
  name: string;
  description: string | null;
  render_count: number;
  element_count: number;
  created_at: string;
}

interface SavedState {
  id: string;
  config_id: string;
  state_id: string;
  name: string;
  description: string | null;
  element_ids: string[];
  render_ids: string[];
  confidence: number;
  acceptance_criteria: string[];
  domain_knowledge?: DomainKnowledge[];
}

interface RenderLogSession {
  session_id: string;
  first_timestamp: string;
  last_timestamp: string;
  snapshot_count: number;
  unique_pages: number;
  total_mutations: number;
}

interface RenderLogEntry {
  id: number;
  session_id: string;
  timestamp: string;
  page_url: string;
  page_title: string | null;
  trigger: string;
  mutation_type: string | null;
  snapshot: Record<string, unknown>;
  element_count: number | null;
}

function UnifiedExtractionContent() {
  const { projectId } = useProjectLoader();
  const searchParams = useSearchParams();
  const extractionConfig = useUnifiedExtractionConfig();
  const { getAccessToken } = useAuth();
  const createExtraction = useCreateExtraction();

  // Check for method query param on mount
  const methodFromUrl = searchParams.get("method") as ExtractionMethod | null;
  const methodSetRef = useRef(false);

  const [mainTab, setMainTab] = useState<MainTab>("configuration");
  const [isExtracting, setIsExtracting] = useState(false);
  const [uitarsProgress, setUitarsProgress] = useState<UITarsProgress>({
    status: "idle",
    currentStep: 0,
    maxSteps: 50,
    elapsedSeconds: 0,
    statesDiscovered: 0,
    transitionsDiscovered: 0,
  });
  const [webExtractionProgress, setWebExtractionProgress] = useState<{
    status: "idle" | "running" | "completed" | "failed";
    extractionId: string | null;
    statesFound: number;
    transitionsFound: number;
    pagesExtracted: number;
    errors: number;
    errorMessage?: string;
  }>({
    status: "idle",
    extractionId: null,
    statesFound: 0,
    transitionsFound: 0,
    pagesExtracted: 0,
    errors: 0,
  });
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Extraction data state (for showing results)
  const [extractionDetail, setExtractionDetail] = useState<ExtractionSessionDetail | null>(null);
  const [annotations, setAnnotations] = useState<ExtractionAnnotation[]>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // UI Bridge state
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingConfigs, setIsLoadingConfigs] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<StateDiscoveryResult | null>(null);
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [stateDescriptions, setStateDescriptions] = useState<Record<string, string>>({});
  const [uploadedRenders, setUploadedRenders] = useState<unknown[] | null>(null);
  const [configName, setConfigName] = useState("default");
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [currentSavedConfigId, setCurrentSavedConfigId] = useState<string | null>(null);

  // Domain knowledge state
  const [domainKnowledgeList, setDomainKnowledgeList] = useState<DomainKnowledge[]>([]);
  const [isLoadingKnowledge, setIsLoadingKnowledge] = useState(false);
  const [showKnowledgeDialog, setShowKnowledgeDialog] = useState(false);
  const [newKnowledgeTitle, setNewKnowledgeTitle] = useState("");
  const [newKnowledgeContent, setNewKnowledgeContent] = useState("");
  const [isCreatingKnowledge, setIsCreatingKnowledge] = useState(false);
  const [showLinkKnowledgeDialog, setShowLinkKnowledgeDialog] = useState(false);

  // Track state UUIDs for API calls
  const [stateUuidMap, setStateUuidMap] = useState<Record<string, string>>({});

  // Render log sessions
  const [renderLogSessions, setRenderLogSessions] = useState<RenderLogSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionRenders, setSessionRenders] = useState<unknown[] | null>(null);
  const [isLoadingSessionRenders, setIsLoadingSessionRenders] = useState(false);

  // Exploration hook
  const exploration = useUIBridgeExploration();
  const [explorationRenders, setExplorationRenders] = useState<unknown[] | null>(null);

  // Runner connections for UI Bridge exploration
  const { connections, isLoading: connectionsLoading } = useRealtimeConnections();
  const [selectedConnectionId, setSelectedConnectionId] = useState<number | null>(null);

  // Auto-select first runner when connections load and no selection made
  useEffect(() => {
    if (selectedConnectionId === null && connections.length > 0 && !connectionsLoading) {
      setSelectedConnectionId(connections[0].id);
    }
  }, [connections, connectionsLoading, selectedConnectionId]);

  // Handler for connection change
  const onConnectionChange = useCallback((connectionId: number | null) => {
    setSelectedConnectionId(connectionId);
  }, []);

  // Helper to construct runner URL from connection
  const getRunnerUrl = useCallback((connectionId: number | null): string | null => {
    if (connectionId === null) return null;

    const conn = connections.find(c => c.id === connectionId);
    if (!conn?.ip_address) return null;

    // Handle localhost variations
    const ip = conn.ip_address;
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('localhost')) {
      return 'http://localhost:9876';
    }
    return `http://${ip}:9876`;
  }, [connections]);

  // Get renders to analyze
  const rendersToAnalyze = explorationRenders || sessionRenders || uploadedRenders;

  const { config, setMethod, setUitarsConfig, isLoaded } = extractionConfig;

  // Set method from URL parameter if present (used for redirects from old pages)
  useEffect(() => {
    if (isLoaded && methodFromUrl && !methodSetRef.current) {
      const validMethods: ExtractionMethod[] = ["web", "ui-bridge", "uitars-web", "uitars-desktop", "image"];
      if (validMethods.includes(methodFromUrl)) {
        setMethod(methodFromUrl);
        methodSetRef.current = true;
      }
    }
  }, [isLoaded, methodFromUrl, setMethod]);

  // Load extraction detail and annotations from backend
  const loadExtractionDetail = useCallback(async (extractionId: string, silent = false) => {
    try {
      if (!silent) {
        setIsLoadingDetail(true);
      }
      console.log("[Extraction] Fetching detail for:", extractionId);
      const detail = await extractionService.getExtractionDetail(extractionId);
      console.log("[Extraction] Detail received:", {
        id: detail.id,
        status: detail.status,
        hasStateMachine: !!detail.state_machine,
        statesCount: detail.state_machine?.states?.length ?? 0,
      });
      setExtractionDetail(detail);

      // Load annotations
      console.log("[Extraction] Fetching annotations...");
      const annots = await extractionService.getAnnotations(extractionId);
      console.log("[Extraction] Annotations received:", {
        count: annots.length,
        firstAnnotation: annots[0] ? {
          screenshotId: annots[0].screenshot_id,
          statesCount: annots[0].states?.length ?? 0,
          elementsCount: annots[0].elements?.length ?? 0,
        } : null,
      });
      setAnnotations(annots);
    } catch (error) {
      console.error("[Extraction] Failed to load extraction detail:", error);
      if (!silent) {
        toast.error("Failed to load extraction details");
      }
    } finally {
      if (!silent) {
        setIsLoadingDetail(false);
      }
    }
  }, []);

  // Convert extraction data to StateMachineState format for StateExplorerView
  const stateMachineStates: StateMachineState[] = useMemo(() => {
    // First try: use pre-built state machine from runner
    if (extractionDetail?.state_machine?.states?.length) {
      let globalImageIndex = 0;
      const processedStates = extractionDetail.state_machine.states.map((state) => ({
        ...state,
        stateImages: state.stateImages.map((img) => {
          globalImageIndex++;
          const uniqueId = `${state.id}-img-${globalImageIndex}`;
          return {
            ...img,
            id: uniqueId,
            patterns: img.patterns?.map((p, pIdx) => ({
              ...p,
              id: `${uniqueId}-pattern-${pIdx}`,
            })) || [],
          };
        }),
      }));
      return processedStates;
    }

    // Fallback: convert annotation states to StateMachineState format
    if (annotations.length > 0) {
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
        const elementMap = new Map<string, ElementAnnotation>();
        for (const element of annotation.elements || []) {
          elementMap.set(element.id, element);
        }

        for (const state of annotation.states || []) {
          const stateName = state.name || "Unknown State";
          const stateElements: ElementAnnotation[] = [];
          for (const elementId of state.element_ids || []) {
            const element = elementMap.get(elementId);
            if (element) {
              stateElements.push(element);
            }
          }

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
              const elementName = element.name || element.text || element.element_type || "Element";
              const dedupeKey = `${occurrence.screenshotId}-${elementName}`;
              if (seenElementNames.has(dedupeKey)) continue;
              seenElementNames.add(dedupeKey);

              const elementBbox = element.bbox || stateBbox;
              const uniqueId = `${occurrence.screenshotId}-${element.id}`;
              stateImages.push({
                id: `stateimage-${uniqueId}`,
                name: elementName,
                patterns: [{
                  id: `pattern-${uniqueId}`,
                  name: elementName,
                  searchRegions: [elementBbox],
                  fixed: false,
                }],
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
            patterns: [{
              id: `pattern-${firstOccurrence.stateId}`,
              name: stateName,
              searchRegions: [stateBbox],
              fixed: false,
            }],
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

  // Poll for UI-TARS extraction status
  const pollExtractionStatus = useCallback(async () => {
    const runnerUrl = getRunnerUrl(selectedConnectionId);
    if (!runnerUrl) return;

    try {
      const response = await fetch(`${runnerUrl}/uitars-extraction/status`);
      if (!response.ok) {
        console.error("Failed to get extraction status:", response.statusText);
        return;
      }
      const data = await response.json();
      if (data.success && data.data) {
        const status = data.data;
        setUitarsProgress({
          status: status.status || "idle",
          currentStep: status.current_step || 0,
          maxSteps: status.max_steps || config.uitarsConfig.maxSteps,
          elapsedSeconds: status.elapsed_seconds || 0,
          lastThought: status.last_thought,
          lastAction: status.last_action,
          statesDiscovered: status.states_discovered || 0,
          transitionsDiscovered: status.transitions_discovered || 0,
          errorMessage: status.error_message,
        });

        // Stop polling if extraction completed or failed
        if (status.status === "completed" || status.status === "failed" || status.status === "stopped") {
          setIsExtracting(false);
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          if (status.status === "completed") {
            toast.success("Extraction completed successfully!");
          } else if (status.status === "failed") {
            toast.error(`Extraction failed: ${status.error_message || "Unknown error"}`);
          }
        }
      }
    } catch (error) {
      console.error("Error polling extraction status:", error);
    }
  }, [config.uitarsConfig.maxSteps, getRunnerUrl, selectedConnectionId]);

  // Poll for web extraction status from backend
  const pollWebExtractionStatus = useCallback(async () => {
    const extractionId = webExtractionProgress.extractionId;
    if (!extractionId) return;

    try {
      const detail = await extractionService.getExtractionDetail(extractionId);
      console.log("[Extraction] Backend status:", detail.status, "stats:", detail.stats);

      if (detail.stats) {
        const stats = detail.stats as {
          states_found?: number;
          transitions_found?: number;
          pages_extracted?: number;
          errors?: number;
        };
        setWebExtractionProgress((prev) => ({
          ...prev,
          statesFound: stats.states_found ?? prev.statesFound,
          transitionsFound: stats.transitions_found ?? prev.transitionsFound,
          pagesExtracted: stats.pages_extracted ?? prev.pagesExtracted,
          errors: stats.errors ?? prev.errors,
        }));
      }

      if (detail.status === "completed") {
        setIsExtracting(false);
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        setWebExtractionProgress((prev) => ({
          ...prev,
          status: "completed",
        }));
        toast.success("Web extraction completed successfully!");
      } else if (detail.status === "failed") {
        setIsExtracting(false);
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        setWebExtractionProgress((prev) => ({
          ...prev,
          status: "failed",
          errorMessage: detail.error_message || "Extraction failed",
        }));
        toast.error(`Extraction failed: ${detail.error_message || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Error polling web extraction status:", error);
    }
  }, [webExtractionProgress.extractionId]);

  // Start polling when extraction starts
  useEffect(() => {
    if (isExtracting && config.method === "web") {
      pollWebExtractionStatus();
      pollingRef.current = setInterval(pollWebExtractionStatus, 3000);
    } else if (isExtracting && (config.method === "uitars-web" || config.method === "uitars-desktop")) {
      pollExtractionStatus();
      pollingRef.current = setInterval(pollExtractionStatus, 2000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isExtracting, config.method, pollExtractionStatus, pollWebExtractionStatus]);

  // Load extraction detail when web extraction completes
  useEffect(() => {
    if (
      config.method === "web" &&
      webExtractionProgress.status === "completed" &&
      webExtractionProgress.extractionId &&
      !extractionDetail
    ) {
      console.log("[Extraction] Loading detail for:", webExtractionProgress.extractionId);
      loadExtractionDetail(webExtractionProgress.extractionId);
    }
  }, [config.method, webExtractionProgress.status, webExtractionProgress.extractionId, extractionDetail, loadExtractionDetail]);

  // UI Bridge: Load render log sessions
  const loadRenderLogSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const response = await fetch("/api/v1/render-logs/sessions?limit=20", {
        credentials: "include",
      });

      if (response.ok) {
        const sessions: RenderLogSession[] = await response.json();
        setRenderLogSessions(sessions);
      } else if (response.status === 404) {
        setRenderLogSessions([]);
      }
    } catch (error) {
      console.error("Failed to load render log sessions:", error);
      setRenderLogSessions([]);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  // UI Bridge: Load renders from session
  const loadSessionRenders = useCallback(async (sessionId: string) => {
    setIsLoadingSessionRenders(true);
    setSelectedSessionId(sessionId);
    try {
      const listResponse = await fetch(
        `/api/v1/render-logs?session_id=${sessionId}&page_size=200`,
        { credentials: "include" }
      );

      if (!listResponse.ok) {
        throw new Error("Failed to load render logs");
      }

      const listData = await listResponse.json();
      const renders: RenderLogEntry[] = [];
      for (const summary of listData.items) {
        const detailResponse = await fetch(
          `/api/v1/render-logs/${summary.id}`,
          { credentials: "include" }
        );
        if (detailResponse.ok) {
          const detail = await detailResponse.json();
          renders.push(detail);
        }
      }

      const formattedRenders = renders.map((r) => ({
        id: `render_${r.id}`,
        type: "dom_snapshot",
        page_url: r.page_url,
        snapshot: r.snapshot,
      }));

      setSessionRenders(formattedRenders);
      setUploadedRenders(null);
      setDiscoveryResult(null);
      setStateDescriptions({});
      setCurrentSavedConfigId(null);
      setStateUuidMap({});

      toast.success(`Loaded ${formattedRenders.length} renders from session`);
    } catch (error) {
      console.error("Failed to load session renders:", error);
      toast.error("Failed to load render logs from session");
    } finally {
      setIsLoadingSessionRenders(false);
    }
  }, []);

  // UI Bridge: Load domain knowledge
  const loadDomainKnowledge = useCallback(async () => {
    if (!projectId) return;

    setIsLoadingKnowledge(true);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/domain-knowledge`,
        { credentials: "include" }
      );

      if (response.ok) {
        const data = await response.json();
        setDomainKnowledgeList(data.items || []);
      }
    } catch (error) {
      console.error("Failed to load domain knowledge:", error);
    } finally {
      setIsLoadingKnowledge(false);
    }
  }, [projectId]);

  // UI Bridge: Load saved configs
  const loadConfigs = useCallback(async () => {
    if (!projectId) return;

    setIsLoadingConfigs(true);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/ui-bridge-configs`,
        { credentials: "include" }
      );

      if (response.ok) {
        const data = await response.json();
        setSavedConfigs(data.items || []);
      }
    } catch (error) {
      console.error("Failed to load configs:", error);
    } finally {
      setIsLoadingConfigs(false);
    }
  }, [projectId]);

  // Load configs and knowledge when in UI Bridge mode
  useEffect(() => {
    if (config.method === "ui-bridge") {
      loadConfigs();
      loadDomainKnowledge();
      loadRenderLogSessions();
    }
  }, [config.method, loadConfigs, loadDomainKnowledge, loadRenderLogSessions]);

  // UI Bridge: Load saved config
  const loadSavedConfig = useCallback(async (configId: string) => {
    if (!projectId) return;

    setIsLoadingConfigs(true);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/ui-bridge-configs/${configId}`,
        { credentials: "include" }
      );

      if (!response.ok) {
        throw new Error("Failed to load config");
      }

      const cfg = await response.json();

      const uuidMap: Record<string, string> = {};
      const states: DiscoveredState[] = cfg.states.map((s: SavedState) => {
        uuidMap[s.state_id] = s.id;
        return {
          id: s.state_id,
          name: s.name,
          state_image_ids: s.element_ids,
          screenshot_ids: s.render_ids,
          confidence: s.confidence,
          description: s.description,
          domain_knowledge: s.domain_knowledge || [],
        };
      });

      const descriptions: Record<string, string> = {};
      cfg.states.forEach((s: SavedState) => {
        if (s.description) {
          descriptions[s.state_id] = s.description;
        }
      });

      setStateUuidMap(uuidMap);
      setDiscoveryResult({
        states,
        elements: [],
        element_to_renders: {},
        render_count: cfg.render_count,
        unique_element_count: cfg.element_count,
      });
      setStateDescriptions(descriptions);
      setSelectedStateId(states[0]?.id || null);
      setCurrentSavedConfigId(configId);
      setConfigName(cfg.name);

      toast.success(`Loaded config "${cfg.name}"`);
    } catch (error) {
      console.error("Failed to load config:", error);
      toast.error("Failed to load config");
    } finally {
      setIsLoadingConfigs(false);
    }
  }, [projectId]);

  // UI Bridge: Run state discovery
  const runDiscovery = useCallback(async () => {
    if (!rendersToAnalyze || rendersToAnalyze.length === 0) {
      toast.error("No render logs to analyze");
      return;
    }

    setIsDiscovering(true);
    try {
      const response = await fetch(
        "/api/v1/state-discovery/ui-bridge/discover-states",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            renders: rendersToAnalyze,
            include_html_ids: false,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "State discovery failed");
      }

      const result: StateDiscoveryResult = await response.json();
      setDiscoveryResult(result);
      setSelectedStateId(result.states[0]?.id || null);
      setStateDescriptions({});
      setCurrentSavedConfigId(null);
      setStateUuidMap({});
      toast.success(
        `Discovered ${result.states.length} states from ${result.render_count} renders`
      );
    } catch (error) {
      console.error("State discovery error:", error);
      toast.error(error instanceof Error ? error.message : "State discovery failed");
    } finally {
      setIsDiscovering(false);
    }
  }, [rendersToAnalyze]);

  // UI Bridge: Save discovered states
  const saveDiscoveredStates = useCallback(async () => {
    if (!projectId) {
      toast.error("Please select a project first");
      return;
    }

    if (!rendersToAnalyze || rendersToAnalyze.length === 0) {
      toast.error("No render logs to save");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/ui-bridge-discover`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            config_name: configName,
            renders: rendersToAnalyze,
            include_html_ids: false,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to save states");
      }

      const result = await response.json();

      const uuidMap: Record<string, string> = {};
      const states: DiscoveredState[] = result.states.map(
        (s: SavedState & { state_id: string }) => {
          uuidMap[s.state_id] = s.id;
          return {
            id: s.state_id,
            name: s.name,
            state_image_ids: s.element_ids,
            screenshot_ids: s.render_ids,
            confidence: s.confidence,
            description: s.description,
            domain_knowledge: [],
          };
        }
      );

      setStateUuidMap(uuidMap);
      setDiscoveryResult({
        states,
        elements: discoveryResult?.elements || [],
        element_to_renders: discoveryResult?.element_to_renders || {},
        render_count: result.render_count,
        unique_element_count: result.unique_element_count,
      });
      setCurrentSavedConfigId(result.config.id);
      loadConfigs();

      toast.success(`Saved ${result.states.length} states to "${result.config.name}"`);
    } catch (error) {
      console.error("Save error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save states");
    } finally {
      setIsSaving(false);
    }
  }, [projectId, rendersToAnalyze, configName, discoveryResult, loadConfigs]);

  // UI Bridge: Update state description
  const updateStateDescription = useCallback(
    async (stateId: string, description: string) => {
      setStateDescriptions((prev) => ({ ...prev, [stateId]: description }));

      if (currentSavedConfigId && projectId && stateUuidMap[stateId]) {
        try {
          await fetch(
            `/api/v1/projects/${projectId}/ui-bridge-configs/${currentSavedConfigId}/states/${stateUuidMap[stateId]}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ description }),
            }
          );
        } catch (error) {
          console.error("Failed to save description:", error);
        }
      }
    },
    [currentSavedConfigId, projectId, stateUuidMap]
  );

  // UI Bridge: Create domain knowledge
  const createDomainKnowledge = useCallback(async () => {
    if (!projectId || !newKnowledgeTitle || !newKnowledgeContent) {
      toast.error("Please fill in title and content");
      return;
    }

    setIsCreatingKnowledge(true);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/domain-knowledge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            title: newKnowledgeTitle,
            content: newKnowledgeContent,
            tags: [],
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to create domain knowledge");
      }

      const created = await response.json();
      setDomainKnowledgeList((prev) => [...prev, created]);
      setNewKnowledgeTitle("");
      setNewKnowledgeContent("");
      setShowKnowledgeDialog(false);
      toast.success("Domain knowledge created");
    } catch (error) {
      console.error("Failed to create knowledge:", error);
      toast.error("Failed to create domain knowledge");
    } finally {
      setIsCreatingKnowledge(false);
    }
  }, [projectId, newKnowledgeTitle, newKnowledgeContent]);

  // UI Bridge: Link knowledge to state
  const linkKnowledgeToState = useCallback(
    async (knowledgeId: string) => {
      if (!projectId || !currentSavedConfigId || !selectedStateId || !stateUuidMap[selectedStateId]) {
        toast.error("State must be saved first");
        return;
      }

      try {
        const response = await fetch(
          `/api/v1/projects/${projectId}/ui-bridge-configs/${currentSavedConfigId}/states/${stateUuidMap[selectedStateId]}/knowledge`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ knowledge_id: knowledgeId, order: 0 }),
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || "Failed to link knowledge");
        }

        const updatedState = await response.json();

        setDiscoveryResult((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            states: prev.states.map((s) =>
              s.id === selectedStateId
                ? { ...s, domain_knowledge: updatedState.domain_knowledge }
                : s
            ),
          };
        });

        setShowLinkKnowledgeDialog(false);
        toast.success("Knowledge linked to state");
      } catch (error) {
        console.error("Failed to link knowledge:", error);
        toast.error(error instanceof Error ? error.message : "Failed to link knowledge");
      }
    },
    [projectId, currentSavedConfigId, selectedStateId, stateUuidMap]
  );

  // UI Bridge: Unlink knowledge from state
  const unlinkKnowledgeFromState = useCallback(
    async (knowledgeId: string) => {
      if (!projectId || !currentSavedConfigId || !selectedStateId || !stateUuidMap[selectedStateId]) {
        return;
      }

      try {
        await fetch(
          `/api/v1/projects/${projectId}/ui-bridge-configs/${currentSavedConfigId}/states/${stateUuidMap[selectedStateId]}/knowledge/${knowledgeId}`,
          { method: "DELETE", credentials: "include" }
        );

        setDiscoveryResult((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            states: prev.states.map((s) =>
              s.id === selectedStateId
                ? {
                    ...s,
                    domain_knowledge: (s.domain_knowledge || []).filter(
                      (k) => k.id !== knowledgeId
                    ),
                  }
                : s
            ),
          };
        });

        toast.success("Knowledge unlinked");
      } catch (error) {
        console.error("Failed to unlink knowledge:", error);
        toast.error("Failed to unlink knowledge");
      }
    },
    [projectId, currentSavedConfigId, selectedStateId, stateUuidMap]
  );

  // UI Bridge: Handle file upload
  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);
        const renders = Array.isArray(parsed) ? parsed : [parsed];
        setUploadedRenders(renders);
        setSessionRenders(null);
        setSelectedSessionId(null);
        setDiscoveryResult(null);
        setStateDescriptions({});
        setCurrentSavedConfigId(null);
        setStateUuidMap({});
        toast.success(`Loaded ${renders.length} render logs from file`);
      } catch {
        toast.error("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  }, []);

  // Stop extraction handler
  const handleStopExtraction = async () => {
    try {
      if (config.method === "web") {
        await runnerClient.stopExtraction();
        setWebExtractionProgress((prev) => ({ ...prev, status: "idle" }));
      } else {
        const runnerUrl = getRunnerUrl(selectedConnectionId);
        if (runnerUrl) {
          const response = await fetch(`${runnerUrl}/uitars-extraction/stop`, {
            method: "POST",
          });
          if (!response.ok) {
            console.error("Failed to stop UI-TARS extraction");
          }
        }
      }
      toast.info("Extraction stopped");
    } catch (error) {
      console.error("Failed to stop extraction:", error);
    }
    setIsExtracting(false);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const handleStartExtraction = async () => {
    if (!projectId) {
      toast.error("No project selected");
      return;
    }

    // Validate configuration based on method
    if (config.method === "web") {
      const validUrls = config.webConfig.urls.filter((u) => u.trim() !== "");
      if (validUrls.length === 0) {
        toast.error("Please add at least one URL to extract");
        return;
      }
    } else if (config.method === "uitars-web") {
      const validUrls = config.uitarsConfig.urls?.filter((u) => u.trim() !== "") || [];
      if (validUrls.length === 0) {
        toast.error("Please add at least one URL to explore");
        return;
      }
    } else if (config.method === "uitars-desktop") {
      if (!config.uitarsConfig.applicationName?.trim()) {
        toast.error("Please specify an application name");
        return;
      }
    }

    try {
      if (config.method === "web") {
        const validUrls = config.webConfig.urls.filter((u) => u.trim() !== "");

        const runnerAvailable = await runnerClient.isAvailable();
        if (!runnerAvailable) {
          toast.error("Desktop Runner is not connected. Please start the qontinui-runner application.");
          return;
        }

        setExtractionDetail(null);
        setAnnotations([]);

        setWebExtractionProgress({
          status: "running",
          extractionId: null,
          statesFound: 0,
          transitionsFound: 0,
          pagesExtracted: 0,
          errors: 0,
        });

        const sessionResult = await createExtraction.mutateAsync({
          projectId,
          data: {
            source_urls: validUrls,
            config: {
              viewports: [[1920, 1080]],
              capture_hover_states: config.webConfig.captureHover,
              capture_focus_states: config.webConfig.captureFocus,
              max_depth: config.webConfig.maxDepth,
              max_pages: config.webConfig.maxPages,
            },
          },
        });

        setWebExtractionProgress((prev) => ({
          ...prev,
          extractionId: sessionResult.id,
        }));

        const authToken = await getAccessToken();

        const response = await runnerClient.startExtraction({
          urls: validUrls,
          viewports: [[1920, 1080]],
          capture_hover_states: config.webConfig.captureHover,
          capture_focus_states: config.webConfig.captureFocus,
          max_depth: config.webConfig.maxDepth,
          max_pages: config.webConfig.maxPages,
          session_id: sessionResult.id,
          backend_url: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
          auth_token: authToken || undefined,
        });

        if (!response.success) {
          try {
            await extractionService.updateExtraction(sessionResult.id, {
              status: "failed",
              error_message: response.error || "Failed to start extraction on runner",
            });
          } catch (updateError) {
            console.error("Failed to update extraction status:", updateError);
          }
          throw new Error(response.error || "Failed to start web extraction");
        }

        toast.info("Starting web extraction...");
        setIsExtracting(true);
        setMainTab("results");
      } else {
        // UI-TARS extraction
        const runnerUrl = getRunnerUrl(selectedConnectionId);
        if (!runnerUrl) {
          toast.error("Please select a connected runner");
          return;
        }

        setUitarsProgress({
          status: "starting",
          currentStep: 0,
          maxSteps: config.uitarsConfig.maxSteps,
          elapsedSeconds: 0,
          statesDiscovered: 0,
          transitionsDiscovered: 0,
        });

        const target = config.method === "uitars-web"
          ? (config.uitarsConfig.urls?.[0] || "")
          : (config.uitarsConfig.applicationName || "");

        const requestBody = {
          target_type: config.method === "uitars-web" ? "web" : "desktop",
          target,
          goal: config.uitarsConfig.goal,
          provider: config.uitarsConfig.provider,
          model_size: config.uitarsConfig.modelSize,
          quantization: config.uitarsConfig.quantization,
          max_steps: config.uitarsConfig.maxSteps,
          timeout_seconds: config.uitarsConfig.timeoutSeconds,
          save_screenshots: config.uitarsConfig.saveScreenshots,
          huggingface_endpoint: config.uitarsConfig.huggingfaceEndpoint,
          huggingface_api_token: config.uitarsConfig.huggingfaceApiToken,
          vllm_server_url: config.uitarsConfig.vllmServerUrl,
          monitor_index: config.selectedMonitors[0] || 0,
        };

        const response = await fetch(`${runnerUrl}/uitars-extraction/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.success) {
          toast.info(`Starting ${config.method} extraction...`);
          setIsExtracting(true);
          setMainTab("results");
        } else {
          throw new Error(data.error || "Failed to start extraction");
        }
      }
    } catch (error) {
      console.error("Failed to start extraction:", error);
      toast.error(`Failed to start extraction: ${error instanceof Error ? error.message : "Unknown error"}`);
      setIsExtracting(false);
      if (config.method === "web") {
        setWebExtractionProgress((prev) => ({ ...prev, status: "failed", errorMessage: String(error) }));
      } else {
        setUitarsProgress((prev) => ({ ...prev, status: "failed", errorMessage: String(error) }));
      }
    }
  };

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
      </div>
    );
  }

  // Get color based on current method
  const getMethodColor = () => {
    switch (config.method) {
      case "web":
        return "var(--brand-primary)";
      case "ui-bridge":
        return "#4ECDC4";
      case "uitars-web":
      case "uitars-desktop":
        return "var(--brand-secondary)";
      case "image":
        return "var(--brand-success)";
      default:
        return "var(--brand-primary)";
    }
  };

  const methodColor = getMethodColor();

  // UI Bridge helper data
  const selectedState = discoveryResult?.states.find((s) => s.id === selectedStateId);
  const selectedStateElements = selectedState
    ? discoveryResult?.elements.filter((e) => selectedState.state_image_ids.includes(e.id))
    : [];
  const availableKnowledge = domainKnowledgeList.filter(
    (k) => !selectedState?.domain_knowledge?.some((linked) => linked.id === k.id)
  );

  return (
    <div className="layout-full-height bg-surface-canvas relative">
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
        <header className="border-b border-border-subtle bg-surface-canvas/90 backdrop-blur-sm shrink-0">
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center gap-3">
              <span
                className="text-sm font-mono uppercase tracking-widest pt-1"
                style={{ color: `color-mix(in oklch, ${methodColor} 60%, transparent)` }}
              >
                Discover
              </span>
              <Badge
                variant="outline"
                className="text-[10px] px-2"
                style={{ borderColor: methodColor, color: methodColor }}
              >
                {config.method.replace("-", " ").toUpperCase()}
              </Badge>

              {/* Domain Knowledge button for UI Bridge */}
              {config.method === "ui-bridge" && projectId && (
                <div className="ml-auto">
                  <Dialog open={showKnowledgeDialog} onOpenChange={setShowKnowledgeDialog}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        <BookOpen className="h-4 w-4 mr-2" />
                        Domain Knowledge ({domainKnowledgeList.length})
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg">
                      <DialogHeader>
                        <DialogTitle>Create Domain Knowledge</DialogTitle>
                        <DialogDescription>
                          Add reusable knowledge that can be linked to multiple states.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium mb-2 block">Title</label>
                          <Input
                            placeholder="e.g., What is user authentication?"
                            value={newKnowledgeTitle}
                            onChange={(e) => setNewKnowledgeTitle(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium mb-2 block">Content</label>
                          <Textarea
                            placeholder="Explain the concept, expected behavior, or requirements..."
                            value={newKnowledgeContent}
                            onChange={(e) => setNewKnowledgeContent(e.target.value)}
                            className="min-h-[150px]"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setShowKnowledgeDialog(false)}>
                          Cancel
                        </Button>
                        <Button onClick={createDomainKnowledge} disabled={isCreatingKnowledge}>
                          {isCreatingKnowledge ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Plus className="h-4 w-4 mr-2" />
                          )}
                          Create
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Tabs & Content */}
        <div className="container mx-auto px-6 py-6 layout-full-height">
          <Tabs
            value={mainTab}
            onValueChange={(v) => setMainTab(v as MainTab)}
            className="w-full layout-full-height"
          >
            <div className="flex items-center gap-3 mb-6 shrink-0">
              <TabsList className="bg-surface-raised/80 border border-border-subtle p-1 backdrop-blur-sm h-11">
                <TabsTrigger
                  value="configuration"
                  data-ui-id="extraction-config-tab"
                  className="data-[state=active]:bg-opacity-20 font-mono px-6 h-9 transition-all"
                  style={{ "--tw-bg-opacity": "0.2" } as React.CSSProperties}
                >
                  Configuration
                </TabsTrigger>
                <TabsTrigger
                  value="results"
                  data-ui-id="extraction-results-tab"
                  className="data-[state=active]:bg-opacity-20 font-mono px-6 h-9 transition-all"
                >
                  Results
                </TabsTrigger>
              </TabsList>

              {/* Start button - not shown for UI Bridge (it has its own flow) */}
              {config.method !== "ui-bridge" && (
                <Button
                  onClick={handleStartExtraction}
                  disabled={isExtracting}
                  data-ui-id="extraction-start-btn"
                  className="font-mono h-11 px-6 transition-all"
                  style={{
                    backgroundColor: `color-mix(in oklch, ${methodColor} 10%, transparent)`,
                    color: methodColor,
                    borderColor: `color-mix(in oklch, ${methodColor} 40%, transparent)`,
                    boxShadow: `0 0 15px color-mix(in oklch, ${methodColor} 10%, transparent)`,
                  }}
                >
                  {isExtracting ? (
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
              )}
            </div>

            {/* Configuration Tab */}
            <TabsContent
              value="configuration"
              className="mt-0 layout-full-height data-[state=inactive]:hidden"
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
                {/* Left: Main Configuration (2 columns) */}
                <div className="lg:col-span-2 h-full min-h-0">
                  <ScrollArea className="h-full pr-4">
                    <div className="space-y-6 pb-6">
                      {/* UI-TARS Progress Panel */}
                      {(config.method === "uitars-web" || config.method === "uitars-desktop") &&
                        uitarsProgress.status !== "idle" && (
                          <UITarsProgressPanel
                            progress={uitarsProgress}
                            onStop={handleStopExtraction}
                          />
                        )}

                      {/* Method Selector */}
                      <ExtractionMethodSelector
                        selectedMethod={config.method}
                        onMethodChange={setMethod}
                      />

                      {/* Method-specific Configuration */}
                      {config.method === "web" && (
                        <ExtractionConfigPanel
                          extractionConfig={{
                            config: {
                              urls: config.webConfig.urls,
                              selectedMonitors: config.selectedMonitors,
                              captureHover: config.webConfig.captureHover,
                              captureFocus: config.webConfig.captureFocus,
                              maxDepth: config.webConfig.maxDepth,
                              maxPages: config.webConfig.maxPages,
                            },
                            isLoaded,
                            setUrls: extractionConfig.setUrls,
                            setSelectedMonitors: extractionConfig.setSelectedMonitors,
                            setCaptureHover: extractionConfig.setCaptureHover,
                            setCaptureFocus: extractionConfig.setCaptureFocus,
                            setMaxDepth: extractionConfig.setMaxDepth,
                            setMaxPages: extractionConfig.setMaxPages,
                            setConfig: () => {},
                            resetConfig: extractionConfig.resetConfig,
                          }}
                        />
                      )}

                      {config.method === "ui-bridge" && (
                        <UIBridgeConfigSection
                          projectId={projectId}
                          exploration={exploration}
                          explorationRenders={explorationRenders}
                          setExplorationRenders={setExplorationRenders}
                          sessionRenders={sessionRenders}
                          setSessionRenders={setSessionRenders}
                          uploadedRenders={uploadedRenders}
                          setUploadedRenders={setUploadedRenders}
                          renderLogSessions={renderLogSessions}
                          isLoadingSessions={isLoadingSessions}
                          selectedSessionId={selectedSessionId}
                          setSelectedSessionId={setSelectedSessionId}
                          isLoadingSessionRenders={isLoadingSessionRenders}
                          loadRenderLogSessions={loadRenderLogSessions}
                          loadSessionRenders={loadSessionRenders}
                          savedConfigs={savedConfigs}
                          selectedConfigId={selectedConfigId}
                          setSelectedConfigId={setSelectedConfigId}
                          loadSavedConfig={loadSavedConfig}
                          handleFileUpload={handleFileUpload}
                          rendersToAnalyze={rendersToAnalyze}
                          discoveryResult={discoveryResult}
                          configName={configName}
                          setConfigName={setConfigName}
                          isDiscovering={isDiscovering}
                          runDiscovery={runDiscovery}
                          isSaving={isSaving}
                          saveDiscoveredStates={saveDiscoveredStates}
                          setDiscoveryResult={setDiscoveryResult}
                          setStateDescriptions={setStateDescriptions}
                          setCurrentSavedConfigId={setCurrentSavedConfigId}
                          setStateUuidMap={setStateUuidMap}
                          connections={connections}
                          connectionsLoading={connectionsLoading}
                          selectedConnectionId={selectedConnectionId}
                          onConnectionChange={onConnectionChange}
                          getRunnerUrl={getRunnerUrl}
                        />
                      )}

                      {(config.method === "uitars-web" || config.method === "uitars-desktop") && (
                        <UITarsConfigPanel
                          method={config.method}
                          config={config.uitarsConfig}
                          onConfigChange={setUitarsConfig}
                        />
                      )}

                      {config.method === "image" && (
                        <Card className="p-6 bg-surface-raised/60 border-border-subtle">
                          <div className="flex flex-col items-center justify-center py-8 text-center">
                            <Info className="h-12 w-12 text-brand-success/40 mb-4" />
                            <h3 className="text-lg font-medium mb-2">Image Extraction</h3>
                            <p className="text-sm text-text-muted max-w-md">
                              Image extraction uses template matching to find patterns.
                              Use the Image Extraction tool in the Create menu for
                              cutting patterns from screenshots.
                            </p>
                          </div>
                        </Card>
                      )}
                    </div>
                  </ScrollArea>
                </div>

                {/* Right: Info Panel (1 column) */}
                <div className="lg:col-span-1 min-h-0 overflow-hidden">
                  <Card className="bg-surface-raised/60 border-border-subtle backdrop-blur-sm h-full overflow-hidden flex flex-col">
                    <div
                      className="p-4 border-b"
                      style={{ borderColor: `color-mix(in oklch, ${methodColor} 10%, transparent)` }}
                    >
                      <div className="flex items-center gap-2">
                        <Info className="h-4 w-4" style={{ color: methodColor }} />
                        <Label
                          className="text-base font-mono font-semibold uppercase tracking-wider"
                          style={{ color: methodColor }}
                        >
                          About {config.method.replace("-", " ")}
                        </Label>
                      </div>
                    </div>
                    <ScrollArea className="flex-1 min-h-0">
                      <div className="p-4 space-y-4 text-sm text-muted-foreground">
                        {config.method === "web" && (
                          <>
                            <p>
                              Web Extraction uses Playwright to crawl web pages and
                              discover UI elements through DOM analysis.
                            </p>
                            <div className="space-y-2">
                              <p className="font-medium" style={{ color: methodColor }}>
                                Features:
                              </p>
                              <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>Automatic state discovery from page structure</li>
                                <li>Hover and focus state detection</li>
                                <li>Multi-page crawling with depth control</li>
                                <li>Screenshot capture for each state</li>
                              </ul>
                            </div>
                          </>
                        )}

                        {config.method === "ui-bridge" && (
                          <>
                            <p>
                              UI Bridge States discovers application states by analyzing
                              render logs using co-occurrence patterns.
                            </p>
                            <div className="space-y-2">
                              <p className="font-medium" style={{ color: methodColor }}>
                                Features:
                              </p>
                              <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>Automated exploration via Playwright</li>
                                <li>Co-occurrence analysis for state grouping</li>
                                <li>Domain knowledge management</li>
                                <li>Works with any web application</li>
                              </ul>
                            </div>
                            <div className="space-y-2">
                              <p className="font-medium" style={{ color: methodColor }}>
                                Input Sources:
                              </p>
                              <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>Auto Explore: Automated Playwright collection</li>
                                <li>From Session: Previously captured render logs</li>
                                <li>Upload/Load: JSON files or saved configs</li>
                              </ul>
                            </div>
                          </>
                        )}

                        {(config.method === "uitars-web" || config.method === "uitars-desktop") && (
                          <>
                            <p>
                              UI-TARS uses vision-language models to autonomously
                              explore GUIs through visual understanding.
                            </p>
                            <div className="space-y-2">
                              <p className="font-medium" style={{ color: methodColor }}>
                                Features:
                              </p>
                              <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>Thought-Action decomposition for reasoning</li>
                                <li>Natural language goal-driven exploration</li>
                                <li>Works with any GUI (web or desktop)</li>
                                <li>Local or cloud inference options</li>
                              </ul>
                            </div>
                            <div className="space-y-2">
                              <p className="font-medium" style={{ color: methodColor }}>
                                Hardware Requirements:
                              </p>
                              <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>2B model: GTX 1080 (8GB) with int4</li>
                                <li>7B model: RTX 3080+ (10GB) with int4</li>
                                <li>72B model: Cloud inference recommended</li>
                              </ul>
                            </div>
                          </>
                        )}

                        {config.method === "image" && (
                          <>
                            <p>
                              Image Extraction uses template matching to find UI
                              patterns in screenshots.
                            </p>
                            <div className="space-y-2">
                              <p className="font-medium" style={{ color: methodColor }}>
                                Best for:
                              </p>
                              <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>Simple, static UI elements</li>
                                <li>Icons and buttons with fixed appearance</li>
                                <li>Legacy applications</li>
                              </ul>
                            </div>
                          </>
                        )}

                        <div
                          className="mt-4 p-3 rounded-md"
                          style={{
                            backgroundColor: `color-mix(in oklch, ${methodColor} 5%, transparent)`,
                            borderWidth: "1px",
                            borderStyle: "solid",
                            borderColor: `color-mix(in oklch, ${methodColor} 20%, transparent)`,
                          }}
                        >
                          <p className="text-xs" style={{ color: methodColor }}>
                            <strong>Note:</strong> This feature requires the Desktop
                            Runner to be connected.
                          </p>
                        </div>
                      </div>
                    </ScrollArea>
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* Results Tab */}
            <TabsContent
              value="results"
              className="mt-0 layout-full-height data-[state=inactive]:hidden flex flex-col"
            >
              <div className="flex flex-col gap-4 flex-1 min-h-0">
                {/* Web Extraction progress */}
                {config.method === "web" && webExtractionProgress.status === "running" && (
                  <Card className="p-6 bg-surface-raised/60 border-border-subtle">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <Loader2 className="h-5 w-5 animate-spin" style={{ color: methodColor }} />
                        <h3 className="text-lg font-semibold" style={{ color: methodColor }}>
                          Web Extraction Running
                        </h3>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleStopExtraction}
                        data-ui-id="extraction-web-stop-btn"
                        className="text-red-500 border-red-500/50 hover:bg-red-500/10"
                      >
                        Stop
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-text-muted">Pages Extracted</p>
                        <p className="text-lg font-mono">{webExtractionProgress.pagesExtracted}</p>
                      </div>
                      <div>
                        <p className="text-text-muted">States Found</p>
                        <p className="text-lg font-mono">{webExtractionProgress.statesFound}</p>
                      </div>
                      <div>
                        <p className="text-text-muted">Transitions Found</p>
                        <p className="text-lg font-mono">{webExtractionProgress.transitionsFound}</p>
                      </div>
                      <div>
                        <p className="text-text-muted">Errors</p>
                        <p className="text-lg font-mono">{webExtractionProgress.errors}</p>
                      </div>
                    </div>
                  </Card>
                )}

                {/* UI-TARS progress */}
                {(config.method === "uitars-web" || config.method === "uitars-desktop") &&
                  uitarsProgress.status !== "idle" && (
                    <UITarsProgressPanel
                      progress={uitarsProgress}
                      onStop={handleStopExtraction}
                    />
                  )}

                {/* UI Bridge Results */}
                {config.method === "ui-bridge" && (
                  <UIBridgeResultsSection
                    discoveryResult={discoveryResult}
                    isLoadingConfigs={isLoadingConfigs}
                    selectedStateId={selectedStateId}
                    setSelectedStateId={setSelectedStateId}
                    selectedState={selectedState}
                    selectedStateElements={selectedStateElements}
                    stateDescriptions={stateDescriptions}
                    updateStateDescription={updateStateDescription}
                    currentSavedConfigId={currentSavedConfigId}
                    projectId={projectId}
                    showLinkKnowledgeDialog={showLinkKnowledgeDialog}
                    setShowLinkKnowledgeDialog={setShowLinkKnowledgeDialog}
                    availableKnowledge={availableKnowledge}
                    linkKnowledgeToState={linkKnowledgeToState}
                    unlinkKnowledgeFromState={unlinkKnowledgeFromState}
                    methodColor={methodColor}
                  />
                )}

                {/* Idle message for non-UI-Bridge methods */}
                {config.method !== "ui-bridge" &&
                  ((config.method === "web" && webExtractionProgress.status === "idle") ||
                    ((config.method === "uitars-web" || config.method === "uitars-desktop") && uitarsProgress.status === "idle") ||
                    config.method === "image") && (
                    <Alert className="bg-surface-raised/60 border-border-subtle backdrop-blur-sm">
                      <AlertCircle className="h-4 w-4" style={{ color: methodColor }} />
                      <AlertDescription className="text-text-secondary font-mono">
                        No extraction results yet. Configure your extraction settings and
                        click "Start Extraction" to begin.
                      </AlertDescription>
                    </Alert>
                  )}

                {/* Web Extraction completed results */}
                {config.method === "web" && webExtractionProgress.status === "completed" && (
                  <>
                    <Card className="p-4 bg-surface-raised/60 border-brand-success/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-brand-success" />
                          <h3 className="text-lg font-semibold text-brand-success">
                            Web Extraction Complete
                          </h3>
                          <span className="text-sm text-text-muted">
                            Discovered {webExtractionProgress.statesFound} states and{" "}
                            {webExtractionProgress.transitionsFound} transitions from{" "}
                            {webExtractionProgress.pagesExtracted} pages.
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          data-ui-id="extraction-web-import-btn"
                          className="border-brand-success/50 text-brand-success hover:bg-brand-success/10"
                        >
                          Import to State Machine
                        </Button>
                      </div>
                    </Card>

                    {isLoadingDetail ? (
                      <div className="flex items-center justify-center py-24">
                        <div className="flex flex-col items-center gap-4">
                          <Loader2 className="h-12 w-12 animate-spin text-brand-success" />
                          <p className="text-brand-success font-mono animate-pulse uppercase tracking-widest text-xs">
                            Loading extraction results...
                          </p>
                        </div>
                      </div>
                    ) : stateMachineStates.length > 0 ? (
                      <div className="flex-1 min-h-[500px]">
                        <StateExplorerView
                          states={stateMachineStates}
                          annotations={annotations}
                          extractionId={
                            extractionDetail?.stats?.screenshot_extraction_id ||
                            webExtractionProgress.extractionId ||
                            undefined
                          }
                        />
                      </div>
                    ) : (
                      <Alert className="bg-surface-raised/60 border-brand-primary/30 backdrop-blur-sm">
                        <AlertCircle className="h-4 w-4 text-brand-primary" />
                        <AlertDescription className="text-text-secondary font-mono">
                          No states found in the extraction results. The extraction may still be syncing data.
                        </AlertDescription>
                      </Alert>
                    )}
                  </>
                )}

                {/* Web Extraction failed */}
                {config.method === "web" && webExtractionProgress.status === "failed" && (
                  <Card className="p-6 bg-surface-raised/60 border-red-500/30">
                    <div className="flex items-center gap-3 mb-4">
                      <AlertCircle className="h-5 w-5 text-red-500" />
                      <h3 className="text-lg font-semibold text-red-500">
                        Web Extraction Failed
                      </h3>
                    </div>
                    <p className="text-sm text-text-muted mb-4">
                      {webExtractionProgress.errorMessage || `Extraction completed with ${webExtractionProgress.errors} errors.`}
                    </p>
                  </Card>
                )}

                {/* UI-TARS completed */}
                {(config.method === "uitars-web" || config.method === "uitars-desktop") &&
                  uitarsProgress.status === "completed" && (
                    <Card className="p-6 bg-surface-raised/60 border-brand-success/30">
                      <div className="flex items-center gap-3 mb-4">
                        <CheckCircle2 className="h-5 w-5 text-brand-success" />
                        <h3 className="text-lg font-semibold text-brand-success">
                          Extraction Complete
                        </h3>
                      </div>
                      <p className="text-sm text-text-muted mb-4">
                        UI-TARS discovered {uitarsProgress.statesDiscovered} states and{" "}
                        {uitarsProgress.transitionsDiscovered} transitions.
                      </p>
                      <Button
                        variant="outline"
                        data-ui-id="extraction-uitars-import-btn"
                        className="border-brand-success/50 text-brand-success hover:bg-brand-success/10"
                      >
                        Import to State Machine
                      </Button>
                    </Card>
                  )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

// UI Bridge Configuration Section Component
interface UIBridgeConfigSectionProps {
  projectId: string | null;
  exploration: ReturnType<typeof useUIBridgeExploration>;
  explorationRenders: unknown[] | null;
  setExplorationRenders: (renders: unknown[] | null) => void;
  sessionRenders: unknown[] | null;
  setSessionRenders: (renders: unknown[] | null) => void;
  uploadedRenders: unknown[] | null;
  setUploadedRenders: (renders: unknown[] | null) => void;
  renderLogSessions: RenderLogSession[];
  isLoadingSessions: boolean;
  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;
  isLoadingSessionRenders: boolean;
  loadRenderLogSessions: () => void;
  loadSessionRenders: (sessionId: string) => void;
  savedConfigs: SavedConfig[];
  selectedConfigId: string | null;
  setSelectedConfigId: (id: string | null) => void;
  loadSavedConfig: (id: string) => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  rendersToAnalyze: unknown[] | null | undefined;
  discoveryResult: StateDiscoveryResult | null;
  configName: string;
  setConfigName: (name: string) => void;
  isDiscovering: boolean;
  runDiscovery: () => void;
  isSaving: boolean;
  saveDiscoveredStates: () => void;
  setDiscoveryResult: (result: StateDiscoveryResult | null) => void;
  setStateDescriptions: (descriptions: Record<string, string>) => void;
  setCurrentSavedConfigId: (id: string | null) => void;
  setStateUuidMap: (map: Record<string, string>) => void;
  // Runner connection props
  connections: RunnerConnection[];
  connectionsLoading: boolean;
  selectedConnectionId: number | null;
  onConnectionChange: (connectionId: number | null) => void;
  getRunnerUrl: (connectionId: number | null) => string | null;
}

function UIBridgeConfigSection({
  projectId,
  exploration,
  explorationRenders,
  setExplorationRenders,
  sessionRenders,
  setSessionRenders,
  uploadedRenders,
  setUploadedRenders,
  renderLogSessions,
  isLoadingSessions,
  selectedSessionId,
  setSelectedSessionId,
  isLoadingSessionRenders,
  loadRenderLogSessions,
  loadSessionRenders,
  savedConfigs,
  selectedConfigId,
  setSelectedConfigId,
  loadSavedConfig,
  handleFileUpload,
  rendersToAnalyze,
  discoveryResult,
  configName,
  setConfigName,
  isDiscovering,
  runDiscovery,
  isSaving,
  saveDiscoveredStates,
  setDiscoveryResult,
  setStateDescriptions,
  setCurrentSavedConfigId,
  setStateUuidMap,
  connections,
  connectionsLoading,
  selectedConnectionId,
  onConnectionChange,
  getRunnerUrl,
}: UIBridgeConfigSectionProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Render Log Source</CardTitle>
        <CardDescription>
          Collect render logs automatically or load from existing sources
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs defaultValue="explore" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="explore" className="flex items-center gap-2">
              <Compass className="h-4 w-4" />
              Auto Explore
            </TabsTrigger>
            <TabsTrigger value="session" className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              From Session
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex items-center gap-2">
              <FileJson className="h-4 w-4" />
              Upload / Load
            </TabsTrigger>
          </TabsList>

          {/* Auto Explore Tab */}
          <TabsContent value="explore" className="space-y-4">
            <ExplorationConfigPanel
              config={exploration.config}
              onConfigChange={exploration.updateConfig}
              progress={exploration.progress}
              isRunning={exploration.isRunning}
              connections={connections}
              connectionsLoading={connectionsLoading}
              selectedConnectionId={selectedConnectionId}
              onConnectionChange={onConnectionChange}
              onStart={async () => {
                const runnerUrl = getRunnerUrl(selectedConnectionId);
                if (!runnerUrl) {
                  toast.error("Please select a connected runner");
                  return;
                }
                // Clear old exploration renders before starting new exploration
                setExplorationRenders(null);

                // Use UI Bridge exploration for ui-bridge method, Playwright for web
                let results;
                if (config.method === "ui-bridge") {
                  results = await exploration.startUIBridgeExploration(runnerUrl);
                } else {
                  results = await exploration.startExploration(runnerUrl);
                }

                if (results && results.renderLogs.length > 0) {
                  const renders = results.renderLogs.map((log) => ({
                    id: log.id,
                    type: "dom_snapshot",
                    page_url: log.url,
                    snapshot: log.snapshot,
                    timestamp: log.timestamp,
                    trigger: log.trigger,
                  }));
                  setExplorationRenders(renders);
                  setSessionRenders(null);
                  setUploadedRenders(null);
                  setSelectedSessionId(null);
                  setDiscoveryResult(null);
                  setStateDescriptions({});
                  setCurrentSavedConfigId(null);
                  setStateUuidMap({});
                  toast.success(`Collected ${renders.length} render logs from exploration`);
                }
              }}
              onStop={() => {
                const runnerUrl = getRunnerUrl(selectedConnectionId);
                exploration.stopExploration(runnerUrl || undefined);
              }}
            />

            {explorationRenders && explorationRenders.length > 0 && (
              <div className="flex items-center justify-between p-3 bg-brand-success/10 border border-brand-success/30 rounded-lg">
                <div className="flex items-center gap-2 text-brand-success">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {explorationRenders.length} render logs collected from exploration
                  </span>
                </div>
                <Button onClick={runDiscovery} disabled={isDiscovering} size="sm">
                  {isDiscovering ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Discovering...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Discover States
                    </>
                  )}
                </Button>
              </div>
            )}
          </TabsContent>

          {/* From Session Tab */}
          <TabsContent value="session" className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              {renderLogSessions.length > 0 ? (
                <Select
                  value={selectedSessionId || ""}
                  onValueChange={(value) => {
                    loadSessionRenders(value);
                    setExplorationRenders(null);
                  }}
                  disabled={isLoadingSessionRenders}
                >
                  <SelectTrigger className="w-[280px]">
                    <Layers className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Select a captured session" />
                  </SelectTrigger>
                  <SelectContent>
                    {renderLogSessions.map((session) => (
                      <SelectItem key={session.session_id} value={session.session_id}>
                        {session.snapshot_count} renders ({session.unique_pages} pages)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-text-muted">
                  No captured sessions found. Browse the app to capture render logs automatically.
                </p>
              )}

              {isLoadingSessionRenders && (
                <div className="flex items-center gap-2 text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading session...</span>
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={loadRenderLogSessions}
                disabled={isLoadingSessions}
              >
                {isLoadingSessions ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
              </Button>
            </div>

            {sessionRenders && !isLoadingSessionRenders && (
              <div className="flex items-center justify-between p-3 bg-brand-success/10 border border-brand-success/30 rounded-lg">
                <div className="flex items-center gap-2 text-brand-success">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {sessionRenders.length} renders loaded from session
                  </span>
                </div>
                <Button onClick={runDiscovery} disabled={isDiscovering} size="sm">
                  {isDiscovering ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Discovering...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Discover States
                    </>
                  )}
                </Button>
              </div>
            )}

            <p className="text-sm text-text-muted">
              Render logs are automatically captured as you browse the application.
              Select a session to load its render logs for state discovery.
            </p>
          </TabsContent>

          {/* Upload / Load Tab */}
          <TabsContent value="upload" className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    handleFileUpload(e);
                    setExplorationRenders(null);
                  }}
                  className="hidden"
                />
                <Button variant="outline" asChild>
                  <span>
                    <FileJson className="h-4 w-4 mr-2" />
                    Upload JSON File
                  </span>
                </Button>
              </label>

              {projectId && savedConfigs.length > 0 && (
                <Select
                  value={selectedConfigId || ""}
                  onValueChange={(value) => {
                    setSelectedConfigId(value);
                    loadSavedConfig(value);
                    setExplorationRenders(null);
                  }}
                >
                  <SelectTrigger className="w-[200px]">
                    <FolderOpen className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Load saved config" />
                  </SelectTrigger>
                  <SelectContent>
                    {savedConfigs.map((cfg) => (
                      <SelectItem key={cfg.id} value={cfg.id}>
                        {cfg.name} ({cfg.render_count} renders)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {uploadedRenders && !sessionRenders && !explorationRenders && (
              <div className="flex items-center justify-between p-3 bg-brand-success/10 border border-brand-success/30 rounded-lg">
                <div className="flex items-center gap-2 text-brand-success">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {uploadedRenders.length} renders loaded from file
                  </span>
                </div>
                <Button onClick={runDiscovery} disabled={isDiscovering} size="sm">
                  {isDiscovering ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Discovering...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Discover States
                    </>
                  )}
                </Button>
              </div>
            )}

            <p className="text-sm text-text-muted">
              Upload a JSON file containing render logs, or load from a previously saved configuration.
            </p>
          </TabsContent>
        </Tabs>

        {/* Config Name and Save */}
        {rendersToAnalyze && projectId && discoveryResult && (
          <div className="flex items-center gap-4 pt-4 border-t">
            <Input
              placeholder="Config name"
              value={configName}
              onChange={(e) => setConfigName(e.target.value)}
              className="w-[200px]"
            />
            <Button variant="secondary" onClick={saveDiscoveredStates} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save to Project
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// UI Bridge Results Section Component
interface UIBridgeResultsSectionProps {
  discoveryResult: StateDiscoveryResult | null;
  isLoadingConfigs: boolean;
  selectedStateId: string | null;
  setSelectedStateId: (id: string | null) => void;
  selectedState: DiscoveredState | undefined;
  selectedStateElements: UIBridgeElement[] | undefined;
  stateDescriptions: Record<string, string>;
  updateStateDescription: (stateId: string, description: string) => void;
  currentSavedConfigId: string | null;
  projectId: string | null;
  showLinkKnowledgeDialog: boolean;
  setShowLinkKnowledgeDialog: (show: boolean) => void;
  availableKnowledge: DomainKnowledge[];
  linkKnowledgeToState: (knowledgeId: string) => void;
  unlinkKnowledgeFromState: (knowledgeId: string) => void;
  methodColor: string;
}

function UIBridgeResultsSection({
  discoveryResult,
  isLoadingConfigs,
  selectedStateId,
  setSelectedStateId,
  selectedState,
  selectedStateElements,
  stateDescriptions,
  updateStateDescription,
  currentSavedConfigId,
  projectId,
  showLinkKnowledgeDialog,
  setShowLinkKnowledgeDialog,
  availableKnowledge,
  linkKnowledgeToState,
  unlinkKnowledgeFromState,
  methodColor,
}: UIBridgeResultsSectionProps) {
  if (isLoadingConfigs) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!discoveryResult) {
    return (
      <Card className="flex-1 flex items-center justify-center">
        <div className="text-center text-text-muted">
          <Layers className="h-16 w-16 mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium mb-2">No States Discovered</h3>
          <p className="text-sm max-w-md">
            Upload render logs or load a saved configuration, then click
            &quot;Discover States&quot; to analyze element co-occurrence patterns.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-0">
      {/* State List */}
      <Card className="lg:col-span-1 flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span>Discovered States</span>
            <Badge variant="outline">{discoveryResult.states.length}</Badge>
          </CardTitle>
          <CardDescription>
            {discoveryResult.unique_element_count} elements across{" "}
            {discoveryResult.render_count} renders
            {currentSavedConfigId && (
              <span className="text-green-500 ml-2">(Saved)</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="space-y-2">
              {discoveryResult.states.map((state) => (
                <div
                  key={state.id}
                  className={`
                    p-3 rounded-lg border cursor-pointer transition-colors
                    ${
                      selectedStateId === state.id
                        ? "bg-primary/10 border-primary"
                        : "hover:bg-muted/50"
                    }
                  `}
                  onClick={() => setSelectedStateId(state.id)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{state.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {state.state_image_ids.length} elements
                    </Badge>
                  </div>
                  <div className="text-xs text-text-muted mt-1">
                    Active in {state.screenshot_ids.length} renders
                  </div>
                  {stateDescriptions[state.id] && (
                    <div className="text-xs text-text-secondary mt-2 line-clamp-2">
                      {stateDescriptions[state.id]}
                    </div>
                  )}
                  {state.domain_knowledge && state.domain_knowledge.length > 0 && (
                    <div className="flex items-center gap-1 mt-2">
                      <BookOpen className="h-3 w-3 text-text-muted" />
                      <span className="text-xs text-text-muted">
                        {state.domain_knowledge.length} knowledge linked
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* State Details */}
      <Card className="lg:col-span-2 flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle>
            {selectedState ? selectedState.name : "Select a State"}
          </CardTitle>
          <CardDescription>
            {selectedState
              ? `${selectedState.state_image_ids.length} elements that always appear together`
              : "Click a state to view details"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 overflow-auto">
          {selectedState ? (
            <div className="flex flex-col gap-4">
              {/* Description */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-2 block">
                  Description
                </label>
                <Textarea
                  placeholder="Describe what this state represents..."
                  value={stateDescriptions[selectedState.id] || ""}
                  onChange={(e) => updateStateDescription(selectedState.id, e.target.value)}
                  className="min-h-[100px]"
                />
              </div>

              {/* Domain Knowledge */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-text-secondary">
                    Domain Knowledge
                  </label>
                  {currentSavedConfigId && projectId && (
                    <Dialog
                      open={showLinkKnowledgeDialog}
                      onOpenChange={setShowLinkKnowledgeDialog}
                    >
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          <LinkIcon className="h-3 w-3 mr-1" />
                          Link Knowledge
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Link Domain Knowledge</DialogTitle>
                          <DialogDescription>
                            Select knowledge to link to this state.
                          </DialogDescription>
                        </DialogHeader>
                        <ScrollArea className="max-h-[300px]">
                          <div className="space-y-2">
                            {availableKnowledge.length === 0 ? (
                              <p className="text-sm text-text-muted text-center py-4">
                                No available knowledge. Create some first.
                              </p>
                            ) : (
                              availableKnowledge.map((k) => (
                                <div
                                  key={k.id}
                                  className="p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                                  onClick={() => linkKnowledgeToState(k.id)}
                                >
                                  <div className="font-medium">{k.title}</div>
                                  <div className="text-xs text-text-muted line-clamp-2">
                                    {k.content}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </ScrollArea>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
                {selectedState.domain_knowledge && selectedState.domain_knowledge.length > 0 ? (
                  <div className="space-y-2">
                    {selectedState.domain_knowledge.map((k) => (
                      <div key={k.id} className="p-3 border rounded-lg bg-muted/30">
                        <div className="flex items-start justify-between">
                          <div className="font-medium text-sm">{k.title}</div>
                          {currentSavedConfigId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => unlinkKnowledgeFromState(k.id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                        <div className="text-xs text-text-muted mt-1 whitespace-pre-wrap">
                          {k.content}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-text-muted border rounded-lg p-4 text-center">
                    {currentSavedConfigId
                      ? "No knowledge linked. Click 'Link Knowledge' to add."
                      : "Save the config first to link domain knowledge."}
                  </div>
                )}
              </div>

              {/* Elements */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-2 block">
                  Elements in this State
                </label>
                {selectedStateElements && selectedStateElements.length > 0 ? (
                  <ScrollArea className="h-[200px] border rounded-lg p-2">
                    <div className="space-y-1">
                      {selectedStateElements.map((element) => (
                        <Collapsible key={element.id}>
                          <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 hover:bg-muted/50 rounded text-left">
                            <ChevronRight className="h-4 w-4 transition-transform ui-expanded:rotate-90" />
                            <Badge variant="outline" className="text-xs font-mono">
                              {element.type}
                            </Badge>
                            <span className="text-sm font-medium">{element.name}</span>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="pl-8 pr-2 pb-2">
                            <div className="text-xs text-text-muted space-y-1">
                              <div>
                                <span className="font-medium">ID:</span> {element.id}
                              </div>
                              {element.tag_name && (
                                <div>
                                  <span className="font-medium">Tag:</span> {element.tag_name}
                                </div>
                              )}
                              {element.text_content && (
                                <div>
                                  <span className="font-medium">Text:</span> {element.text_content}
                                </div>
                              )}
                              <div>
                                <span className="font-medium">Appears in:</span>{" "}
                                {element.render_ids.length} renders
                              </div>
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="h-[200px] border rounded-lg p-4 flex items-center justify-center text-text-muted text-sm">
                    Element details available after fresh discovery
                  </div>
                )}
              </div>

              {/* Renders */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-2 block">
                  Active in Renders
                </label>
                <div className="flex flex-wrap gap-1">
                  {selectedState.screenshot_ids.map((renderId) => (
                    <Badge key={renderId} variant="secondary" className="text-xs">
                      {renderId}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted">
              <div className="text-center">
                <Link className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Select a state from the list to view details</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
