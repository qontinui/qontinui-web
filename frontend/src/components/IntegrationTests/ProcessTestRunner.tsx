import React, { useState, useMemo, useEffect } from "react";
import {
  TestTube2,
  Play,
  Square,
  ChevronRight,
  CheckCircle,
  XCircle,
  Clock,
  Target,
  MousePointer,
  Type,
  Move,
  FileText,
  Download,
  RefreshCw,
  Info,
  Layers,
  Settings,
} from "lucide-react";
import { useAutomation } from "../../contexts/automation-context";
import { qontinuiAPI } from "../../lib/qontinui-api-client";
import { toast } from "sonner";

interface ResultItem {
  actionId?: string;
  actionType: string;
  success: boolean;
  message?: string;
  duration: number;
}

interface TestRun {
  sessionId: string;
  processId: string;
  processName: string;
  categoryName: string;
  startTime: Date;
  endTime?: Date;
  status: "running" | "completed" | "failed";
  results: unknown[];
  currentAction: number;
  totalActions: number;
  successRate?: number;
}

export const ProcessTestRunner: React.FC = () => {
  const {
    workflows = [],
    categories = [],
    states = [],
    screenshots = [],
  } = useAutomation();
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedProcess, setSelectedProcess] = useState<string>("");
  const [activeRun, setActiveRun] = useState<TestRun | null>(null);
  const [testHistory, setTestHistory] = useState<TestRun[]>([]);
  const [selectedHistoryRun, setSelectedHistoryRun] = useState<TestRun | null>(
    null
  );
  const [apiConnected, setApiConnected] = useState(false);
  const [mockMode, setMockMode] = useState<"hybrid" | "full_mock">("hybrid");
  const [showOnlyFailed, setShowOnlyFailed] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  // Check API connection on mount
  useEffect(() => {
    checkAPIConnection();
  }, []);

  const checkAPIConnection = async () => {
    const connected = await qontinuiAPI.testConnection();
    setApiConnected(connected);
  };

  // Group workflows by category
  const workflowsByCategory = useMemo(() => {
    const grouped = new Map<string, typeof workflows>();

    if (categories && categories.length > 0) {
      categories.forEach((categoryName) => {
        const categoryProcesses = workflows.filter(
          (p) => p.category === categoryName
        );
        if (categoryProcesses.length > 0) {
          grouped.set(categoryName, categoryProcesses);
        }
      });
    }

    // Add uncategorized workflows
    const uncategorized = workflows.filter(
      (p) => !p.category || !categories || !categories.includes(p.category)
    );
    if (uncategorized.length > 0) {
      grouped.set("uncategorized", uncategorized);
    }

    return grouped;
  }, [workflows, categories]);

  // Get workflows for selected category
  const categoryProcesses = useMemo(() => {
    if (!selectedCategory) return workflows;
    return workflowsByCategory.get(selectedCategory) || [];
  }, [selectedCategory, workflowsByCategory, workflows]);

  // Get all actions for a process
  const getProcessActions = (processId: string): unknown[] => {
    const process = workflows.find((p) => p.id === processId);
    if (!process || !process.actions) return [];
    return process.actions;
  };

  // Start a test run
  const startTestRun = async () => {
    if (!selectedProcess || !apiConnected || isExecuting) return;

    const process = workflows.find((p) => p.id === selectedProcess);
    if (!process) return;

    // Validate workflow has required fields for integration testing
    if (!process.initialScreenshotId) {
      toast.error("Workflow configuration incomplete", {
        description:
          "Please set an initial screenshot for this workflow in the Workflow Builder tab.",
      });
      return;
    }

    if (!process.initialStateIds || process.initialStateIds.length === 0) {
      toast.error("Workflow configuration incomplete", {
        description:
          "Please set initial active states for this workflow in the Workflow Builder tab.",
      });
      return;
    }

    // Find the initial screenshot
    const initialScreenshot = screenshots.find(
      (s) => s.id === process.initialScreenshotId
    );
    if (!initialScreenshot) {
      toast.error("Initial screenshot not found", {
        description:
          "The configured initial screenshot does not exist. Please update the process configuration.",
      });
      return;
    }

    // Verify initial states exist
    const missingStates = process.initialStateIds.filter(
      (stateId) => !states.find((s) => s.id === stateId)
    );
    if (missingStates.length > 0) {
      toast.error("Initial states not found", {
        description: `The following configured states do not exist: ${missingStates.join(", ")}`,
      });
      return;
    }

    setIsExecuting(true);

    try {
      // Use the process's configured initial screenshot
      const screenshotData = [initialScreenshot.url];

      // Transform categories from string[] to object[]
      const categoryObjects = (categories || []).map((cat) => ({
        id: cat,
        name: cat,
        description: "",
      }));

      // Include initial states in the process for API
      const processWithInitialStates = {
        ...process,
        initialStates: process.initialStateIds,
      };

      // Start process execution on API
      const response = await qontinuiAPI.executeProcess(
        processWithInitialStates,
        screenshotData,
        states,
        categoryObjects,
        mockMode,
        0.8
      );

      const newRun: TestRun = {
        sessionId: response.session_id,
        processId: response.process_id,
        processName: response.process_name,
        categoryName: response.category_name,
        startTime: new Date(),
        status: "running",
        results: [],
        currentAction: 0,
        totalActions: response.total_actions,
      };

      setActiveRun(newRun);

      // Execute actions
      const actions = getProcessActions(process.id);
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];

        // Execute action step
        const stepResult = await qontinuiAPI.executeProcessStep(
          response.session_id,
          action
        );

        // Update active run
        setActiveRun((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            results: [...prev.results, stepResult],
            currentAction: i + 1,
          };
        });

        // Add small delay between actions for visibility
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Complete the process
      const finalResult = await qontinuiAPI.completeProcess(
        response.session_id
      );

      const completedRun: TestRun = {
        ...newRun,
        endTime: new Date(),
        status: finalResult.status === "completed" ? "completed" : "failed",
        results: finalResult.execution_history,
        successRate: finalResult.success_rate,
      };

      setActiveRun(null);
      setTestHistory((prev) => [completedRun, ...prev]);
    } catch (error) {
      console.error("Test run failed:", error);
      if (activeRun) {
        const failedRun: TestRun = {
          ...activeRun,
          endTime: new Date(),
          status: "failed",
        };
        setActiveRun(null);
        setTestHistory((prev) => [failedRun, ...prev]);
      }
    } finally {
      setIsExecuting(false);
    }
  };

  // Stop test run
  const stopTestRun = async () => {
    if (!activeRun) return;

    try {
      await qontinuiAPI.completeProcess(activeRun.sessionId);
      const stoppedRun: TestRun = {
        ...activeRun,
        endTime: new Date(),
        status: "failed",
      };
      setActiveRun(null);
      setTestHistory((prev) => [stoppedRun, ...prev]);
    } catch (error) {
      console.error("Failed to stop test:", error);
    }

    setIsExecuting(false);
  };

  // Export test results
  const exportResults = (run: TestRun) => {
    const data = {
      ...run,
      duration: run.endTime
        ? run.endTime.getTime() - run.startTime.getTime()
        : 0,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `test-run-${run.sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filter history
  const filteredHistory = useMemo(() => {
    if (!showOnlyFailed) return testHistory;
    return testHistory.filter((run) => run.status === "failed");
  }, [testHistory, showOnlyFailed]);

  const getActionIcon = (type: string) => {
    switch (type) {
      case "find":
        return <Target className="w-4 h-4" />;
      case "click":
        return <MousePointer className="w-4 h-4" />;
      case "type":
        return <Type className="w-4 h-4" />;
      case "drag":
        return <Move className="w-4 h-4" />;
      case "scroll":
        return <Move className="w-4 h-4 rotate-90" />;
      case "wait":
        return <Clock className="w-4 h-4" />;
      default:
        return <Info className="w-4 h-4" />;
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TestTube2 className="w-6 h-6 text-purple-600" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Process Test Runner
              </h2>
              <p className="text-sm text-gray-600">
                Run workflows as integration tests with real pattern matching
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div
              className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
                apiConnected
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {apiConnected ? (
                <CheckCircle className="w-4 h-4" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              {apiConnected ? "API Connected" : "API Disconnected"}
            </div>

            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-gray-500" />
              <select
                value={mockMode}
                onChange={(e) =>
                  setMockMode(e.target.value as "hybrid" | "full_mock")
                }
                className="px-3 py-1.5 border rounded-lg text-sm text-gray-900 bg-white"
                disabled={isExecuting}
              >
                <option value="hybrid">Hybrid (Real Pattern Matching)</option>
                <option value="full_mock">Full Mock</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Process Selection */}
      <div className="bg-white border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <Layers className="w-4 h-4 text-gray-500" />

          <select
            value={selectedCategory}
            onChange={(e) => {
              setSelectedCategory(e.target.value);
              setSelectedProcess("");
            }}
            className="px-3 py-1.5 border rounded-lg text-sm text-gray-900 bg-white"
            disabled={isExecuting}
          >
            <option value="">All Categories</option>
            {categories &&
              categories.map((categoryName) => (
                <option key={categoryName} value={categoryName}>
                  {categoryName}
                </option>
              ))}
            {workflowsByCategory.has("uncategorized") && (
              <option value="uncategorized">Uncategorized</option>
            )}
          </select>

          <select
            value={selectedProcess}
            onChange={(e) => setSelectedProcess(e.target.value)}
            className="px-3 py-1.5 border rounded-lg text-sm flex-1 text-gray-900 bg-white"
            disabled={isExecuting}
          >
            <option value="">Select a process to test</option>
            {categoryProcesses.map((proc) => {
              const actionCount = proc.actions ? proc.actions.length : 0;
              return (
                <option key={proc.id} value={proc.id}>
                  {proc.name} ({actionCount} actions)
                </option>
              );
            })}
          </select>

          <div className="flex items-center gap-2">
            {!isExecuting ? (
              <button
                onClick={startTestRun}
                disabled={!selectedProcess || !apiConnected}
                className={`px-4 py-1.5 rounded-lg flex items-center gap-2 text-sm font-medium ${
                  selectedProcess && apiConnected
                    ? "bg-purple-600 text-white hover:bg-purple-700"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
                }`}
              >
                <Play className="w-4 h-4" />
                Run Test
              </button>
            ) : (
              <button
                onClick={stopTestRun}
                className="px-4 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2 text-sm font-medium"
              >
                <Square className="w-4 h-4" />
                Stop
              </button>
            )}
          </div>
        </div>

        {/* Active Run Progress */}
        {activeRun && (
          <div className="mt-3 p-3 bg-purple-50 rounded-lg border border-purple-200">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-purple-600" />
                <span className="font-medium text-sm text-gray-900">
                  Testing: {activeRun.processName}
                </span>
                <span className="text-xs text-gray-600">
                  ({activeRun.categoryName})
                </span>
              </div>
              <span className="text-sm font-mono text-gray-700">
                {activeRun.currentAction} / {activeRun.totalActions} actions
              </span>
            </div>
            <div className="w-full bg-white rounded-full h-2">
              <div
                className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${(activeRun.currentAction / activeRun.totalActions) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Test History */}
        <div className="w-1/3 border-r bg-white overflow-y-auto">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-900">Test History</h3>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={showOnlyFailed}
                  onChange={(e) => setShowOnlyFailed(e.target.checked)}
                  className="w-4 h-4"
                />
                Failed only
              </label>
            </div>

            <div className="space-y-2">
              {filteredHistory.map((run) => (
                <button
                  key={run.sessionId}
                  onClick={() => setSelectedHistoryRun(run)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedHistoryRun?.sessionId === run.sessionId
                      ? "bg-purple-50 border-purple-300"
                      : "hover:bg-gray-50 border-gray-200"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-medium text-sm text-gray-900">
                        {run.processName}
                      </h4>
                      <p className="text-xs text-gray-600 mt-1">
                        {run.categoryName}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        {run.status === "completed" ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500" />
                        )}
                        <span className="text-xs">
                          {run.successRate
                            ? `${run.successRate.toFixed(1)}%`
                            : "0%"}{" "}
                          success
                        </span>
                        <span className="text-xs text-gray-500">
                          {run.startTime.toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 mt-1" />
                  </div>
                </button>
              ))}

              {filteredHistory.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <TestTube2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-gray-500">No test runs yet</p>
                  <p className="text-xs mt-1 text-gray-400">
                    Select a process and click Run Test
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Test Results */}
        <div className="flex-1 overflow-y-auto">
          {selectedHistoryRun || activeRun ? (
            <div className="p-6">
              {(selectedHistoryRun || activeRun) && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {(selectedHistoryRun || activeRun)!.processName}
                    </h3>
                    {selectedHistoryRun && (
                      <button
                        onClick={() => exportResults(selectedHistoryRun)}
                        className="px-3 py-1 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2 text-sm"
                      >
                        <Download className="w-4 h-4" />
                        Export Results
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="bg-gray-50 p-3 rounded-lg">
                      <div className="text-xs text-gray-600 mb-1">Status</div>
                      <div className="flex items-center gap-2 text-gray-900">
                        {(selectedHistoryRun || activeRun)!.status ===
                        "completed" ? (
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        ) : (selectedHistoryRun || activeRun)!.status ===
                          "running" ? (
                          <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-500" />
                        )}
                        <span className="font-medium capitalize">
                          {(selectedHistoryRun || activeRun)!.status}
                        </span>
                      </div>
                    </div>

                    <div className="bg-gray-50 p-3 rounded-lg">
                      <div className="text-xs text-gray-600 mb-1">
                        Success Rate
                      </div>
                      <div className="font-medium text-gray-900">
                        {(selectedHistoryRun || activeRun)!.successRate
                          ? `${(selectedHistoryRun || activeRun)!.successRate!.toFixed(1)}%`
                          : "Calculating..."}
                      </div>
                    </div>

                    <div className="bg-gray-50 p-3 rounded-lg">
                      <div className="text-xs text-gray-600 mb-1">Duration</div>
                      <div className="font-medium text-gray-900">
                        {(selectedHistoryRun || activeRun)!.endTime
                          ? `${((selectedHistoryRun || activeRun)!.endTime!.getTime() - (selectedHistoryRun || activeRun)!.startTime.getTime()) / 1000}s`
                          : "Running..."}
                      </div>
                    </div>
                  </div>

                  {/* Action Results */}
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm mb-2 text-gray-900">
                      Action Results
                    </h4>
                    {(selectedHistoryRun || activeRun)!.results.map(
                      (result: unknown, index) => {
                        const r = result as ResultItem;
                        return (
                          <div
                            key={`${r.actionId || index}`}
                            className={`flex items-start gap-3 p-3 rounded-lg border ${
                              r.success
                                ? "bg-green-50 border-green-200"
                                : "bg-red-50 border-red-200"
                            }`}
                          >
                            <div className="flex-shrink-0 mt-0.5">
                              {getActionIcon(r.actionType)}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm capitalize text-gray-900">
                                  {r.actionType}
                                </span>
                                {r.success ? (
                                  <CheckCircle className="w-4 h-4 text-green-500" />
                                ) : (
                                  <XCircle className="w-4 h-4 text-red-500" />
                                )}
                              </div>
                              {r.message && (
                                <div className="text-xs text-gray-700 mt-1">
                                  {r.message}
                                </div>
                              )}
                              <div className="text-xs text-gray-500 mt-1">
                                Duration: {r.duration}ms
                              </div>
                            </div>
                          </div>
                        );
                      }
                    )}

                    {(selectedHistoryRun || activeRun)!.results.length ===
                      0 && (
                      <div className="text-center py-4 text-gray-500 text-sm">
                        No actions executed yet
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-50 text-gray-400" />
                <p className="text-sm text-gray-500">
                  Select a test run to view results
                </p>
                <p className="text-xs mt-1 text-gray-400">
                  or start a new test from the dropdown above
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProcessTestRunner;
