"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  runnerClient,
  type TestRunSummary,
  type TestResult,
  type AssertionResult,
  type TestingState,
  type MockMode,
} from "@/lib/runner-client";

/**
 * IntegrationTestRunner - UI component for running integration tests via the qontinui runner
 *
 * Features:
 * - Start/stop test runs
 * - View test results and assertions
 * - Browse state machine (states and transitions)
 * - Mock mode control for testing without screen interaction
 * - Real-time test status updates
 */

interface TestConfig {
  name: string;
  config_path?: string;
  assertions: Array<{
    type: string;
    target: string;
    expected?: string;
    timeout_seconds?: number;
  }>;
}

function AssertionResultItem({ assertion }: { assertion: AssertionResult }) {
  return (
    <div
      className={`p-2 rounded text-sm ${
        assertion.passed
          ? "bg-green-100 dark:bg-green-900/30 border-green-300"
          : "bg-red-100 dark:bg-red-900/30 border-red-300"
      } border`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`font-medium ${
            assertion.passed
              ? "text-green-700 dark:text-green-300"
              : "text-red-700 dark:text-red-300"
          }`}
        >
          {assertion.passed ? "PASS" : "FAIL"}
        </span>
        <span className="text-gray-600 dark:text-gray-400">
          {assertion.type}: {assertion.target}
        </span>
      </div>
      {assertion.actual_value && (
        <div className="text-xs text-gray-500 mt-1">
          Actual: {assertion.actual_value}
        </div>
      )}
      {assertion.error_message && (
        <div className="text-xs text-red-600 dark:text-red-400 mt-1">
          Error: {assertion.error_message}
        </div>
      )}
    </div>
  );
}

function TestResultItem({ result }: { result: TestResult }) {
  return (
    <div className="border rounded-lg p-4 mb-4 dark:border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-medium">{result.test_name}</h4>
        <span
          className={`px-2 py-1 rounded text-xs font-medium ${
            result.status === "passed"
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
              : result.status === "failed"
                ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
          }`}
        >
          {result.status.toUpperCase()}
        </span>
      </div>
      {result.duration_ms && (
        <div className="text-sm text-gray-500 mb-2">
          Duration: {result.duration_ms.toFixed(0)}ms
        </div>
      )}
      {result.error_message && (
        <div className="text-sm text-red-600 dark:text-red-400 mb-2">
          Error: {result.error_message}
        </div>
      )}
      <div className="space-y-2">
        {result.assertions.map((assertion) => (
          <AssertionResultItem
            key={assertion.assertion_id}
            assertion={assertion}
          />
        ))}
      </div>
    </div>
  );
}

export function IntegrationTestRunner() {
  // Test runs state
  const [testRuns, setTestRuns] = useState<TestRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // State machine state
  const [states, setStates] = useState<TestingState[]>([]);
  const [activeStates, setActiveStates] = useState<string[]>([]);

  // Mock mode state
  const [mockMode, setMockModeState] = useState<MockMode>("disabled");

  // New test config
  const [testConfig, setTestConfig] = useState<TestConfig>({
    name: "Integration Test",
    assertions: [],
  });
  const [newAssertion, setNewAssertion] = useState({
    type: "state_reached",
    target: "",
    expected: "",
    timeout_seconds: 30,
  });

  // Runner connection state
  const [isRunnerConnected, setIsRunnerConnected] = useState(false);

  // Check runner connection
  useEffect(() => {
    const checkConnection = async () => {
      const available = await runnerClient.isAvailable();
      setIsRunnerConnected(available);
    };
    checkConnection();
    const interval = setInterval(checkConnection, 5000);
    return () => clearInterval(interval);
  }, []);

  // Load test runs
  const loadTestRuns = useCallback(async () => {
    const result = await runnerClient.listTestRuns(20);
    if (result.success && result.runs) {
      setTestRuns(result.runs);
    }
  }, []);

  // Load states
  const loadStates = useCallback(async () => {
    const result = await runnerClient.getTestingStates();
    if (result.success && result.states) {
      setStates(result.states);
    }
  }, []);

  // Load active states
  const loadActiveStates = useCallback(async () => {
    const result = await runnerClient.getActiveStates();
    if (result.success && result.active_states) {
      setActiveStates(result.active_states);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (isRunnerConnected) {
      loadTestRuns();
      loadStates();
      loadActiveStates();
    }
  }, [isRunnerConnected, loadTestRuns, loadStates, loadActiveStates]);

  // Load test results when a run is selected
  useEffect(() => {
    if (selectedRunId) {
      const loadResults = async () => {
        const result = await runnerClient.getTestResults(selectedRunId);
        if (result.success && result.results) {
          setTestResults(result.results);
        }
      };
      loadResults();
    }
  }, [selectedRunId]);

  // Start a new test run
  const startTestRun = async () => {
    if (!testConfig.name) {
      setError("Test name is required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await runnerClient.startIntegrationTest({
        name: testConfig.name,
        config_path: testConfig.config_path,
      });

      if (result.success && result.run_id) {
        setSelectedRunId(result.run_id);
        await loadTestRuns();
      } else {
        setError(result.error || "Failed to start test run");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start test");
    } finally {
      setLoading(false);
    }
  };

  // Run a single assertion
  const runAssertion = async () => {
    if (!newAssertion.target) {
      setError("Assertion target is required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await runnerClient.runAssertion(
        newAssertion.type,
        newAssertion.target,
        newAssertion.expected || undefined,
        newAssertion.timeout_seconds
      );

      if (result.success && result.assertion) {
        // Show result
        alert(
          `Assertion ${result.assertion.passed ? "PASSED" : "FAILED"}: ${
            result.assertion.actual_value || "No value"
          }`
        );
        // Refresh active states
        await loadActiveStates();
      } else {
        setError(result.error || "Assertion failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run assertion");
    } finally {
      setLoading(false);
    }
  };

  // Set mock mode
  const handleSetMockMode = async (mode: MockMode) => {
    const result = await runnerClient.setMockMode(mode);
    if (result.success) {
      setMockModeState(mode);
    } else {
      setError(result.error || "Failed to set mock mode");
    }
  };

  // End test run
  const endTestRun = async () => {
    if (!selectedRunId) return;

    setLoading(true);
    try {
      const result = await runnerClient.endTestRun(selectedRunId);
      if (result.success) {
        await loadTestRuns();
        setSelectedRunId(null);
        setTestResults([]);
      } else {
        setError(result.error || "Failed to end test run");
      }
    } finally {
      setLoading(false);
    }
  };

  // Traverse to a state
  const traverseToState = async (stateName: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await runnerClient.traverseToState(stateName, true);
      if (result.success) {
        await loadActiveStates();
      } else {
        setError(result.error || "Failed to traverse to state");
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isRunnerConnected) {
    return (
      <div className="p-6 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
        <h3 className="text-lg font-medium text-yellow-800 dark:text-yellow-200 mb-2">
          Runner Not Connected
        </h3>
        <p className="text-yellow-700 dark:text-yellow-300">
          The qontinui runner is not available. Please ensure it is running on
          port 9876.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Integration Test Runner</h2>
        <div className="flex items-center gap-2">
          <span
            className={`w-3 h-3 rounded-full ${
              isRunnerConnected ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {isRunnerConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-4 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-4 text-sm underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column - Test Configuration */}
        <div className="space-y-4">
          {/* New Test Run */}
          <div className="border rounded-lg p-4 dark:border-gray-700">
            <h3 className="text-lg font-medium mb-4">New Test Run</h3>
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="itr-test-name"
                  className="block text-sm font-medium mb-1"
                >
                  Test Name
                </label>
                <input
                  id="itr-test-name"
                  type="text"
                  value={testConfig.name}
                  onChange={(e) =>
                    setTestConfig({ ...testConfig, name: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-600"
                  placeholder="Integration Test"
                />
              </div>
              <div>
                <label
                  htmlFor="itr-config-path"
                  className="block text-sm font-medium mb-1"
                >
                  Config Path (optional)
                </label>
                <input
                  id="itr-config-path"
                  type="text"
                  value={testConfig.config_path || ""}
                  onChange={(e) =>
                    setTestConfig({
                      ...testConfig,
                      config_path: e.target.value || undefined,
                    })
                  }
                  className="w-full border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-600"
                  placeholder="C:\\path\\to\\config.json"
                />
              </div>
              <button
                onClick={startTestRun}
                disabled={loading}
                className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "Starting..." : "Start Test Run"}
              </button>
            </div>
          </div>

          {/* Run Assertion */}
          <div className="border rounded-lg p-4 dark:border-gray-700">
            <h3 className="text-lg font-medium mb-4">Run Assertion</h3>
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="itr-assertion-type"
                  className="block text-sm font-medium mb-1"
                >
                  Assertion Type
                </label>
                <select
                  id="itr-assertion-type"
                  value={newAssertion.type}
                  onChange={(e) =>
                    setNewAssertion({ ...newAssertion, type: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-600"
                >
                  <option value="state_reached">State Reached</option>
                  <option value="element_found">Element Found</option>
                  <option value="action_performed">Action Performed</option>
                  <option value="transition_completed">
                    Transition Completed
                  </option>
                  <option value="workflow_completed">Workflow Completed</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="itr-target"
                  className="block text-sm font-medium mb-1"
                >
                  Target
                </label>
                <input
                  id="itr-target"
                  type="text"
                  value={newAssertion.target}
                  onChange={(e) =>
                    setNewAssertion({ ...newAssertion, target: e.target.value })
                  }
                  className="w-full border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-600"
                  placeholder="State name or element ID"
                />
              </div>
              <div>
                <label
                  htmlFor="itr-expected"
                  className="block text-sm font-medium mb-1"
                >
                  Expected (optional)
                </label>
                <input
                  id="itr-expected"
                  type="text"
                  value={newAssertion.expected}
                  onChange={(e) =>
                    setNewAssertion({
                      ...newAssertion,
                      expected: e.target.value,
                    })
                  }
                  className="w-full border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-600"
                  placeholder="Expected value"
                />
              </div>
              <button
                onClick={runAssertion}
                disabled={loading || !newAssertion.target}
                className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? "Running..." : "Run Assertion"}
              </button>
            </div>
          </div>

          {/* Mock Mode Control */}
          <div className="border rounded-lg p-4 dark:border-gray-700">
            <h3 className="text-lg font-medium mb-4">Mock Mode</h3>
            <div className="flex gap-2">
              <button
                onClick={() => handleSetMockMode("disabled")}
                className={`flex-1 py-2 rounded border ${
                  mockMode === "disabled"
                    ? "bg-blue-600 text-white border-blue-600"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800 dark:border-gray-600"
                }`}
              >
                Disabled
              </button>
              <button
                onClick={() => handleSetMockMode("record")}
                className={`flex-1 py-2 rounded border ${
                  mockMode === "record"
                    ? "bg-yellow-600 text-white border-yellow-600"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800 dark:border-gray-600"
                }`}
              >
                Record
              </button>
              <button
                onClick={() => handleSetMockMode("playback")}
                className={`flex-1 py-2 rounded border ${
                  mockMode === "playback"
                    ? "bg-green-600 text-white border-green-600"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800 dark:border-gray-600"
                }`}
              >
                Playback
              </button>
            </div>
            <p className="text-sm text-gray-500 mt-2">
              {mockMode === "disabled" &&
                "Actions will execute normally on the screen."}
              {mockMode === "record" &&
                "Actions will be recorded without executing."}
              {mockMode === "playback" &&
                "Actions will be verified against recorded expectations."}
            </p>
          </div>
        </div>

        {/* Right column - Results and State */}
        <div className="space-y-4">
          {/* Test Runs List */}
          <div className="border rounded-lg p-4 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium">Recent Test Runs</h3>
              <button
                onClick={loadTestRuns}
                className="text-sm text-blue-600 hover:underline"
              >
                Refresh
              </button>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {testRuns.length === 0 ? (
                <p className="text-gray-500 text-sm">No test runs yet</p>
              ) : (
                testRuns.map((run) => (
                  <div
                    key={run.run_id}
                    onClick={() => setSelectedRunId(run.run_id)}
                    className={`p-2 rounded cursor-pointer border ${
                      selectedRunId === run.run_id
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                        : "border-transparent hover:bg-gray-100 dark:hover:bg-gray-800"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{run.name}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          run.status === "passed"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                            : run.status === "failed"
                              ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                              : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
                        }`}
                      >
                        {run.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {run.passed}/{run.test_count} passed
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Selected Test Results */}
          {selectedRunId && (
            <div className="border rounded-lg p-4 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium">Test Results</h3>
                <button
                  onClick={endTestRun}
                  disabled={loading}
                  className="text-sm text-red-600 hover:underline"
                >
                  End Run
                </button>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {testResults.length === 0 ? (
                  <p className="text-gray-500 text-sm">
                    No test results yet. Run some assertions.
                  </p>
                ) : (
                  testResults.map((result) => (
                    <TestResultItem key={result.test_id} result={result} />
                  ))
                )}
              </div>
            </div>
          )}

          {/* States Browser */}
          <div className="border rounded-lg p-4 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium">State Machine</h3>
              <button
                onClick={() => {
                  loadStates();
                  loadActiveStates();
                }}
                className="text-sm text-blue-600 hover:underline"
              >
                Refresh
              </button>
            </div>

            {activeStates.length > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
                  Active States
                </h4>
                <div className="flex flex-wrap gap-2">
                  {activeStates.map((state) => (
                    <span
                      key={state}
                      className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded text-sm"
                    >
                      {state}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {states.length === 0 ? (
                <p className="text-gray-500 text-sm">
                  No states loaded. Load a configuration first.
                </p>
              ) : (
                states.map((state) => (
                  <div
                    key={String(state.id)}
                    className="flex items-center justify-between p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                  >
                    <div>
                      <span className="font-medium">{state.name}</span>
                      {state.is_initial && (
                        <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">
                          (initial)
                        </span>
                      )}
                      {state.is_terminal && (
                        <span className="ml-2 text-xs text-gray-500">
                          (terminal)
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => traverseToState(state.name)}
                      disabled={loading}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Go to
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default IntegrationTestRunner;
