import { useState, useRef, useMemo } from "react";
import type { UITarsProgress } from "@/components/extraction/UITarsProgressPanel";
import type {
  ExtractionSessionDetail,
  ExtractionAnnotation,
} from "@/types/extraction";
import type {
  MainTab,
  UIBridgeDiscoveryResult,
  DomainKnowledge,
  SavedConfig,
  RenderLogSession,
  DiscoveryStrategy,
  WebExtractionProgressState,
  VisionExtractionProgressState,
} from "../_types";

export function useExtractionState() {
  // Main tabs
  const [mainTab, setMainTab] = useState<MainTab>("configuration");

  // Track which extraction from history is currently selected
  const [selectedHistoryExtractionId, setSelectedHistoryExtractionId] =
    useState<string | null>(null);

  // Cleanup stale extractions state
  const [isCleaningUp, setIsCleaningUp] = useState(false);

  // General extraction state
  const [isExtracting, setIsExtracting] = useState(false);

  // UI-TARS progress
  const [uitarsProgress, setUitarsProgress] = useState<UITarsProgress>({
    status: "idle",
    currentStep: 0,
    maxSteps: 50,
    elapsedSeconds: 0,
    statesDiscovered: 0,
    transitionsDiscovered: 0,
  });

  // Web extraction progress
  const [webExtractionProgress, setWebExtractionProgress] =
    useState<WebExtractionProgressState>({
      status: "idle",
      extractionId: null,
      statesFound: 0,
      transitionsFound: 0,
      pagesExtracted: 0,
      errors: 0,
    });

  // Vision extraction progress
  const [visionExtractionProgress, setVisionExtractionProgress] =
    useState<VisionExtractionProgressState>({
      status: "idle",
      elementsDetected: 0,
    });

  // Results sub-tabs
  const [visionResultsTab, setVisionResultsTab] = useState<
    "results" | "annotations"
  >("results");
  const [webResultsTab, setWebResultsTab] = useState<
    "explorer" | "annotations"
  >("explorer");

  // Polling ref
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Extraction data (results)
  const [extractionDetail, setExtractionDetail] =
    useState<ExtractionSessionDetail | null>(null);
  const [annotations, setAnnotations] = useState<ExtractionAnnotation[]>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // UI Bridge state
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingConfigs, setIsLoadingConfigs] = useState(false);
  const [discoveryResult, setDiscoveryResult] =
    useState<UIBridgeDiscoveryResult | null>(null);
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [stateDescriptions, setStateDescriptions] = useState<
    Record<string, string>
  >({});
  const [uploadedRenders, setUploadedRenders] = useState<unknown[] | null>(
    null
  );
  const [configName, setConfigName] = useState("default");
  const [discoveryStrategy, setDiscoveryStrategy] =
    useState<DiscoveryStrategy>("auto");
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [currentSavedConfigId, setCurrentSavedConfigId] = useState<
    string | null
  >(null);

  // Domain knowledge state
  const [domainKnowledgeList, setDomainKnowledgeList] = useState<
    DomainKnowledge[]
  >([]);
  const [_isLoadingKnowledge, setIsLoadingKnowledge] = useState(false);
  const [showKnowledgeDialog, setShowKnowledgeDialog] = useState(false);
  const [newKnowledgeTitle, setNewKnowledgeTitle] = useState("");
  const [newKnowledgeContent, setNewKnowledgeContent] = useState("");
  const [isCreatingKnowledge, setIsCreatingKnowledge] = useState(false);
  const [showLinkKnowledgeDialog, setShowLinkKnowledgeDialog] = useState(false);

  // Track state UUIDs for API calls
  const [stateUuidMap, setStateUuidMap] = useState<Record<string, string>>({});

  // Render log sessions
  const [renderLogSessions, setRenderLogSessions] = useState<
    RenderLogSession[]
  >([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [sessionRenders, setSessionRenders] = useState<unknown[] | null>(null);
  const [isLoadingSessionRenders, setIsLoadingSessionRenders] = useState(false);

  // Exploration renders
  const [explorationRenders, setExplorationRenders] = useState<
    unknown[] | null
  >(null);

  // Recording renders
  const [recordingRenders, setRecordingRenders] = useState<unknown[] | null>(
    null
  );

  // Runner connections
  const [selectedConnectionId, setSelectedConnectionId] = useState<
    number | null
  >(null);

  // URL method ref
  const methodSetRef = useRef(false);

  // Auto-load ref
  const autoLoadedRef = useRef(false);

  // Derived: renders to analyze (priority: exploration > recording > session > uploaded)
  const rendersToAnalyze = useMemo(
    () =>
      explorationRenders ||
      recordingRenders ||
      sessionRenders ||
      uploadedRenders,
    [explorationRenders, recordingRenders, sessionRenders, uploadedRenders]
  );

  // Derived: selected state and its elements
  const selectedState = useMemo(
    () => discoveryResult?.states.find((s) => s.id === selectedStateId),
    [discoveryResult, selectedStateId]
  );

  const selectedStateElements = useMemo(
    () =>
      selectedState
        ? discoveryResult?.elements.filter((e) =>
            selectedState.state_image_ids.includes(e.id)
          )
        : [],
    [discoveryResult, selectedState]
  );

  const availableKnowledge = useMemo(
    () =>
      domainKnowledgeList.filter(
        (k) =>
          !selectedState?.domain_knowledge?.some((linked) => linked.id === k.id)
      ),
    [domainKnowledgeList, selectedState]
  );

  return {
    // Main tab
    mainTab,
    setMainTab,

    // History selection
    selectedHistoryExtractionId,
    setSelectedHistoryExtractionId,

    // Cleanup
    isCleaningUp,
    setIsCleaningUp,

    // Extraction state
    isExtracting,
    setIsExtracting,

    // UI-TARS progress
    uitarsProgress,
    setUitarsProgress,

    // Web extraction progress
    webExtractionProgress,
    setWebExtractionProgress,

    // Vision extraction progress
    visionExtractionProgress,
    setVisionExtractionProgress,

    // Sub-tabs
    visionResultsTab,
    setVisionResultsTab,
    webResultsTab,
    setWebResultsTab,

    // Polling
    pollingRef,

    // Extraction detail
    extractionDetail,
    setExtractionDetail,
    annotations,
    setAnnotations,
    isLoadingDetail,
    setIsLoadingDetail,

    // UI Bridge state
    isDiscovering,
    setIsDiscovering,
    isSaving,
    setIsSaving,
    isLoadingConfigs,
    setIsLoadingConfigs,
    discoveryResult,
    setDiscoveryResult,
    selectedStateId,
    setSelectedStateId,
    stateDescriptions,
    setStateDescriptions,
    uploadedRenders,
    setUploadedRenders,
    configName,
    setConfigName,
    discoveryStrategy,
    setDiscoveryStrategy,
    savedConfigs,
    setSavedConfigs,
    selectedConfigId,
    setSelectedConfigId,
    currentSavedConfigId,
    setCurrentSavedConfigId,

    // Domain knowledge
    domainKnowledgeList,
    setDomainKnowledgeList,
    _isLoadingKnowledge,
    setIsLoadingKnowledge,
    showKnowledgeDialog,
    setShowKnowledgeDialog,
    newKnowledgeTitle,
    setNewKnowledgeTitle,
    newKnowledgeContent,
    setNewKnowledgeContent,
    isCreatingKnowledge,
    setIsCreatingKnowledge,
    showLinkKnowledgeDialog,
    setShowLinkKnowledgeDialog,

    // State UUID map
    stateUuidMap,
    setStateUuidMap,

    // Render log sessions
    renderLogSessions,
    setRenderLogSessions,
    isLoadingSessions,
    setIsLoadingSessions,
    selectedSessionId,
    setSelectedSessionId,
    sessionRenders,
    setSessionRenders,
    isLoadingSessionRenders,
    setIsLoadingSessionRenders,

    // Exploration / recording renders
    explorationRenders,
    setExplorationRenders,
    recordingRenders,
    setRecordingRenders,

    // Runner connections
    selectedConnectionId,
    setSelectedConnectionId,

    // Refs
    methodSetRef,
    autoLoadedRef,

    // Derived
    rendersToAnalyze,
    selectedState,
    selectedStateElements,
    availableKnowledge,
  };
}

export type ExtractionState = ReturnType<typeof useExtractionState>;
