/**
 * Page Analyzer Component
 *
 * Multi-method DOM/UI element discovery for the web-based test builder.
 * Supports four analysis methods:
 * - UI Bridge: Fetch a snapshot from the UI Bridge SDK (web or runner frontend)
 * - Vision: Capture a screenshot and run vision-based element detection
 * - API Request: Execute saved API requests to get page data
 * - Step Output: Reuse outputs from recent workflow executions
 *
 * All collected analyses are displayed in a table for review before
 * sending to the AI for test generation.
 */

"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Loader2,
  Camera,
  Monitor,
  Network,
  Trash2,
  Eye,
  Check,
  X,
  AlertCircle,
  Play,
  RefreshCw,
  Sparkles,
  ScanSearch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { runnerFetch, RUNNER_API_BASE } from "@/lib/runner/api-client";

// =============================================================================
// Types
// =============================================================================

/** Bounding box for detected elements */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Detected element from page analysis */
export interface DetectedElement {
  id: string;
  label: string;
  element_type: string;
  text_content?: string;
  bounding_box: BoundingBox;
  confidence: number;
  selector?: string;
  attributes: Record<string, unknown>;
}

/** Page analysis result (from Playwright or Vision) */
export interface PageAnalysis {
  screenshot_base64?: string;
  annotated_screenshot_base64?: string;
  elements: DetectedElement[];
  source: "playwright" | "vision" | "ui_bridge";
  captured_at: string;
  monitor_index?: number;
  url?: string;
}

/** UI Bridge snapshot element */
export interface UIBridgeElement {
  id: string;
  tag: string;
  role?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  className?: string;
  attributes?: Record<string, string>;
  rect?: { x: number; y: number; width: number; height: number };
  children?: UIBridgeElement[];
}

/** UI Bridge snapshot result */
export interface UIBridgeSnapshot {
  url: string;
  title: string;
  elements: UIBridgeElement[];
  timestamp: string;
}

/** API request analysis result */
export interface ApiRequestAnalysis {
  id: string;
  request_name: string;
  method: string;
  url: string;
  response: unknown;
  status_code?: number;
  duration_ms?: number;
  executed_at: string;
  error?: string;
}

/** Step output from a workflow execution */
export interface StepOutput {
  id: string;
  step_type: string;
  step_name: string;
  executed_at: string;
  duration_ms: number;
  success: boolean;
  error?: string;
  command?: string;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
}

/** Live browser element from UI Bridge SDK */
export interface LiveBrowserElement {
  id: string;
  tagName: string;
  type: string;
  text?: string;
  label?: string;
  value?: string;
  checked?: boolean;
  visible: boolean;
  enabled: boolean;
  bounds: BoundingBox;
}

/** Live browser analysis data */
export interface LiveBrowserAnalysis {
  elements: LiveBrowserElement[];
  url: string;
  title: string;
  captured_at: string;
}

/** Analysis source type */
export type AnalysisSourceType =
  | "ui_bridge"
  | "vision"
  | "api_request"
  | "step_output";

/** A single collected analysis */
export type CollectedAnalysis =
  | { type: "ui_bridge"; id: string; name: string; data: UIBridgeSnapshot }
  | { type: "vision"; id: string; name: string; data: PageAnalysis }
  | { type: "api_request"; id: string; name: string; data: ApiRequestAnalysis }
  | { type: "step_output"; id: string; name: string; data: StepOutput };

/** All collected analyses for AI test generation */
export interface CollectedAnalysisSet {
  analyses: CollectedAnalysis[];
  collected_at: string;
}

/** Combined analysis data for the parent component */
export type AnalysisData =
  | { type: "single"; data: PageAnalysis }
  | { type: "collected"; data: CollectedAnalysisSet };

/** Saved API request from the runner library */
interface SavedApiRequest {
  id: string;
  name: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  body_content_type?: string;
}

/** Task run summary */
interface TaskRunSummary {
  id: string;
  task_name?: string;
  workflow_name?: string;
  status: string;
  created_at: string;
}

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/** Flatten a UI Bridge element tree into a flat list */
function flattenElements(
  elements: UIBridgeElement[],
  depth = 0
): Array<UIBridgeElement & { depth: number }> {
  const result: Array<UIBridgeElement & { depth: number }> = [];
  for (const el of elements) {
    result.push({ ...el, depth });
    if (el.children && el.children.length > 0) {
      result.push(...flattenElements(el.children, depth + 1));
    }
  }
  return result;
}

// =============================================================================
// Props
// =============================================================================

export interface PageAnalyzerProps {
  /** Called when analysis data is ready for consumption */
  onAnalysisComplete: (analysis: AnalysisData) => void;
  /** Called when an error occurs */
  onError?: (error: string) => void;
  /** Initial analyses to restore when component mounts */
  initialAnalyses?: CollectedAnalysis[];
}

// =============================================================================
// Component
// =============================================================================

export function PageAnalyzer({
  onAnalysisComplete,
  onError,
  initialAnalyses,
}: PageAnalyzerProps) {
  // ---- Collected analyses ----
  const [analyses, setAnalyses] = useState<CollectedAnalysis[]>(
    initialAnalyses ?? []
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ---- Active analysis tab ----
  const [activeTab, setActiveTab] = useState<string>("ui_bridge");

  // ---- Loading and error state ----
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- UI Bridge state ----
  const [uiBridgeUrl, setUiBridgeUrl] = useState(
    "http://localhost:3001/api/ui-bridge"
  );
  const [uiBridgeTarget, setUiBridgeTarget] = useState<"web" | "runner">("web");

  // ---- Vision state ----
  const [selectedMonitor, setSelectedMonitor] = useState(0);

  // ---- API Request state ----
  const [savedRequests, setSavedRequests] = useState<SavedApiRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string>("");
  const [loadingRequests, setLoadingRequests] = useState(false);

  // ---- Step Output state ----
  const [taskRuns, setTaskRuns] = useState<TaskRunSummary[]>([]);
  const [selectedTaskRunId, setSelectedTaskRunId] = useState<string>("");
  const [loadingTaskRuns, setLoadingTaskRuns] = useState(false);
  const [taskRunOutput, setTaskRunOutput] = useState<string | null>(null);

  // ---- Update URL when target changes ----
  useEffect(() => {
    if (uiBridgeTarget === "web") {
      setUiBridgeUrl("http://localhost:3001/api/ui-bridge");
    } else {
      setUiBridgeUrl("http://localhost:9876/ui-bridge");
    }
  }, [uiBridgeTarget]);

  // ---- Notify parent when analyses change ----
  useEffect(() => {
    if (analyses.length > 0) {
      const analysisSet: CollectedAnalysisSet = {
        analyses,
        collected_at: new Date().toISOString(),
      };
      onAnalysisComplete({ type: "collected", data: analysisSet });
    }
  }, [analyses, onAnalysisComplete]);

  // ---- Load saved API requests ----
  const loadSavedRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const data = await runnerFetch<SavedApiRequest[]>("/saved-api-requests");
      const requests = Array.isArray(data) ? data : [];
      setSavedRequests(requests);
      const first = requests[0];
      if (first && !selectedRequestId) {
        setSelectedRequestId(first.id);
      }
    } catch (err) {
      console.error("Failed to load saved API requests:", err);
      setSavedRequests([]);
    } finally {
      setLoadingRequests(false);
    }
  }, [selectedRequestId]);

  // ---- Load task runs ----
  const loadTaskRuns = useCallback(async () => {
    setLoadingTaskRuns(true);
    try {
      // Try running first, then fall back to all task runs
      let runs: TaskRunSummary[] = [];
      try {
        runs = await runnerFetch<TaskRunSummary[]>("/task-runs/running");
      } catch {
        // Ignore - endpoint may not have running tasks
      }
      if (runs.length === 0) {
        try {
          const allRuns = await runnerFetch<TaskRunSummary[]>("/task-runs");
          runs = Array.isArray(allRuns) ? allRuns.slice(0, 20) : [];
        } catch {
          runs = [];
        }
      }
      setTaskRuns(runs);
      if (runs.length > 0 && !selectedTaskRunId) {
        setSelectedTaskRunId(runs[0]!.id);
      }
    } catch (err) {
      console.error("Failed to load task runs:", err);
      setTaskRuns([]);
    } finally {
      setLoadingTaskRuns(false);
    }
  }, [selectedTaskRunId]);

  // ---- Auto-load data when tab changes ----
  useEffect(() => {
    if (activeTab === "api_request" && savedRequests.length === 0) {
      loadSavedRequests();
    }
    if (activeTab === "step_output" && taskRuns.length === 0) {
      loadTaskRuns();
    }
  }, [
    activeTab,
    savedRequests.length,
    taskRuns.length,
    loadSavedRequests,
    loadTaskRuns,
  ]);

  // =========================================================================
  // Analysis Methods
  // =========================================================================

  /** Run UI Bridge snapshot analysis */
  const runUIBridgeAnalysis = useCallback(async () => {
    setIsAnalyzing(true);
    setError(null);

    try {
      const snapshotUrl = `${uiBridgeUrl}/control/snapshot`;
      const response = await fetch(snapshotUrl, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(
          `UI Bridge returned ${response.status}: ${response.statusText}`
        );
      }

      const snapshot: UIBridgeSnapshot = await response.json();

      const newAnalysis: CollectedAnalysis = {
        type: "ui_bridge",
        id: generateId(),
        name: `${uiBridgeTarget === "web" ? "Web Frontend" : "Runner Frontend"} Snapshot`,
        data: snapshot,
      };
      setAnalyses((prev) => [...prev, newAnalysis]);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "UI Bridge analysis failed";
      setError(msg);
      onError?.(msg);
    } finally {
      setIsAnalyzing(false);
    }
  }, [uiBridgeUrl, uiBridgeTarget, onError]);

  /** Run Vision analysis via runner API */
  const runVisionAnalysis = useCallback(async () => {
    setIsAnalyzing(true);
    setError(null);

    try {
      // Step 1: Capture screenshot
      const captureResponse = await fetch(
        `${RUNNER_API_BASE}/screenshots/capture`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ monitor_index: selectedMonitor }),
          signal: AbortSignal.timeout(15000),
        }
      );

      if (!captureResponse.ok) {
        throw new Error(`Screenshot capture failed: ${captureResponse.status}`);
      }

      const captureData = await captureResponse.json();
      const screenshotData = captureData.data ?? captureData;

      // Step 2: Run vision analysis
      const analyzeResponse = await fetch(`${RUNNER_API_BASE}/analyze/vision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenshot_base64: screenshotData.screenshot_base64,
          monitor_index: selectedMonitor,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!analyzeResponse.ok) {
        throw new Error(`Vision analysis failed: ${analyzeResponse.status}`);
      }

      const analyzeData = await analyzeResponse.json();
      const analysisResult =
        analyzeData.data?.analysis ?? analyzeData.data ?? analyzeData;

      if (!analysisResult?.elements) {
        throw new Error("Vision analysis returned no elements");
      }

      const pageAnalysis: PageAnalysis = {
        screenshot_base64: screenshotData.screenshot_base64,
        annotated_screenshot_base64: analysisResult.annotated_screenshot_base64,
        elements: analysisResult.elements,
        source: "vision",
        captured_at: new Date().toISOString(),
        monitor_index: selectedMonitor,
      };

      const newAnalysis: CollectedAnalysis = {
        type: "vision",
        id: generateId(),
        name: `Monitor ${selectedMonitor} Vision Capture`,
        data: pageAnalysis,
      };
      setAnalyses((prev) => [...prev, newAnalysis]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Vision analysis failed";
      setError(msg);
      onError?.(msg);
    } finally {
      setIsAnalyzing(false);
    }
  }, [selectedMonitor, onError]);

  /** Run API Request analysis */
  const runApiRequestAnalysis = useCallback(async () => {
    const selectedRequest = savedRequests.find(
      (r) => r.id === selectedRequestId
    );
    if (!selectedRequest) {
      setError("Please select an API request");
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    const startTime = Date.now();

    try {
      const options: RequestInit = {
        method: selectedRequest.method,
        headers: {
          "Content-Type":
            selectedRequest.body_content_type || "application/json",
          ...selectedRequest.headers,
        },
        signal: AbortSignal.timeout(30000),
      };

      if (selectedRequest.method !== "GET" && selectedRequest.body) {
        options.body = selectedRequest.body;
      }

      const response = await fetch(selectedRequest.url, options);
      const data = await response.json();
      const durationMs = Date.now() - startTime;

      const apiAnalysis: ApiRequestAnalysis = {
        id: generateId(),
        request_name: selectedRequest.name,
        method: selectedRequest.method,
        url: selectedRequest.url,
        response: data,
        status_code: response.status,
        duration_ms: durationMs,
        executed_at: new Date().toISOString(),
      };

      const newAnalysis: CollectedAnalysis = {
        type: "api_request",
        id: apiAnalysis.id,
        name: selectedRequest.name,
        data: apiAnalysis,
      };
      setAnalyses((prev) => [...prev, newAnalysis]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "API request failed";
      setError(msg);
      onError?.(msg);
    } finally {
      setIsAnalyzing(false);
    }
  }, [selectedRequestId, savedRequests, onError]);

  /** Load step output from a task run */
  const loadStepOutput = useCallback(async () => {
    if (!selectedTaskRunId) {
      setError("Please select a task run");
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const outputData = await runnerFetch<{ output: string }>(
        `/task-runs/${selectedTaskRunId}/output?tail_chars=15000`,
        { timeoutMs: 10000 }
      );

      const outputText =
        typeof outputData === "string"
          ? outputData
          : (outputData?.output ?? JSON.stringify(outputData));

      setTaskRunOutput(outputText);

      const stepOutput: StepOutput = {
        id: generateId(),
        step_type: "task_run_output",
        step_name: `Task Run ${selectedTaskRunId.slice(0, 8)}`,
        executed_at: new Date().toISOString(),
        duration_ms: 0,
        success: true,
        stdout: outputText,
      };

      const newAnalysis: CollectedAnalysis = {
        type: "step_output",
        id: stepOutput.id,
        name: stepOutput.step_name,
        data: stepOutput,
      };
      setAnalyses((prev) => [...prev, newAnalysis]);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to load step output";
      setError(msg);
      onError?.(msg);
    } finally {
      setIsAnalyzing(false);
    }
  }, [selectedTaskRunId, onError]);

  // =========================================================================
  // Analysis Management
  // =========================================================================

  /** Remove a collected analysis */
  const removeAnalysis = useCallback(
    (id: string) => {
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
      if (expandedId === id) setExpandedId(null);
    },
    [expandedId]
  );

  /** Clear all analyses */
  const clearAll = useCallback(() => {
    setAnalyses([]);
    setExpandedId(null);
  }, []);

  /** Generate a prompt context from all collected analyses */
  const generatePromptContext = useCallback((): string => {
    if (analyses.length === 0) return "";

    const sections: string[] = [
      "# Page Analysis Data",
      `Collected ${analyses.length} analysis(es) at ${new Date().toISOString()}\n`,
    ];

    for (const analysis of analyses) {
      sections.push(`## ${analysis.name} (${analysis.type})`);

      if (analysis.type === "ui_bridge") {
        const snap = analysis.data;
        sections.push(`URL: ${snap.url}`);
        sections.push(`Title: ${snap.title}`);
        sections.push(`Elements: ${snap.elements.length}`);
        const flat = flattenElements(snap.elements);
        sections.push("### Element Tree");
        for (const el of flat.slice(0, 50)) {
          const indent = "  ".repeat(el.depth);
          const text = el.text ? ` "${el.text.slice(0, 60)}"` : "";
          const role = el.role ? ` [${el.role}]` : "";
          sections.push(`${indent}- <${el.tag}> id="${el.id}"${role}${text}`);
        }
        if (flat.length > 50) {
          sections.push(`  ... and ${flat.length - 50} more elements`);
        }
      } else if (analysis.type === "vision") {
        const pa = analysis.data;
        sections.push(`Source: vision (monitor ${pa.monitor_index ?? 0})`);
        sections.push(`Elements: ${pa.elements.length}`);
        sections.push("### Detected Elements");
        for (const el of pa.elements.slice(0, 30)) {
          sections.push(
            `- ${el.label} (${el.element_type}) confidence=${el.confidence.toFixed(2)}${el.selector ? ` selector="${el.selector}"` : ""}`
          );
        }
      } else if (analysis.type === "api_request") {
        const api = analysis.data;
        sections.push(`${api.method} ${api.url}`);
        sections.push(`Status: ${api.status_code ?? "unknown"}`);
        sections.push(`Duration: ${api.duration_ms ?? 0}ms`);
        sections.push("### Response Data");
        sections.push(
          "```json\n" +
            JSON.stringify(api.response, null, 2).slice(0, 3000) +
            "\n```"
        );
      } else if (analysis.type === "step_output") {
        const so = analysis.data;
        sections.push(`Step Type: ${so.step_type}`);
        sections.push(`Success: ${so.success}`);
        if (so.stdout) {
          sections.push("### Output");
          sections.push("```\n" + so.stdout.slice(0, 3000) + "\n```");
        }
      }

      sections.push(""); // blank line between analyses
    }

    return sections.join("\n");
  }, [analyses]);

  // =========================================================================
  // Badge Helpers
  // =========================================================================

  const getTypeBadgeVariant = (
    type: CollectedAnalysis["type"]
  ): "info" | "success" | "warning" | "secondary" => {
    switch (type) {
      case "ui_bridge":
        return "info";
      case "vision":
        return "success";
      case "api_request":
        return "warning";
      case "step_output":
        return "secondary";
    }
  };

  const getTypeLabel = (type: CollectedAnalysis["type"]): string => {
    switch (type) {
      case "ui_bridge":
        return "UI Bridge";
      case "vision":
        return "Vision";
      case "api_request":
        return "API Request";
      case "step_output":
        return "Step Output";
    }
  };

  const getItemCount = (analysis: CollectedAnalysis): string => {
    switch (analysis.type) {
      case "ui_bridge":
        return `${analysis.data.elements.length} elements`;
      case "vision":
        return `${analysis.data.elements.length} elements`;
      case "api_request":
        return analysis.data.status_code
          ? `Status ${analysis.data.status_code}`
          : "Response data";
      case "step_output":
        return analysis.data.success ? "Success" : "Failed";
    }
  };

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScanSearch className="size-5 text-brand-primary" />
          <h3 className="text-sm font-semibold text-text-primary">
            Page Analyzer
          </h3>
          {analyses.length > 0 && (
            <Badge variant="info">{analyses.length}</Badge>
          )}
        </div>
        {analyses.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-red-400 hover:text-red-300"
            onClick={clearAll}
          >
            <Trash2 className="size-3.5 mr-1" />
            Clear All
          </Button>
        )}
      </div>

      {/* Analysis Method Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full">
          <TabsTrigger value="ui_bridge" className="flex-1 gap-1.5">
            <ScanSearch className="size-3.5" />
            UI Bridge
          </TabsTrigger>
          <TabsTrigger value="vision" className="flex-1 gap-1.5">
            <Monitor className="size-3.5" />
            Vision
          </TabsTrigger>
          <TabsTrigger value="api_request" className="flex-1 gap-1.5">
            <Network className="size-3.5" />
            API Request
          </TabsTrigger>
          <TabsTrigger value="step_output" className="flex-1 gap-1.5">
            <Play className="size-3.5" />
            Step Output
          </TabsTrigger>
        </TabsList>

        {/* ---- UI Bridge Tab ---- */}
        <TabsContent value="ui_bridge" className="mt-3">
          <div className="space-y-3">
            {/* Target selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted whitespace-nowrap">
                Target:
              </span>
              <div className="flex gap-1 p-0.5 bg-muted rounded-md">
                <button
                  type="button"
                  onClick={() => setUiBridgeTarget("web")}
                  className={cn(
                    "px-2.5 py-1 text-xs rounded transition-colors",
                    uiBridgeTarget === "web"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Web Frontend
                </button>
                <button
                  type="button"
                  onClick={() => setUiBridgeTarget("runner")}
                  className={cn(
                    "px-2.5 py-1 text-xs rounded transition-colors",
                    uiBridgeTarget === "runner"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Runner Frontend
                </button>
              </div>
            </div>

            {/* URL display */}
            <div className="flex items-center gap-2">
              <Input
                value={uiBridgeUrl}
                onChange={(e) => setUiBridgeUrl(e.target.value)}
                placeholder="http://localhost:3001/api/ui-bridge"
                className="text-xs h-8 font-mono bg-surface-canvas/50"
              />
            </div>

            <p className="text-xs text-text-muted">
              Fetches a DOM snapshot via the UI Bridge SDK. Returns the element
              tree, element metadata, and page context.
            </p>

            <Button
              onClick={runUIBridgeAnalysis}
              disabled={isAnalyzing || !uiBridgeUrl.trim()}
              className="w-full gap-2"
              variant="brand-primary"
              size="sm"
            >
              {isAnalyzing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ScanSearch className="size-3.5" />
              )}
              {isAnalyzing ? "Analyzing..." : "Fetch Snapshot"}
            </Button>
          </div>
        </TabsContent>

        {/* ---- Vision Tab ---- */}
        <TabsContent value="vision" className="mt-3">
          <div className="space-y-3">
            {/* Monitor selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted whitespace-nowrap">
                Monitor:
              </span>
              <Input
                type="number"
                min={0}
                max={10}
                value={selectedMonitor}
                onChange={(e) =>
                  setSelectedMonitor(parseInt(e.target.value, 10) || 0)
                }
                className="w-20 h-8 text-xs"
              />
              <span className="text-xs text-text-muted">
                (0 = primary monitor)
              </span>
            </div>

            <p className="text-xs text-text-muted">
              Captures a screenshot of the selected monitor and runs
              vision-based element detection (OCR + UI segmentation) via the
              runner.
            </p>

            <Button
              onClick={runVisionAnalysis}
              disabled={isAnalyzing}
              className="w-full gap-2"
              variant="brand-success"
              size="sm"
            >
              {isAnalyzing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Camera className="size-3.5" />
              )}
              {isAnalyzing ? "Capturing & Analyzing..." : "Capture & Analyze"}
            </Button>
          </div>
        </TabsContent>

        {/* ---- API Request Tab ---- */}
        <TabsContent value="api_request" className="mt-3">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">
                Select a saved API request from the runner library
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={loadSavedRequests}
                disabled={loadingRequests}
              >
                <RefreshCw
                  className={cn("size-3", loadingRequests && "animate-spin")}
                />
              </Button>
            </div>

            {loadingRequests ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                <Loader2 className="size-4 animate-spin" />
                Loading requests...
              </div>
            ) : savedRequests.length === 0 ? (
              <div className="text-center py-4">
                <Network className="size-8 mx-auto mb-2 text-muted-foreground opacity-40" />
                <p className="text-xs text-muted-foreground">
                  No saved API requests found.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Create saved requests in the runner library first.
                </p>
              </div>
            ) : (
              <select
                value={selectedRequestId}
                onChange={(e) => setSelectedRequestId(e.target.value)}
                className="w-full px-3 py-2 bg-surface-canvas/50 border border-border-subtle rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
              >
                {savedRequests.map((req) => (
                  <option key={req.id} value={req.id}>
                    [{req.method}] {req.name}
                  </option>
                ))}
              </select>
            )}

            <Button
              onClick={runApiRequestAnalysis}
              disabled={
                isAnalyzing || !selectedRequestId || savedRequests.length === 0
              }
              className="w-full gap-2"
              variant="warning"
              size="sm"
            >
              {isAnalyzing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {isAnalyzing ? "Executing..." : "Run Request"}
            </Button>
          </div>
        </TabsContent>

        {/* ---- Step Output Tab ---- */}
        <TabsContent value="step_output" className="mt-3">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">
                Reuse outputs from recent workflow executions
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={loadTaskRuns}
                disabled={loadingTaskRuns}
              >
                <RefreshCw
                  className={cn("size-3", loadingTaskRuns && "animate-spin")}
                />
              </Button>
            </div>

            {loadingTaskRuns ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                <Loader2 className="size-4 animate-spin" />
                Loading task runs...
              </div>
            ) : taskRuns.length === 0 ? (
              <div className="text-center py-4">
                <Play className="size-8 mx-auto mb-2 text-muted-foreground opacity-40" />
                <p className="text-xs text-muted-foreground">
                  No recent task runs found.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Run a workflow in the runner first.
                </p>
              </div>
            ) : (
              <select
                value={selectedTaskRunId}
                onChange={(e) => setSelectedTaskRunId(e.target.value)}
                className="w-full px-3 py-2 bg-surface-canvas/50 border border-border-subtle rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
              >
                {taskRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.task_name || run.workflow_name || run.id.slice(0, 8)} (
                    {run.status})
                  </option>
                ))}
              </select>
            )}

            {taskRunOutput && (
              <div className="max-h-32 overflow-auto rounded border border-border-subtle bg-surface-canvas/50 p-2">
                <pre className="text-[10px] font-mono text-text-muted whitespace-pre-wrap">
                  {taskRunOutput.slice(0, 2000)}
                  {taskRunOutput.length > 2000 && "\n...truncated"}
                </pre>
              </div>
            )}

            <Button
              onClick={loadStepOutput}
              disabled={
                isAnalyzing || !selectedTaskRunId || taskRuns.length === 0
              }
              className="w-full gap-2"
              variant="secondary"
              size="sm"
            >
              {isAnalyzing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {isAnalyzing ? "Loading..." : "Load Output"}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* Error Display */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-red-500/30 bg-red-500/5">
          <AlertCircle className="size-4 text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-red-400">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="p-0.5 text-red-400/60 hover:text-red-400"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      {/* ---- Collected Analyses Section ---- */}
      <div className="border-t border-border-subtle/50 pt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Camera className="size-4 text-text-muted" />
            <span className="text-xs font-medium text-text-secondary">
              Collected Analyses
            </span>
            {analyses.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5">
                {analyses.length}
              </Badge>
            )}
          </div>
        </div>

        {analyses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center border border-dashed border-border-subtle/50 rounded-lg bg-surface-raised/10">
            <Camera className="size-8 text-muted-foreground opacity-30 mb-2" />
            <p className="text-xs text-muted-foreground">
              No analyses collected yet.
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Use the tabs above to run analyses. Results appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {analyses.map((analysis) => (
              <Collapsible
                key={analysis.id}
                open={expandedId === analysis.id}
                onOpenChange={(open) =>
                  setExpandedId(open ? analysis.id : null)
                }
              >
                {/* Analysis Row */}
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border-subtle/50 bg-surface-raised/20 hover:bg-surface-raised/40 transition-colors">
                  <Badge variant={getTypeBadgeVariant(analysis.type)}>
                    {getTypeLabel(analysis.type)}
                  </Badge>
                  <span className="flex-1 text-xs text-text-primary truncate">
                    {analysis.name}
                  </span>
                  <span className="text-[10px] text-text-muted whitespace-nowrap">
                    {getItemCount(analysis)}
                  </span>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-6">
                      <Eye className="size-3" />
                    </Button>
                  </CollapsibleTrigger>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAnalysis(analysis.id);
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>

                {/* Expanded Detail */}
                <CollapsibleContent>
                  <div className="mt-1 px-3 py-3 rounded-lg border border-border-subtle/30 bg-surface-canvas/50">
                    {/* UI Bridge details */}
                    {analysis.type === "ui_bridge" && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3 text-xs text-text-muted">
                          <span>URL: {analysis.data.url}</span>
                          <span>Title: {analysis.data.title}</span>
                          <span>
                            {analysis.data.elements.length} top-level elements
                          </span>
                        </div>
                        <ScrollArea className="max-h-48">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border-subtle/30">
                                <th className="px-2 py-1 text-left text-text-muted font-medium">
                                  #
                                </th>
                                <th className="px-2 py-1 text-left text-text-muted font-medium">
                                  Tag
                                </th>
                                <th className="px-2 py-1 text-left text-text-muted font-medium">
                                  Role
                                </th>
                                <th className="px-2 py-1 text-left text-text-muted font-medium">
                                  Text
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {flattenElements(analysis.data.elements)
                                .slice(0, 25)
                                .map((el, idx) => (
                                  <tr
                                    key={`${el.id}-${idx}`}
                                    className="border-b border-border-subtle/20"
                                  >
                                    <td className="px-2 py-1 text-text-muted">
                                      {idx + 1}
                                    </td>
                                    <td className="px-2 py-1 text-text-secondary font-mono">
                                      {"  ".repeat(el.depth)}
                                      {"<"}
                                      {el.tag}
                                      {">"}
                                    </td>
                                    <td className="px-2 py-1 text-text-muted">
                                      {el.role || "-"}
                                    </td>
                                    <td className="px-2 py-1 text-text-muted truncate max-w-[200px]">
                                      {el.text || el.label || "-"}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                          {flattenElements(analysis.data.elements).length >
                            25 && (
                            <p className="text-[10px] text-text-muted mt-1 px-2">
                              ...and{" "}
                              {flattenElements(analysis.data.elements).length -
                                25}{" "}
                              more elements
                            </p>
                          )}
                        </ScrollArea>
                      </div>
                    )}

                    {/* Vision details */}
                    {analysis.type === "vision" && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3 text-xs text-text-muted">
                          <span>
                            Monitor: {analysis.data.monitor_index ?? 0}
                          </span>
                          <span>
                            {analysis.data.elements.length} detected elements
                          </span>
                          <span>
                            Captured:{" "}
                            {new Date(
                              analysis.data.captured_at
                            ).toLocaleTimeString()}
                          </span>
                        </div>
                        {analysis.data.annotated_screenshot_base64 && (
                          <div className="border border-border-subtle/30 rounded overflow-hidden">
                            <img
                              src={`data:image/png;base64,${analysis.data.annotated_screenshot_base64}`}
                              alt="Annotated screenshot"
                              className="w-full max-h-48 object-contain bg-black"
                            />
                          </div>
                        )}
                        <ScrollArea className="max-h-40">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border-subtle/30">
                                <th className="px-2 py-1 text-left text-text-muted font-medium">
                                  #
                                </th>
                                <th className="px-2 py-1 text-left text-text-muted font-medium">
                                  Label
                                </th>
                                <th className="px-2 py-1 text-left text-text-muted font-medium">
                                  Type
                                </th>
                                <th className="px-2 py-1 text-left text-text-muted font-medium">
                                  Confidence
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {analysis.data.elements
                                .slice(0, 20)
                                .map((el, idx) => (
                                  <tr
                                    key={el.id}
                                    className="border-b border-border-subtle/20"
                                  >
                                    <td className="px-2 py-1 text-text-muted">
                                      {idx + 1}
                                    </td>
                                    <td className="px-2 py-1 text-text-secondary">
                                      {el.label}
                                    </td>
                                    <td className="px-2 py-1 text-text-muted">
                                      {el.element_type}
                                    </td>
                                    <td className="px-2 py-1 text-text-muted">
                                      {(el.confidence * 100).toFixed(0)}%
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                          {analysis.data.elements.length > 20 && (
                            <p className="text-[10px] text-text-muted mt-1 px-2">
                              ...and {analysis.data.elements.length - 20} more
                            </p>
                          )}
                        </ScrollArea>
                      </div>
                    )}

                    {/* API Request details */}
                    {analysis.type === "api_request" && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3 text-xs text-text-muted">
                          <span className="font-mono font-semibold text-text-secondary">
                            {analysis.data.method}
                          </span>
                          <span className="truncate">{analysis.data.url}</span>
                          {analysis.data.status_code != null && (
                            <span
                              className={
                                analysis.data.status_code < 400
                                  ? "text-green-400"
                                  : "text-red-400"
                              }
                            >
                              {analysis.data.status_code}
                            </span>
                          )}
                          {analysis.data.duration_ms != null && (
                            <span>{analysis.data.duration_ms}ms</span>
                          )}
                        </div>
                        <ScrollArea className="max-h-48">
                          <pre className="text-[10px] font-mono text-text-muted whitespace-pre-wrap p-2 bg-surface-raised/30 rounded">
                            {JSON.stringify(analysis.data.response, null, 2)}
                          </pre>
                        </ScrollArea>
                      </div>
                    )}

                    {/* Step Output details */}
                    {analysis.type === "step_output" && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3 text-xs text-text-muted">
                          <span className="font-mono">
                            {analysis.data.step_type}
                          </span>
                          <span
                            className={
                              analysis.data.success
                                ? "text-green-400"
                                : "text-red-400"
                            }
                          >
                            {analysis.data.success ? "Success" : "Failed"}
                          </span>
                          {analysis.data.duration_ms > 0 && (
                            <span>{analysis.data.duration_ms}ms</span>
                          )}
                        </div>
                        {analysis.data.error && (
                          <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                            {analysis.data.error}
                          </div>
                        )}
                        {analysis.data.stdout && (
                          <ScrollArea className="max-h-48">
                            <pre className="text-[10px] font-mono text-text-muted whitespace-pre-wrap p-2 bg-surface-raised/30 rounded">
                              {analysis.data.stdout.slice(0, 5000)}
                              {analysis.data.stdout.length > 5000 &&
                                "\n...truncated"}
                            </pre>
                          </ScrollArea>
                        )}
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </div>

      {/* ---- Use in AI Generation Button ---- */}
      {analyses.length > 0 && (
        <div className="border-t border-border-subtle/50 pt-3">
          <div className="flex items-center gap-2 mb-2">
            <Check className="size-4 text-green-400" />
            <span className="text-xs text-text-secondary">
              {analyses.length}{" "}
              {analyses.length === 1 ? "analysis" : "analyses"} ready for AI
              test generation
            </span>
          </div>
          <Button
            variant="brand-primary"
            size="sm"
            className="w-full gap-2"
            onClick={() => {
              const context = generatePromptContext();
              // Copy to clipboard for easy pasting into AI prompts
              navigator.clipboard.writeText(context).then(() => {
                // Could show a toast here
              });
              // Also fire the analysis complete callback with all data
              onAnalysisComplete({
                type: "collected",
                data: {
                  analyses,
                  collected_at: new Date().toISOString(),
                },
              });
            }}
          >
            <Sparkles className="size-3.5" />
            Use in AI Generation
          </Button>
          <p className="text-[10px] text-text-muted mt-1.5 text-center">
            Copies analysis context to clipboard and sends data to the AI
            generator.
          </p>
        </div>
      )}
    </div>
  );
}
