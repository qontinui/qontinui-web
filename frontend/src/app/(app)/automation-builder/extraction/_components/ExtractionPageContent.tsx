"use client";

import { useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useProjectLoader } from "@/hooks/use-project-loader";
import { useUnifiedExtractionConfig } from "@/hooks/use-unified-extraction-config";
import type { ExtractionMethod } from "@/types/extraction-unified";
import { runnerClient } from "@/lib/runner-client";
import { ExtractionMethodSelector } from "@/components/extraction/ExtractionMethodSelector";
import { UITarsConfigPanel } from "@/components/extraction/UITarsConfigPanel";
import { VisionConfigPanel } from "@/components/extraction/VisionConfigPanel";
import {
  AnnotationEditor,
  AnnotationToolbar,
  ElementAnnotationForm,
  TrainingDataExportDialog,
} from "@/components/extraction";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";
import { UITarsProgressPanel } from "@/components/extraction/UITarsProgressPanel";
import { WebExtractionProgressPanel } from "@/components/extraction/WebExtractionProgressPanel";
import { ExtractionConfigPanel } from "@/components/web-extraction/ExtractionConfigPanel";
import { StateExplorerView } from "@/components/web-extraction/StateExplorerView";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  BookOpen,
  Plus,
  Eye,
  Pencil,
  History,
  Clock,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { useStateDiscoveryResults } from "@/hooks/useStateDiscoveryResults";
import { UnifiedResultsSection } from "@/components/state-machine/UnifiedResultsSection";
import type { MainTab } from "../_types";
import {
  useExtractionState,
  useWebExtraction,
  useUITarsExtraction,
  useVisionExtraction,
  useUIBridgeSection,
  useDomainKnowledge,
  useDiscoveryConfig,
} from "../_hooks";
import { UIBridgeConfigSection } from "./UIBridgeConfigSection";
import { UIBridgeResultsSection } from "./UIBridgeResultsSection";
import { createLogger } from "@/lib/logger";
const logger = createLogger("ExtractionPageContent");

function ExtractionPageContentInner() {
  const { projectId } = useProjectLoader();
  const searchParams = useSearchParams();
  const extractionConfig = useUnifiedExtractionConfig();

  const { config, setMethod, setUitarsConfig, setVisionConfig, isLoaded } =
    extractionConfig;

  // Centralized state
  const state = useExtractionState();

  // UI Bridge section (connections, exploration, recording)
  const uiBridge = useUIBridgeSection({
    state,
    configMethod: config.method,
  });

  // Web extraction
  const webExtraction = useWebExtraction({
    projectId,
    state,
    configMethod: config.method,
    webConfig: config.webConfig,
    isLoaded,
  });

  // UI-TARS extraction
  const uitarsExtraction = useUITarsExtraction({
    state,
    uitarsConfig: config.uitarsConfig,
    configMethod: config.method,
    selectedMonitors: config.selectedMonitors,
    getRunnerUrl: uiBridge.getRunnerUrl,
  });

  // Vision extraction
  const visionExtraction = useVisionExtraction({
    state,
    visionConfig: config.visionConfig,
    getRunnerUrl: uiBridge.getRunnerUrl,
  });

  // Domain knowledge
  const domainKnowledge = useDomainKnowledge({
    projectId,
    state,
    configMethod: config.method,
  });

  // Discovery config
  const discoveryConfig = useDiscoveryConfig({
    projectId,
    state,
    configMethod: config.method,
  });

  // Unified state discovery results
  const {
    results: unifiedResults,
    isLoading: isLoadingUnifiedResults,
    error: unifiedResultsError,
    selectedResult: selectedUnifiedResult,
    isLoadingDetail: isLoadingUnifiedDetail,
    selectResult: selectUnifiedResult,
    clearSelection: clearUnifiedSelection,
    deleteResult: deleteUnifiedResult,
    refresh: refreshUnifiedResults,
  } = useStateDiscoveryResults({ projectId });

  // Annotation store
  const annotationStore = useExtractionAnnotationStore();

  // Check for method query param on mount
  const methodFromUrl = searchParams.get("method") as ExtractionMethod | null;

  useEffect(() => {
    if (isLoaded && methodFromUrl && !state.methodSetRef.current) {
      const validMethods: ExtractionMethod[] = [
        "web",
        "ui-bridge",
        "uitars-web",
        "uitars-desktop",
        "image",
        "vision",
      ];
      if (validMethods.includes(methodFromUrl)) {
        setMethod(methodFromUrl);
        state.methodSetRef.current = true;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- methodSetRef is stable
  }, [isLoaded, methodFromUrl, setMethod]);

  // Start polling when extraction starts
  useEffect(() => {
    if (state.isExtracting && config.method === "web") {
      webExtraction.pollWebExtractionStatus();
      state.pollingRef.current = setInterval(
        webExtraction.pollWebExtractionStatus,
        3000
      );
    } else if (
      state.isExtracting &&
      (config.method === "uitars-web" || config.method === "uitars-desktop")
    ) {
      uitarsExtraction.pollExtractionStatus();
      state.pollingRef.current = setInterval(
        uitarsExtraction.pollExtractionStatus,
        2000
      );
    }

    return () => {
      if (state.pollingRef.current) {
        clearInterval(state.pollingRef.current);
        state.pollingRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pollingRef is stable
  }, [
    state.isExtracting,
    config.method,
    uitarsExtraction.pollExtractionStatus,
    webExtraction.pollWebExtractionStatus,
  ]);

  // Stop extraction handler
  const handleStopExtraction = useCallback(async () => {
    try {
      if (config.method === "web") {
        await runnerClient.stopExtraction();
        state.setWebExtractionProgress((prev) => ({
          ...prev,
          status: "idle",
        }));
      } else {
        const runnerUrl = uiBridge.getRunnerUrl(state.selectedRunnerId);
        if (runnerUrl) {
          const response = await fetch(`${runnerUrl}/uitars-extraction/stop`, {
            method: "POST",
          });
          if (!response.ok) {
            logger.error("Failed to stop UI-TARS extraction");
          }
        }
      }
      toast.info("Extraction stopped");
    } catch (error) {
      logger.error("Failed to stop extraction:", error);
    }
    state.setIsExtracting(false);
    if (state.pollingRef.current) {
      clearInterval(state.pollingRef.current);
      state.pollingRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters and refs are stable
  }, [config.method, uiBridge.getRunnerUrl, state.selectedRunnerId]);

  // Start extraction handler
  const handleStartExtraction = useCallback(async () => {
    if (!projectId) {
      toast.error("No project selected");
      return;
    }

    // Validate configuration based on method
    if (config.method === "web") {
      // Validation is in startWebExtraction
    } else if (config.method === "uitars-web") {
      const validUrls =
        config.uitarsConfig.urls?.filter((u) => u.trim() !== "") || [];
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
        await webExtraction.startWebExtraction();
      } else if (config.method === "vision") {
        await visionExtraction.startVisionExtraction();
      } else {
        await uitarsExtraction.startUITarsExtraction();
      }
    } catch (error) {
      logger.error("Failed to start extraction:", error);
      toast.error(
        `Failed to start extraction: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      state.setIsExtracting(false);
      if (config.method === "web") {
        state.setWebExtractionProgress((prev) => ({
          ...prev,
          status: "failed",
          errorMessage: String(error),
        }));
      } else if (config.method === "vision") {
        state.setVisionExtractionProgress((prev) => ({
          ...prev,
          status: "failed",
          errorMessage: String(error),
        }));
      } else {
        state.setUitarsProgress((prev) => ({
          ...prev,
          status: "failed",
          errorMessage: String(error),
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable
  }, [
    projectId,
    config.method,
    config.uitarsConfig,
    webExtraction.startWebExtraction,
    visionExtraction.startVisionExtraction,
    uitarsExtraction.startUITarsExtraction,
  ]);

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
      case "vision":
        return "#9B59B6";
      case "image":
        return "var(--brand-success)";
      default:
        return "var(--brand-primary)";
    }
  };

  const methodColor = getMethodColor();

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
                style={{
                  color: `color-mix(in oklch, ${methodColor} 60%, transparent)`,
                }}
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
                  <Dialog
                    open={state.showKnowledgeDialog}
                    onOpenChange={state.setShowKnowledgeDialog}
                  >
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        <BookOpen className="h-4 w-4 mr-2" />
                        Domain Knowledge ({state.domainKnowledgeList.length})
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg">
                      <DialogHeader>
                        <DialogTitle>Create Domain Knowledge</DialogTitle>
                        <DialogDescription>
                          Add reusable knowledge that can be linked to multiple
                          states.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <label
                            htmlFor="epc-knowledge-title"
                            className="text-sm font-medium mb-2 block"
                          >
                            Title
                          </label>
                          <Input
                            id="epc-knowledge-title"
                            placeholder="e.g., What is user authentication?"
                            value={state.newKnowledgeTitle}
                            onChange={(e) =>
                              state.setNewKnowledgeTitle(e.target.value)
                            }
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="epc-knowledge-content"
                            className="text-sm font-medium mb-2 block"
                          >
                            Content
                          </label>
                          <Textarea
                            id="epc-knowledge-content"
                            placeholder="Explain the concept, expected behavior, or requirements..."
                            value={state.newKnowledgeContent}
                            onChange={(e) =>
                              state.setNewKnowledgeContent(e.target.value)
                            }
                            className="min-h-[150px]"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => state.setShowKnowledgeDialog(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={domainKnowledge.createDomainKnowledge}
                          disabled={state.isCreatingKnowledge}
                        >
                          {state.isCreatingKnowledge ? (
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

        {/* Hidden test helper element */}
        <div
          id="extraction-page-state"
          data-extraction-status={state.webExtractionProgress.status}
          data-states-count={webExtraction.stateMachineStates.length}
          data-history-count={webExtraction.extractionHistory.length}
          data-is-loading={state.isLoadingDetail ? "true" : "false"}
          data-selected-extraction={state.selectedHistoryExtractionId || "none"}
          data-extraction-method={config.method}
          data-main-tab={state.mainTab}
          aria-hidden="true"
          style={{ display: "none" }}
        />

        {/* Tabs & Content */}
        <div className="container mx-auto px-6 py-6 layout-full-height">
          <Tabs
            value={state.mainTab}
            onValueChange={(v) => state.setMainTab(v as MainTab)}
            className="w-full layout-full-height"
          >
            <div className="flex items-center gap-3 mb-6 shrink-0">
              <TabsList className="bg-surface-raised/80 border border-border-subtle p-1 backdrop-blur-sm h-11">
                <TabsTrigger
                  value="configuration"
                  id="extraction-config-tab"
                  className="data-[state=active]:bg-opacity-20 font-mono px-6 h-9 transition-all"
                  style={{ "--tw-bg-opacity": "0.2" } as React.CSSProperties}
                >
                  Configuration
                </TabsTrigger>
                <TabsTrigger
                  value="results"
                  id="extraction-results-tab"
                  className="data-[state=active]:bg-opacity-20 font-mono px-6 h-9 transition-all"
                >
                  Results
                </TabsTrigger>
              </TabsList>

              {/* Start button - not shown for UI Bridge */}
              {config.method !== "ui-bridge" && (
                <Button
                  onClick={handleStartExtraction}
                  disabled={state.isExtracting}
                  id="extraction-start-btn"
                  className="font-mono h-11 px-6 transition-all"
                  style={{
                    backgroundColor: `color-mix(in oklch, ${methodColor} 10%, transparent)`,
                    color: methodColor,
                    borderColor: `color-mix(in oklch, ${methodColor} 40%, transparent)`,
                    boxShadow: `0 0 15px color-mix(in oklch, ${methodColor} 10%, transparent)`,
                  }}
                >
                  {state.isExtracting ? (
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
                      {(config.method === "uitars-web" ||
                        config.method === "uitars-desktop") &&
                        state.uitarsProgress.status !== "idle" && (
                          <UITarsProgressPanel
                            progress={state.uitarsProgress}
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
                            setSelectedMonitors:
                              extractionConfig.setSelectedMonitors,
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
                          exploration={uiBridge.exploration}
                          explorationRenders={state.explorationRenders}
                          setExplorationRenders={state.setExplorationRenders}
                          recording={uiBridge.recording}
                          recordingRenders={state.recordingRenders}
                          setRecordingRenders={state.setRecordingRenders}
                          sessionRenders={state.sessionRenders}
                          setSessionRenders={state.setSessionRenders}
                          uploadedRenders={state.uploadedRenders}
                          setUploadedRenders={state.setUploadedRenders}
                          renderLogSessions={state.renderLogSessions}
                          isLoadingSessions={state.isLoadingSessions}
                          selectedSessionId={state.selectedSessionId}
                          setSelectedSessionId={state.setSelectedSessionId}
                          isLoadingSessionRenders={
                            state.isLoadingSessionRenders
                          }
                          loadRenderLogSessions={uiBridge.loadRenderLogSessions}
                          loadSessionRenders={uiBridge.loadSessionRenders}
                          savedConfigs={state.savedConfigs}
                          selectedConfigId={state.selectedConfigId}
                          setSelectedConfigId={state.setSelectedConfigId}
                          loadSavedConfig={discoveryConfig.loadSavedConfig}
                          handleFileUpload={uiBridge.handleFileUpload}
                          rendersToAnalyze={state.rendersToAnalyze}
                          discoveryResult={state.discoveryResult}
                          configName={state.configName}
                          setConfigName={state.setConfigName}
                          isDiscovering={state.isDiscovering}
                          runDiscovery={discoveryConfig.runDiscovery}
                          isSaving={state.isSaving}
                          saveDiscoveredStates={
                            discoveryConfig.saveDiscoveredStates
                          }
                          setDiscoveryResult={state.setDiscoveryResult}
                          setStateDescriptions={state.setStateDescriptions}
                          setCurrentSavedConfigId={
                            state.setCurrentSavedConfigId
                          }
                          setStateUuidMap={state.setStateUuidMap}
                          discoveryStrategy={state.discoveryStrategy}
                          setDiscoveryStrategy={state.setDiscoveryStrategy}
                          runners={uiBridge.runners}
                          runnersLoading={uiBridge.runnersLoading}
                          selectedRunnerId={state.selectedRunnerId}
                          onRunnerChange={uiBridge.onRunnerChange}
                          getRunnerUrl={uiBridge.getRunnerUrl}
                          onRefreshBrowserTabs={
                            uiBridge.handleRefreshBrowserTabs
                          }
                          onSelectBrowserTab={uiBridge.handleSelectBrowserTab}
                        />
                      )}

                      {(config.method === "uitars-web" ||
                        config.method === "uitars-desktop") && (
                        <UITarsConfigPanel
                          method={config.method}
                          config={config.uitarsConfig}
                          onConfigChange={setUitarsConfig}
                        />
                      )}

                      {config.method === "vision" && (
                        <VisionConfigPanel
                          config={config.visionConfig}
                          onConfigChange={setVisionConfig}
                        />
                      )}

                      {config.method === "image" && (
                        <Card className="p-6 bg-surface-raised/60 border-border-subtle">
                          <div className="flex flex-col items-center justify-center py-8 text-center">
                            <Info className="h-12 w-12 text-brand-success/40 mb-4" />
                            <h3 className="text-lg font-medium mb-2">
                              Image Extraction
                            </h3>
                            <p className="text-sm text-text-muted max-w-md">
                              Image extraction uses template matching to find
                              patterns. Use the Image Extraction tool in the
                              Create menu for cutting patterns from screenshots.
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
                      style={{
                        borderColor: `color-mix(in oklch, ${methodColor} 10%, transparent)`,
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Info
                          className="h-4 w-4"
                          style={{ color: methodColor }}
                        />
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
                              Web Extraction uses Playwright to crawl web pages
                              and discover UI elements through DOM analysis.
                            </p>
                            <div className="space-y-2">
                              <p
                                className="font-medium"
                                style={{ color: methodColor }}
                              >
                                Features:
                              </p>
                              <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>
                                  Automatic state discovery from page structure
                                </li>
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
                              UI Bridge discovers application states by
                              capturing render logs (UI snapshots) during
                              exploration, then using co-occurrence analysis to
                              identify distinct states.
                            </p>
                            <div className="space-y-2">
                              <p
                                className="font-medium"
                                style={{ color: methodColor }}
                              >
                                How it works:
                              </p>
                              <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>
                                  Explores interactive elements (clicks buttons,
                                  tabs, links)
                                </li>
                                <li>Captures UI snapshots after each action</li>
                                <li>
                                  Groups co-occurring elements into states
                                </li>
                                <li>Discovers transitions between states</li>
                              </ul>
                            </div>
                            <div className="space-y-2">
                              <p
                                className="font-medium"
                                style={{ color: methodColor }}
                              >
                                Supported Targets:
                              </p>
                              <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>
                                  Browser Extension (any website via Chrome)
                                </li>
                                <li>Web apps with UI Bridge SDK</li>
                                <li>Desktop apps (Tauri, Electron)</li>
                                <li>Mobile apps (React Native)</li>
                              </ul>
                            </div>
                            <div className="space-y-2">
                              <p
                                className="font-medium"
                                style={{ color: methodColor }}
                              >
                                Input Sources:
                              </p>
                              <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>
                                  Auto Explore: Automated element discovery
                                </li>
                                <li>
                                  Manual Recording: Navigate while capturing
                                </li>
                                <li>From Session: Load previous exploration</li>
                                <li>
                                  Upload/Load: Import JSON or saved configs
                                </li>
                              </ul>
                            </div>
                          </>
                        )}

                        {(config.method === "uitars-web" ||
                          config.method === "uitars-desktop") && (
                          <>
                            <p>
                              UI-TARS uses vision-language models to
                              autonomously explore GUIs through visual
                              understanding.
                            </p>
                            <div className="space-y-2">
                              <p
                                className="font-medium"
                                style={{ color: methodColor }}
                              >
                                Features:
                              </p>
                              <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>
                                  Thought-Action decomposition for reasoning
                                </li>
                                <li>
                                  Natural language goal-driven exploration
                                </li>
                                <li>Works with any GUI (web or desktop)</li>
                                <li>Local or cloud inference options</li>
                              </ul>
                            </div>
                            <div className="space-y-2">
                              <p
                                className="font-medium"
                                style={{ color: methodColor }}
                              >
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

                        {config.method === "vision" && (
                          <>
                            <p>
                              Vision Extraction uses computer vision algorithms
                              to detect GUI elements from screenshots.
                            </p>
                            <div className="space-y-2">
                              <p
                                className="font-medium"
                                style={{ color: methodColor }}
                              >
                                Detection Methods:
                              </p>
                              <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>
                                  Edge Detection: Canny + contour analysis
                                </li>
                                <li>SAM3: Segment Anything Model 3</li>
                                <li>OCR: Text region detection</li>
                                <li>Result Fusion: Deduplicate & merge</li>
                              </ul>
                            </div>
                            <div className="space-y-2">
                              <p
                                className="font-medium"
                                style={{ color: methodColor }}
                              >
                                Best for:
                              </p>
                              <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>Non-web applications (no DOM access)</li>
                                <li>Legacy desktop software</li>
                                <li>Remote desktop sessions</li>
                                <li>Creating training datasets</li>
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
                              <p
                                className="font-medium"
                                style={{ color: methodColor }}
                              >
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
                            <strong>Note:</strong> This feature requires the
                            Desktop Runner to be connected.
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
              id="extraction-results-content"
              data-history-count={webExtraction.extractionHistory.length}
              data-extraction-method={config.method}
              data-extraction-status={state.webExtractionProgress.status}
              data-states-count={webExtraction.stateMachineStates.length}
              data-is-loading={state.isLoadingDetail ? "true" : "false"}
              data-selected-extraction={
                state.selectedHistoryExtractionId || "none"
              }
            >
              <div className="flex flex-col gap-4 flex-1 min-h-0">
                {/* Unified State Discovery Results */}
                {unifiedResults.length > 0 && projectId && (
                  <Collapsible defaultOpen={true}>
                    <Card className="bg-surface-raised/60 border-border-subtle">
                      <CollapsibleTrigger className="w-full">
                        <div className="flex items-center justify-between p-4">
                          <div className="flex items-center gap-3">
                            <Layers className="h-5 w-5 text-brand-primary" />
                            <span className="text-sm font-medium">
                              Unified State Machines
                            </span>
                            <Badge
                              variant="outline"
                              className="text-brand-primary border-brand-primary/50"
                            >
                              {unifiedResults.length}
                            </Badge>
                          </div>
                          <ChevronRight className="h-4 w-4 text-text-muted transition-transform ui-expanded:rotate-90" />
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="px-4 pb-4">
                          <UnifiedResultsSection
                            results={unifiedResults}
                            isLoading={isLoadingUnifiedResults}
                            error={unifiedResultsError}
                            selectedResult={selectedUnifiedResult}
                            isLoadingDetail={isLoadingUnifiedDetail}
                            onSelectResult={selectUnifiedResult}
                            onClearSelection={clearUnifiedSelection}
                            onDeleteResult={deleteUnifiedResult}
                            onRefresh={refreshUnifiedResults}
                            projectId={projectId}
                          />
                        </div>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>
                )}

                {/* Extraction History Selector - Only for web extraction */}
                {config.method === "web" &&
                  webExtraction.extractionHistory.length > 0 && (
                    <Card className="p-4 bg-surface-raised/60 border-border-subtle">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <History className="h-5 w-5 text-text-muted" />
                          <Label className="text-sm font-medium">
                            Extraction History
                          </Label>
                          {webExtraction.staleExtractions.length > 0 && (
                            <Badge
                              variant="outline"
                              className="text-yellow-500 border-yellow-500/50"
                            >
                              {webExtraction.staleExtractions.length} stale
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {webExtraction.staleExtractions.length > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={webExtraction.cleanupStaleExtractions}
                              disabled={state.isCleaningUp}
                              className="text-yellow-500 border-yellow-500/50 hover:bg-yellow-500/10"
                            >
                              {state.isCleaningUp ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              ) : (
                                <Trash2 className="h-4 w-4 mr-1" />
                              )}
                              Clean up
                            </Button>
                          )}
                          <Select
                            value={state.selectedHistoryExtractionId || ""}
                            onValueChange={(value) => {
                              if (!value) return;
                              const extraction =
                                webExtraction.extractionHistory.find(
                                  (e) => e.id === value
                                );
                              if (extraction) {
                                state.setSelectedHistoryExtractionId(value);
                                state.setWebExtractionProgress({
                                  status:
                                    extraction.status === "completed"
                                      ? "completed"
                                      : extraction.status === "failed"
                                        ? "failed"
                                        : "idle",
                                  extractionId: value,
                                  statesFound:
                                    extraction.state_machine?.states?.length ??
                                    0,
                                  transitionsFound:
                                    extraction.state_machine?.transitions
                                      ?.length ?? 0,
                                  pagesExtracted:
                                    ((
                                      extraction.stats as Record<
                                        string,
                                        unknown
                                      >
                                    )?.pages_extracted as number) ?? 0,
                                  errors:
                                    ((
                                      extraction.stats as Record<
                                        string,
                                        unknown
                                      >
                                    )?.errors as number) ?? 0,
                                  errorMessage:
                                    extraction.error_message ?? undefined,
                                });
                              }
                            }}
                            disabled={
                              webExtraction.isLoadingHistory ||
                              state.webExtractionProgress.status === "running"
                            }
                          >
                            <SelectTrigger
                              className="w-[350px]"
                              id="extraction-history-select"
                            >
                              <SelectValue
                                placeholder={
                                  webExtraction.isLoadingHistory
                                    ? "Loading..."
                                    : "Select an extraction"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {webExtraction.extractionHistory.map(
                                (extraction) => {
                                  const isStale =
                                    (extraction.status === "running" ||
                                      extraction.status === "pending") &&
                                    Date.now() -
                                      new Date(
                                        extraction.created_at
                                      ).getTime() >
                                      60 * 60 * 1000;

                                  return (
                                    <SelectItem
                                      key={extraction.id}
                                      value={extraction.id}
                                    >
                                      <div className="flex items-center gap-2">
                                        {extraction.status === "completed" ? (
                                          <CheckCircle2 className="h-3 w-3 text-brand-success" />
                                        ) : extraction.status === "failed" ? (
                                          <AlertCircle className="h-3 w-3 text-red-500" />
                                        ) : isStale ? (
                                          <span title="Possibly stale - extraction may have been interrupted">
                                            <AlertCircle className="h-3 w-3 text-yellow-500" />
                                          </span>
                                        ) : extraction.status === "running" ? (
                                          <Loader2 className="h-3 w-3 animate-spin text-brand-primary" />
                                        ) : (
                                          <Clock className="h-3 w-3 text-text-muted" />
                                        )}
                                        <span className="font-mono text-xs">
                                          {new Date(
                                            extraction.created_at
                                          ).toLocaleDateString()}{" "}
                                          {new Date(
                                            extraction.created_at
                                          ).toLocaleTimeString()}
                                        </span>
                                        <span className="text-text-muted">
                                          ({extraction.source_urls?.length ?? 0}{" "}
                                          URLs,{" "}
                                          {extraction.state_machine?.states
                                            ?.length ?? 0}{" "}
                                          states)
                                          {isStale && " - interrupted?"}
                                        </span>
                                      </div>
                                    </SelectItem>
                                  );
                                }
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </Card>
                  )}

                {/* Web Extraction progress */}
                {config.method === "web" &&
                  state.webExtractionProgress.status === "running" && (
                    <WebExtractionProgressPanel
                      progress={{
                        ...state.webExtractionProgress,
                        maxPages: config.webConfig.maxPages,
                      }}
                      onStop={handleStopExtraction}
                    />
                  )}

                {/* UI-TARS progress */}
                {(config.method === "uitars-web" ||
                  config.method === "uitars-desktop") &&
                  state.uitarsProgress.status !== "idle" && (
                    <UITarsProgressPanel
                      progress={state.uitarsProgress}
                      onStop={handleStopExtraction}
                    />
                  )}

                {/* UI Bridge Results */}
                {config.method === "ui-bridge" && (
                  <UIBridgeResultsSection
                    discoveryResult={state.discoveryResult}
                    isLoadingConfigs={state.isLoadingConfigs}
                    selectedStateId={state.selectedStateId}
                    setSelectedStateId={state.setSelectedStateId}
                    selectedState={state.selectedState}
                    selectedStateElements={state.selectedStateElements}
                    stateDescriptions={state.stateDescriptions}
                    updateStateDescription={
                      discoveryConfig.updateStateDescription
                    }
                    currentSavedConfigId={state.currentSavedConfigId}
                    projectId={projectId}
                    showLinkKnowledgeDialog={state.showLinkKnowledgeDialog}
                    setShowLinkKnowledgeDialog={
                      state.setShowLinkKnowledgeDialog
                    }
                    availableKnowledge={state.availableKnowledge}
                    linkKnowledgeToState={domainKnowledge.linkKnowledgeToState}
                    unlinkKnowledgeFromState={
                      domainKnowledge.unlinkKnowledgeFromState
                    }
                  />
                )}

                {/* Vision Extraction Results */}
                {config.method === "vision" &&
                  state.visionExtractionProgress.status === "running" && (
                    <Card className="p-6 bg-surface-raised/60 border-[#9B59B6]/30">
                      <div className="flex items-center gap-3">
                        <Loader2 className="h-5 w-5 animate-spin text-[#9B59B6]" />
                        <h3 className="text-lg font-semibold text-[#9B59B6]">
                          Running Vision Extraction...
                        </h3>
                      </div>
                      <p className="text-sm text-text-muted mt-2">
                        Analyzing screenshot with edge detection, SAM3, and
                        OCR...
                      </p>
                    </Card>
                  )}

                {config.method === "vision" &&
                  state.visionExtractionProgress.status === "completed" && (
                    <div className="flex flex-col gap-4 flex-1 min-h-0">
                      {/* Success Header */}
                      <Card className="p-4 bg-surface-raised/60 border-[#9B59B6]/30">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <CheckCircle2 className="h-5 w-5 text-[#9B59B6]" />
                            <h3 className="text-lg font-semibold text-[#9B59B6]">
                              Vision Extraction Complete
                            </h3>
                            <span className="text-sm text-text-muted">
                              Detected{" "}
                              {state.visionExtractionProgress.elementsDetected}{" "}
                              elements
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className="text-[10px] px-2 border-[#9B59B6]/50 text-[#9B59B6]"
                            >
                              {
                                annotationStore.elements.filter(
                                  (e) => e.isGroundTruth
                                ).length
                              }{" "}
                              ground truth
                            </Badge>
                            <TrainingDataExportDialog projectName="Vision Extraction" />
                          </div>
                        </div>
                      </Card>

                      {/* Results/Annotations Tabs */}
                      <Tabs
                        value={state.visionResultsTab}
                        onValueChange={(v) =>
                          state.setVisionResultsTab(
                            v as "results" | "annotations"
                          )
                        }
                      >
                        <TabsList className="bg-surface-raised/80 border border-border-subtle p-1">
                          <TabsTrigger
                            value="results"
                            className="flex items-center gap-2"
                          >
                            <Eye className="h-4 w-4" />
                            Results
                          </TabsTrigger>
                          <TabsTrigger
                            value="annotations"
                            className="flex items-center gap-2"
                          >
                            <Pencil className="h-4 w-4" />
                            Edit Annotations
                          </TabsTrigger>
                        </TabsList>

                        {/* Results View */}
                        <TabsContent value="results" className="mt-4">
                          <Card className="p-4 bg-surface-raised/60">
                            <h4 className="text-sm font-semibold mb-4 text-[#9B59B6]">
                              Detected Elements (
                              {annotationStore.elements.length})
                            </h4>
                            <ScrollArea className="h-[400px]">
                              <div className="space-y-2">
                                {annotationStore.elements.map((element) => (
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    key={element.id}
                                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                                      annotationStore.selectedElementIds.includes(
                                        element.id
                                      )
                                        ? "border-[#9B59B6] bg-[#9B59B6]/10"
                                        : "border-border-subtle hover:border-[#9B59B6]/50"
                                    }`}
                                    onClick={() =>
                                      annotationStore.selectElement(element.id)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        (
                                          e.currentTarget as HTMLElement
                                        ).click();
                                      }
                                    }}
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <Badge
                                          variant="outline"
                                          className="text-[10px]"
                                        >
                                          {element.elementType}
                                        </Badge>
                                        <span className="text-sm font-medium">
                                          {element.label}
                                        </span>
                                        {element.isGroundTruth && (
                                          <Badge className="text-[10px] bg-green-500/20 text-green-500 border-green-500/50">
                                            Ground Truth
                                          </Badge>
                                        )}
                                      </div>
                                      <span className="text-xs text-text-muted font-mono">
                                        {Math.round(element.confidence * 100)}%
                                      </span>
                                    </div>
                                    {element.text && (
                                      <p className="text-xs text-text-muted mt-1 truncate">
                                        {element.text}
                                      </p>
                                    )}
                                    <div className="text-[10px] text-text-muted mt-1 font-mono">
                                      {element.bbox.x}, {element.bbox.y} -{" "}
                                      {element.bbox.width}x{element.bbox.height}
                                    </div>
                                  </div>
                                ))}
                                {annotationStore.elements.length === 0 && (
                                  <div className="text-center py-8 text-text-muted">
                                    No elements detected
                                  </div>
                                )}
                              </div>
                            </ScrollArea>
                          </Card>
                        </TabsContent>

                        {/* Annotations Editor View */}
                        <TabsContent
                          value="annotations"
                          className="mt-4 flex-1 min-h-0"
                        >
                          <div className="grid grid-cols-[1fr_320px] gap-4 h-[600px]">
                            <div className="flex flex-col gap-2 min-h-0">
                              <AnnotationToolbar />
                              <AnnotationEditor className="flex-1" />
                            </div>
                            <div className="min-h-0 overflow-auto">
                              <ElementAnnotationForm />
                            </div>
                          </div>
                        </TabsContent>
                      </Tabs>
                    </div>
                  )}

                {config.method === "vision" &&
                  state.visionExtractionProgress.status === "failed" && (
                    <Card className="p-6 bg-surface-raised/60 border-red-500/30">
                      <div className="flex items-center gap-3 mb-4">
                        <AlertCircle className="h-5 w-5 text-red-500" />
                        <h3 className="text-lg font-semibold text-red-500">
                          Vision Extraction Failed
                        </h3>
                      </div>
                      <p className="text-sm text-text-muted">
                        {state.visionExtractionProgress.errorMessage ||
                          "An error occurred during vision extraction."}
                      </p>
                    </Card>
                  )}

                {/* Idle message for non-UI-Bridge methods */}
                {config.method !== "ui-bridge" &&
                  ((config.method === "web" &&
                    state.webExtractionProgress.status === "idle" &&
                    webExtraction.extractionHistory.length === 0) ||
                    ((config.method === "uitars-web" ||
                      config.method === "uitars-desktop") &&
                      state.uitarsProgress.status === "idle") ||
                    (config.method === "vision" &&
                      state.visionExtractionProgress.status === "idle") ||
                    config.method === "image") && (
                    <Alert className="bg-surface-raised/60 border-border-subtle backdrop-blur-sm">
                      <AlertCircle
                        className="h-4 w-4"
                        style={{ color: methodColor }}
                      />
                      <AlertDescription className="text-text-secondary font-mono">
                        No extraction results yet. Configure your extraction
                        settings and click &quot;Start Extraction&quot; to
                        begin.
                      </AlertDescription>
                    </Alert>
                  )}

                {/* Loading history */}
                {config.method === "web" && webExtraction.isLoadingHistory && (
                  <div className="flex items-center justify-center py-12">
                    <div className="flex flex-col items-center gap-4">
                      <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
                      <p className="text-text-muted text-sm">
                        Loading extraction history...
                      </p>
                    </div>
                  </div>
                )}

                {/* Web Extraction completed results */}
                {config.method === "web" &&
                  state.webExtractionProgress.status === "completed" && (
                    <div className="flex flex-col gap-4 flex-1 min-h-0">
                      {/* Success Header */}
                      <Card className="p-4 bg-surface-raised/60 border-brand-success/30">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <CheckCircle2 className="h-5 w-5 text-brand-success" />
                            <h3 className="text-lg font-semibold text-brand-success">
                              Web Extraction Complete
                            </h3>
                            {state.webExtractionProgress.elapsedSeconds !==
                              undefined && (
                              <span className="text-sm text-text-muted font-mono flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5" />
                                {state.webExtractionProgress.elapsedSeconds >=
                                60
                                  ? `${Math.floor(state.webExtractionProgress.elapsedSeconds / 60)}m ${state.webExtractionProgress.elapsedSeconds % 60}s`
                                  : `${state.webExtractionProgress.elapsedSeconds}s`}
                              </span>
                            )}
                            <span className="text-sm text-text-muted">
                              Discovered{" "}
                              {state.webExtractionProgress.statesFound} states
                              and {state.webExtractionProgress.transitionsFound}{" "}
                              transitions from{" "}
                              {state.webExtractionProgress.pagesExtracted}{" "}
                              pages.
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className="text-[10px] px-2 border-brand-success/50 text-brand-success"
                            >
                              {
                                annotationStore.elements.filter(
                                  (e) => e.isGroundTruth
                                ).length
                              }{" "}
                              ground truth
                            </Badge>
                            <TrainingDataExportDialog projectName="Web Extraction" />
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-brand-success/50 text-brand-success hover:bg-brand-success/10"
                            >
                              Import to State Machine
                            </Button>
                          </div>
                        </div>
                      </Card>

                      {state.isLoadingDetail ? (
                        <div
                          className="flex items-center justify-center py-24"
                          id="extraction-results-loading"
                        >
                          <div className="flex flex-col items-center gap-4">
                            <Loader2 className="h-12 w-12 animate-spin text-brand-success" />
                            <p className="text-brand-success font-mono animate-pulse uppercase tracking-widest text-xs">
                              Loading extraction results...
                            </p>
                          </div>
                        </div>
                      ) : webExtraction.stateMachineStates.length > 0 ? (
                        <Tabs
                          value={state.webResultsTab}
                          onValueChange={(v) => {
                            state.setWebResultsTab(
                              v as "explorer" | "annotations"
                            );
                            if (v === "annotations") {
                              webExtraction.loadWebElementsToAnnotationStore();
                            }
                          }}
                        >
                          <TabsList className="bg-surface-raised/80 border border-border-subtle p-1">
                            <TabsTrigger
                              value="explorer"
                              className="flex items-center gap-2"
                            >
                              <Layers className="h-4 w-4" />
                              State Explorer
                            </TabsTrigger>
                            <TabsTrigger
                              value="annotations"
                              className="flex items-center gap-2"
                            >
                              <Pencil className="h-4 w-4" />
                              Edit Annotations
                            </TabsTrigger>
                          </TabsList>

                          {/* State Explorer View */}
                          <TabsContent value="explorer" className="mt-4">
                            <div
                              className="flex-1 min-h-[500px]"
                              id="extraction-results-states-container"
                              data-state-count={
                                webExtraction.stateMachineStates.length
                              }
                              data-visible="true"
                            >
                              <StateExplorerView
                                states={webExtraction.stateMachineStates}
                                annotations={state.annotations}
                                extractionId={
                                  state.extractionDetail?.stats
                                    ?.screenshot_extraction_id ||
                                  state.webExtractionProgress.extractionId ||
                                  undefined
                                }
                              />
                            </div>
                          </TabsContent>

                          {/* Annotations Editor View */}
                          <TabsContent
                            value="annotations"
                            className="mt-4 flex-1 min-h-0"
                          >
                            <div className="grid grid-cols-[1fr_320px] gap-4 h-[600px]">
                              <div className="flex flex-col gap-2 min-h-0">
                                <AnnotationToolbar />
                                <AnnotationEditor className="flex-1" />
                              </div>
                              <div className="min-h-0 overflow-auto">
                                <ElementAnnotationForm />
                              </div>
                            </div>
                          </TabsContent>
                        </Tabs>
                      ) : (
                        <Alert
                          className="bg-surface-raised/60 border-brand-primary/30 backdrop-blur-sm"
                          id="extraction-results-no-states"
                        >
                          <AlertCircle className="h-4 w-4 text-brand-primary" />
                          <AlertDescription className="text-text-secondary font-mono">
                            No states found in the extraction results. The
                            extraction may still be syncing data.
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}

                {/* Web Extraction failed */}
                {config.method === "web" &&
                  state.webExtractionProgress.status === "failed" && (
                    <Card className="p-6 bg-surface-raised/60 border-red-500/30">
                      <div className="flex items-center gap-3 mb-4">
                        <AlertCircle className="h-5 w-5 text-red-500" />
                        <h3 className="text-lg font-semibold text-red-500">
                          Web Extraction Failed
                        </h3>
                      </div>
                      <p className="text-sm text-text-muted mb-4">
                        {state.webExtractionProgress.errorMessage ||
                          `Extraction completed with ${state.webExtractionProgress.errors} errors.`}
                      </p>
                    </Card>
                  )}

                {/* UI-TARS completed */}
                {(config.method === "uitars-web" ||
                  config.method === "uitars-desktop") &&
                  state.uitarsProgress.status === "completed" && (
                    <Card className="p-6 bg-surface-raised/60 border-brand-success/30">
                      <div className="flex items-center gap-3 mb-4">
                        <CheckCircle2 className="h-5 w-5 text-brand-success" />
                        <h3 className="text-lg font-semibold text-brand-success">
                          Extraction Complete
                        </h3>
                      </div>
                      <p className="text-sm text-text-muted mb-4">
                        UI-TARS discovered{" "}
                        {state.uitarsProgress.statesDiscovered} states and{" "}
                        {state.uitarsProgress.transitionsDiscovered}{" "}
                        transitions.
                      </p>
                      <Button
                        variant="outline"
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

export function ExtractionPageContent() {
  return (
    <Suspense fallback={null}>
      <ExtractionPageContentInner />
    </Suspense>
  );
}
