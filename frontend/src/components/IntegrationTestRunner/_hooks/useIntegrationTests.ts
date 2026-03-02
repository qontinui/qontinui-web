"use client";

import { useState, useEffect, useCallback } from "react";
import { runnerClient, type MockMode } from "@/lib/runner-client";
import type {
  TestConfig,
  NewAssertion,
  IntegrationTestState,
  IntegrationTestActions,
} from "../types";

const DEFAULT_TEST_CONFIG: TestConfig = {
  name: "Integration Test",
  assertions: [],
};

const DEFAULT_ASSERTION: NewAssertion = {
  type: "state_reached",
  target: "",
  expected: "",
  timeout_seconds: 30,
};

export function useIntegrationTests(): IntegrationTestState &
  IntegrationTestActions {
  const [testRuns, setTestRuns] = useState<IntegrationTestState["testRuns"]>(
    []
  );
  const [selectedRunId, setSelectedRunId] =
    useState<IntegrationTestState["selectedRunId"]>(null);
  const [testResults, setTestResults] = useState<
    IntegrationTestState["testResults"]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<IntegrationTestState["states"]>([]);
  const [activeStates, setActiveStates] = useState<string[]>([]);
  const [mockMode, setMockModeState] = useState<MockMode>("disabled");
  const [testConfig, setTestConfig] = useState<TestConfig>(DEFAULT_TEST_CONFIG);
  const [newAssertion, setNewAssertion] =
    useState<NewAssertion>(DEFAULT_ASSERTION);
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

  const loadTestRuns = useCallback(async () => {
    const result = await runnerClient.listTestRuns(20);
    if (result.success && result.runs) {
      setTestRuns(result.runs);
    }
  }, []);

  const loadStates = useCallback(async () => {
    const result = await runnerClient.getTestingStates();
    if (result.success && result.states) {
      setStates(result.states);
    }
  }, []);

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
        alert(
          `Assertion ${result.assertion.passed ? "PASSED" : "FAILED"}: ${
            result.assertion.actual_value || "No value"
          }`
        );
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

  const handleSetMockMode = async (mode: MockMode) => {
    const result = await runnerClient.setMockMode(mode);
    if (result.success) {
      setMockModeState(mode);
    } else {
      setError(result.error || "Failed to set mock mode");
    }
  };

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

  return {
    testRuns,
    selectedRunId,
    testResults,
    loading,
    error,
    states,
    activeStates,
    mockMode,
    testConfig,
    newAssertion,
    isRunnerConnected,
    setSelectedRunId,
    setError,
    setTestConfig,
    setNewAssertion,
    loadTestRuns,
    loadStates,
    loadActiveStates,
    startTestRun,
    runAssertion,
    handleSetMockMode,
    endTestRun,
    traverseToState,
  };
}
