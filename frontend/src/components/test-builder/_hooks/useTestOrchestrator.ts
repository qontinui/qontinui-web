import { useState, useEffect, useCallback, useMemo } from "react";
import { runnerFetch } from "@/lib/runner/api-client";
import { runnerApi } from "@/lib/runner/runner-api-object";
import type { SavedApiRequest } from "@/lib/runner/types/library";
import type {
  TestType,
  OrchestratorPhase,
  OrchestrationPlan,
  OrchestrationExecutionResult,
  GeneratedTest,
  TestOrchestratorProps,
} from "../_types/orchestrator-types";

export function useTestOrchestrator({
  onTestGenerated,
}: Pick<TestOrchestratorProps, "onTestGenerated">) {
  // Phase management
  const [phase, setPhase] = useState<OrchestratorPhase>("selection");

  // Selection phase state
  const [availableRequests, setAvailableRequests] = useState<SavedApiRequest[]>(
    []
  );
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(
    new Set()
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingRequests, setLoadingRequests] = useState(false);

  // Planning phase state
  const [testDescription, setTestDescription] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [testType, setTestType] = useState<TestType>("python_script");
  const [plan, setPlan] = useState<OrchestrationPlan | null>(null);
  const [planning, setPlanning] = useState(false);

  // Execution phase state
  const [executionResult, setExecutionResult] =
    useState<OrchestrationExecutionResult | null>(null);
  const [executing, setExecuting] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Generation phase state
  const [generatedTest, setGeneratedTest] = useState<GeneratedTest | null>(
    null
  );
  const [generating, setGenerating] = useState(false);

  // Shared state
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Data Loading
  // ---------------------------------------------------------------------------

  const loadSavedRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const requests = await runnerApi.getSavedApiRequests();
      setAvailableRequests(requests);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load saved API requests"
      );
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    loadSavedRequests();
  }, [loadSavedRequests]);

  // ---------------------------------------------------------------------------
  // Filtered & Selected Requests
  // ---------------------------------------------------------------------------

  const filteredRequests = useMemo(() => {
    const q = searchQuery.toLowerCase();
    if (!q) return availableRequests;
    return availableRequests.filter(
      (req) =>
        req.name.toLowerCase().includes(q) ||
        req.url.toLowerCase().includes(q) ||
        (req.description ?? "").toLowerCase().includes(q)
    );
  }, [availableRequests, searchQuery]);

  // ---------------------------------------------------------------------------
  // Selection Actions
  // ---------------------------------------------------------------------------

  const toggleRequest = (id: string) => {
    setSelectedRequestIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedRequestIds(new Set(filteredRequests.map((r) => r.id)));
  };

  const clearSelection = () => {
    setSelectedRequestIds(new Set());
  };

  // ---------------------------------------------------------------------------
  // Phase: Planning - Create AI Plan
  // ---------------------------------------------------------------------------

  const createPlan = useCallback(async () => {
    if (selectedRequestIds.size === 0) {
      setError("Please select at least one API request");
      return;
    }
    if (!testDescription.trim()) {
      setError("Please describe what the test should verify");
      return;
    }

    setPlanning(true);
    setError(null);
    setPhase("planning");

    try {
      const response = await runnerFetch<OrchestrationPlan>(
        "/test-orchestration/plan",
        {
          method: "POST",
          body: JSON.stringify({
            request_ids: Array.from(selectedRequestIds),
            test_description: testDescription.trim(),
            context: additionalContext.trim() || undefined,
          }),
          timeoutMs: 120000,
        }
      );

      setPlan(response);
    } catch (err) {
      setError(
        `Failed to create plan: ${err instanceof Error ? err.message : String(err)}`
      );
      setPhase("selection");
    } finally {
      setPlanning(false);
    }
  }, [selectedRequestIds, testDescription, additionalContext]);

  // ---------------------------------------------------------------------------
  // Phase: Execution - Run the Plan
  // ---------------------------------------------------------------------------

  const executePlan = useCallback(async () => {
    if (!plan) return;

    setExecuting(true);
    setError(null);
    setPhase("execution");
    setCurrentStepIndex(0);

    try {
      const response = await runnerFetch<OrchestrationExecutionResult>(
        "/test-orchestration/execute",
        {
          method: "POST",
          body: JSON.stringify({ plan }),
          timeoutMs: 300000,
        }
      );

      setExecutionResult(response);

      if (!response.success) {
        const failedIdx = response.failed_at_step;
        const failedStep =
          failedIdx !== undefined
            ? response.step_results[failedIdx]
            : undefined;
        const statusCode = failedStep?.response?.status_code;
        const errorDetail =
          failedStep?.error || `HTTP ${statusCode || "unknown"}`;
        const isAuthError = statusCode === 401 || statusCode === 403;
        const authHint = isAuthError
          ? " Auth tokens may have expired. Try re-capturing the requests."
          : "";
        setError(
          `Step ${failedIdx !== undefined ? failedIdx + 1 : "?"} failed: ${errorDetail}${authHint}`
        );
      }
    } catch (err) {
      setError(
        `Execution failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setExecuting(false);
    }
  }, [plan]);

  // ---------------------------------------------------------------------------
  // Phase: Generation - Generate Test Code
  // ---------------------------------------------------------------------------

  const generateTestCode = useCallback(async () => {
    if (!plan || !executionResult) return;

    setGenerating(true);
    setError(null);
    setPhase("generation");

    try {
      const response = await runnerFetch<GeneratedTest>(
        "/test-orchestration/generate",
        {
          method: "POST",
          body: JSON.stringify({
            execution_result: executionResult,
            plan,
            test_type: testType,
          }),
          timeoutMs: 120000,
        }
      );

      setGeneratedTest(response);
    } catch (err) {
      setError(
        `Failed to generate test: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setGenerating(false);
    }
  }, [plan, executionResult, testType]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const applyTest = useCallback(() => {
    if (generatedTest && onTestGenerated) {
      onTestGenerated(generatedTest.code, testType);
    }
  }, [generatedTest, testType, onTestGenerated]);

  const copyCode = useCallback(() => {
    if (generatedTest?.code) {
      navigator.clipboard.writeText(generatedTest.code);
    }
  }, [generatedTest]);

  const reset = () => {
    setPhase("selection");
    setPlan(null);
    setExecutionResult(null);
    setGeneratedTest(null);
    setError(null);
    setCurrentStepIndex(0);
  };

  // Navigate to next phase (for completed phases)
  const canAdvance =
    (phase === "selection" &&
      selectedRequestIds.size > 0 &&
      testDescription.trim() !== "") ||
    (phase === "planning" && plan !== null && !planning) ||
    (phase === "execution" &&
      executionResult?.success === true &&
      !executing) ||
    (phase === "generation" && generatedTest !== null && !generating);

  const canGoBack =
    phase === "planning" || phase === "execution" || phase === "generation";

  const advancePhase = () => {
    if (phase === "selection") {
      createPlan();
    } else if (phase === "planning") {
      executePlan();
    } else if (phase === "execution") {
      generateTestCode();
    } else if (phase === "generation" && generatedTest) {
      applyTest();
    }
  };

  const goBack = () => {
    setError(null);
    if (phase === "planning") {
      setPhase("selection");
    } else if (phase === "execution") {
      setPhase("planning");
    } else if (phase === "generation") {
      setPhase("execution");
    }
  };

  return {
    // Phase
    phase,

    // Selection state
    filteredRequests,
    selectedRequestIds,
    searchQuery,
    setSearchQuery,
    loadingRequests,
    availableRequests,
    testDescription,
    setTestDescription,
    additionalContext,
    setAdditionalContext,
    testType,
    setTestType,

    // Selection actions
    toggleRequest,
    selectAll,
    clearSelection,

    // Planning state
    plan,
    planning,

    // Execution state
    executionResult,
    executing,
    currentStepIndex,

    // Generation state
    generatedTest,
    generating,

    // Shared state
    error,
    setError,

    // Navigation
    canAdvance,
    canGoBack,
    advancePhase,
    goBack,
    reset,

    // Actions
    copyCode,
  };
}
