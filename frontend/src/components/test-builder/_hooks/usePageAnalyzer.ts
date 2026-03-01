import { useState, useCallback, useEffect } from "react";
import { runnerFetch, RUNNER_API_BASE } from "@/lib/runner/api-client";
import type {
  CollectedAnalysis,
  CollectedAnalysisSet,
  UIBridgeSnapshot,
  PageAnalysis,
  ApiRequestAnalysis,
  StepOutput,
  SavedApiRequest,
  TaskRunSummary,
  AnalysisData,
} from "../page-analyzer-types";
import { generateId, generatePromptContext } from "../page-analyzer-utils";

interface UsePageAnalyzerOptions {
  onAnalysisComplete: (analysis: AnalysisData) => void;
  onError?: (error: string) => void;
  initialAnalyses?: CollectedAnalysis[];
}

export function usePageAnalyzer({
  onAnalysisComplete,
  onError,
  initialAnalyses,
}: UsePageAnalyzerOptions) {
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

  // ---- Analysis Methods ----

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

  const runVisionAnalysis = useCallback(async () => {
    setIsAnalyzing(true);
    setError(null);

    try {
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

  // ---- Analysis Management ----

  const removeAnalysis = useCallback(
    (id: string) => {
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
      if (expandedId === id) setExpandedId(null);
    },
    [expandedId]
  );

  const clearAll = useCallback(() => {
    setAnalyses([]);
    setExpandedId(null);
  }, []);

  const getPromptContext = useCallback((): string => {
    return generatePromptContext(analyses);
  }, [analyses]);

  return {
    // Collected analyses
    analyses,
    expandedId,
    setExpandedId,

    // Tab
    activeTab,
    setActiveTab,

    // Loading / error
    isAnalyzing,
    error,
    setError,

    // UI Bridge
    uiBridgeUrl,
    setUiBridgeUrl,
    uiBridgeTarget,
    setUiBridgeTarget,
    runUIBridgeAnalysis,

    // Vision
    selectedMonitor,
    setSelectedMonitor,
    runVisionAnalysis,

    // API Request
    savedRequests,
    selectedRequestId,
    setSelectedRequestId,
    loadingRequests,
    loadSavedRequests,
    runApiRequestAnalysis,

    // Step Output
    taskRuns,
    selectedTaskRunId,
    setSelectedTaskRunId,
    loadingTaskRuns,
    loadTaskRuns,
    taskRunOutput,
    loadStepOutput,

    // Management
    removeAnalysis,
    clearAll,
    getPromptContext,
    onAnalysisComplete,
  };
}

export type UsePageAnalyzerReturn = ReturnType<typeof usePageAnalyzer>;
