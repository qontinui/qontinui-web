"use client";

/**
 * Unified Extraction Page
 *
 * Supports multiple extraction methods:
 * - Web Extraction (DOM-based via Playwright)
 * - UI-TARS Web (Vision-based for websites)
 * - UI-TARS Desktop (Vision-based for native apps)
 * - Image Extraction (Template matching)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useProjectLoader } from "@/hooks/use-project-loader";
import { useUnifiedExtractionConfig } from "@/hooks/use-unified-extraction-config";
import { RequireProject } from "@/components/require-project";
import { runnerClient } from "@/lib/runner-client";
import { ExtractionMethodSelector } from "@/components/extraction/ExtractionMethodSelector";
import { UITarsConfigPanel } from "@/components/extraction/UITarsConfigPanel";
import {
  UITarsProgressPanel,
  type UITarsProgress,
} from "@/components/extraction/UITarsProgressPanel";
import { ExtractionConfigPanel } from "@/components/web-extraction/ExtractionConfigPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Loader2, Play, AlertCircle, Info, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type MainTab = "configuration" | "results";

export default function UnifiedExtractionPage() {
  return (
    <RequireProject pageName="Extraction">
      <UnifiedExtractionContent />
    </RequireProject>
  );
}

// Runner API base URL
const RUNNER_API_URL = "http://localhost:9876";

function UnifiedExtractionContent() {
  const { projectId } = useProjectLoader();
  const extractionConfig = useUnifiedExtractionConfig();

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

  const { config, setMethod, setSelectedMonitors, setUitarsConfig, isLoaded } =
    extractionConfig;

  // Poll for UI-TARS extraction status
  const pollExtractionStatus = useCallback(async () => {
    try {
      const response = await fetch(`${RUNNER_API_URL}/uitars-extraction/status`);
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
  }, [config.uitarsConfig.maxSteps]);

  // Poll for web extraction status
  const pollWebExtractionStatus = useCallback(async () => {
    try {
      const response = await runnerClient.getExtractionStatus();
      if (response.success && response.data) {
        const { is_running, stats } = response.data;

        if (!is_running) {
          // Extraction finished
          setIsExtracting(false);
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }

          // Determine if it was success or failure based on errors
          const hasErrors = (stats?.errors ?? 0) > 0;
          setWebExtractionProgress((prev) => ({
            ...prev,
            status: hasErrors ? "failed" : "completed",
            statesFound: stats?.states_found ?? 0,
            transitionsFound: stats?.transitions_found ?? 0,
            pagesExtracted: stats?.pages_extracted ?? 0,
            errors: stats?.errors ?? 0,
          }));

          if (hasErrors) {
            toast.error(`Extraction completed with ${stats?.errors} errors`);
          } else {
            toast.success("Web extraction completed successfully!");
          }
        } else {
          // Still running, update progress
          setWebExtractionProgress((prev) => ({
            ...prev,
            status: "running",
            statesFound: stats?.states_found ?? 0,
            transitionsFound: stats?.transitions_found ?? 0,
            pagesExtracted: stats?.pages_extracted ?? 0,
            errors: stats?.errors ?? 0,
          }));
        }
      }
    } catch (error) {
      console.error("Error polling web extraction status:", error);
    }
  }, []);

  // Start polling when extraction starts
  useEffect(() => {
    if (isExtracting && config.method === "web") {
      // Initial poll
      pollWebExtractionStatus();
      // Set up polling interval (every 2 seconds)
      pollingRef.current = setInterval(pollWebExtractionStatus, 2000);
    } else if (isExtracting && (config.method === "uitars-web" || config.method === "uitars-desktop")) {
      // Initial poll
      pollExtractionStatus();
      // Set up polling interval (every 2 seconds)
      pollingRef.current = setInterval(pollExtractionStatus, 2000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isExtracting, config.method, pollExtractionStatus, pollWebExtractionStatus]);

  // Stop extraction handler
  const handleStopExtraction = async () => {
    try {
      if (config.method === "web") {
        // Stop web extraction
        await runnerClient.stopExtraction();
        setWebExtractionProgress((prev) => ({ ...prev, status: "idle" }));
      } else {
        // Stop UI-TARS extraction
        const response = await fetch(`${RUNNER_API_URL}/uitars-extraction/stop`, {
          method: "POST",
        });
        if (!response.ok) {
          console.error("Failed to stop UI-TARS extraction");
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
        // Web extraction - use the correct endpoint
        const validUrls = config.webConfig.urls.filter((u) => u.trim() !== "");

        // Reset web extraction progress
        setWebExtractionProgress({
          status: "running",
          extractionId: null,
          statesFound: 0,
          transitionsFound: 0,
          pagesExtracted: 0,
          errors: 0,
        });

        const response = await runnerClient.startExtraction({
          urls: validUrls,
          viewports: [[1920, 1080]],
          capture_hover_states: config.webConfig.captureHover,
          capture_focus_states: config.webConfig.captureFocus,
          max_depth: config.webConfig.maxDepth,
          max_pages: config.webConfig.maxPages,
        });

        if (!response.success) {
          throw new Error(response.error || "Failed to start web extraction");
        }

        if (response.data?.extraction_id) {
          setWebExtractionProgress((prev) => ({
            ...prev,
            extractionId: response.data!.extraction_id!,
          }));
        }

        toast.info("Starting web extraction...");
        setIsExtracting(true);
        setMainTab("results");
      } else {
        // UI-TARS extraction
        // Reset progress
        setUitarsProgress({
          status: "starting",
          currentStep: 0,
          maxSteps: config.uitarsConfig.maxSteps,
          elapsedSeconds: 0,
          statesDiscovered: 0,
          transitionsDiscovered: 0,
        });

        // Build request body based on method
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

        const response = await fetch(`${RUNNER_API_URL}/uitars-extraction/start`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
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
                Extraction
              </span>
              <Badge
                variant="outline"
                className="text-[10px] px-2"
                style={{ borderColor: methodColor, color: methodColor }}
              >
                {config.method.replace("-", " ").toUpperCase()}
              </Badge>
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
                  className="data-[state=active]:bg-opacity-20 font-mono px-6 h-9 transition-all"
                  style={{
                    "--tw-bg-opacity": "0.2",
                  } as React.CSSProperties}
                >
                  Configuration
                </TabsTrigger>
                <TabsTrigger
                  value="results"
                  className="data-[state=active]:bg-opacity-20 font-mono px-6 h-9 transition-all"
                >
                  Results
                </TabsTrigger>
              </TabsList>

              <Button
                onClick={handleStartExtraction}
                disabled={isExtracting}
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
                      {/* UI-TARS Progress Panel (shown when extracting) */}
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
                            // Adapt unified config to legacy format expected by ExtractionConfigPanel
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
                            setConfig: () => {}, // Not used by the panel
                            resetConfig: extractionConfig.resetConfig,
                          }}
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

                      {config.method === "image" && (
                        <Card className="p-6 bg-surface-raised/60 border-border-subtle">
                          <div className="flex flex-col items-center justify-center py-8 text-center">
                            <Info className="h-12 w-12 text-brand-success/40 mb-4" />
                            <h3 className="text-lg font-medium mb-2">
                              Image Extraction
                            </h3>
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

                        {(config.method === "uitars-web" ||
                          config.method === "uitars-desktop") && (
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
              className="mt-0 layout-full-height data-[state=inactive]:hidden"
            >
              <div className="space-y-6 py-6">
                {/* Show Web Extraction progress */}
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

                {/* Show UI-TARS progress in Results tab too */}
                {(config.method === "uitars-web" || config.method === "uitars-desktop") &&
                  uitarsProgress.status !== "idle" && (
                    <UITarsProgressPanel
                      progress={uitarsProgress}
                      onStop={handleStopExtraction}
                    />
                  )}

                {/* Show message when idle */}
                {((config.method === "web" && webExtractionProgress.status === "idle") ||
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

                {/* Show Web Extraction completed results summary */}
                {config.method === "web" && webExtractionProgress.status === "completed" && (
                  <Card className="p-6 bg-surface-raised/60 border-brand-success/30">
                    <div className="flex items-center gap-3 mb-4">
                      <CheckCircle2 className="h-5 w-5 text-brand-success" />
                      <h3 className="text-lg font-semibold text-brand-success">
                        Web Extraction Complete
                      </h3>
                    </div>
                    <p className="text-sm text-text-muted mb-4">
                      Discovered {webExtractionProgress.statesFound} states and{" "}
                      {webExtractionProgress.transitionsFound} transitions from{" "}
                      {webExtractionProgress.pagesExtracted} pages. The results
                      are ready to be imported into your state machine.
                    </p>
                    <Button
                      variant="outline"
                      className="border-brand-success/50 text-brand-success hover:bg-brand-success/10"
                    >
                      Import to State Machine
                    </Button>
                  </Card>
                )}

                {/* Show Web Extraction failed message */}
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

                {/* Show UI-TARS completed results summary */}
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
                      {uitarsProgress.transitionsDiscovered} transitions. The results
                      are ready to be imported into your state machine.
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
