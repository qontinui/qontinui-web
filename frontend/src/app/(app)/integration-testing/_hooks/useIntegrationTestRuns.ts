import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useProject } from "@/hooks/automation/useProject";
import { useWorkflows } from "@/hooks/automation/useWorkflows";
import { useAutomationStore } from "@/stores/automation";
import { useProjectLoader } from "@/hooks/use-project-loader";
import { integrationTestingService } from "@/services/integration-testing";
import type { ViewMode } from "../_types";
import type {
  IntegrationTestResponse,
  IntegrationTestRunSummary,
  WorkflowConfig,
} from "@/types/integration-testing";

export function useIntegrationTestRuns() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { projectId } = useProject();
  const { workflows } = useWorkflows();
  const states = useAutomationStore((s) => s.states);

  const { isLoading: projectLoading } = useProjectLoader();

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null
  );
  const [initialStatesOverride, setInitialStatesOverride] = useState<
    string[] | null
  >(null);

  const [runs, setRuns] = useState<IntegrationTestRunSummary[]>([]);
  const [selectedRun, setSelectedRun] =
    useState<IntegrationTestResponse | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [loading, setLoading] = useState(true);
  const [runningTest, setRunningTest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiHealthy, setApiHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    const checkHealth = async () => {
      const healthy = await integrationTestingService.checkApiHealth();
      setApiHealthy(healthy);
    };
    checkHealth();
  }, []);

  const fetchRuns = useCallback(async () => {
    if (!projectId) return;

    try {
      setLoading(true);
      setError(null);
      const response =
        await integrationTestingService.getIntegrationTestRuns(projectId);
      setRuns(response.runs);
    } catch (err) {
      console.error("Failed to fetch integration test runs:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch runs");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    } else if (user && projectId) {
      fetchRuns();
    } else if (user && !projectId) {
      setLoading(false);
    }
  }, [user, authLoading, router, fetchRuns, projectId]);

  useEffect(() => {
    if (workflows.length > 0 && selectedWorkflowId === null && !loading) {
      const mainWorkflows = workflows.filter((w) => w.category === "Main");
      const firstWorkflow = mainWorkflows[0];
      if (firstWorkflow) {
        setSelectedWorkflowId(firstWorkflow.id);
      }
    }
  }, [workflows, selectedWorkflowId, loading]);

  const buildWorkflowConfig = useCallback((): WorkflowConfig | null => {
    const workflow = workflows.find((w) => w.id === selectedWorkflowId);
    if (!workflow) return null;

    const effectiveInitialStates =
      initialStatesOverride ?? workflow.initialStateIds ?? [];

    const stateConfigs = states.map((s) => ({
      id: s.id,
      name: s.name,
      patterns: s.stateImages?.map((img) => img.id) ?? [],
      is_initial: effectiveInitialStates.includes(s.id),
    }));

    const transitions = useAutomationStore.getState().transitions;
    const transitionConfigs = transitions
      .filter((t) => t.type === "OutgoingTransition")
      .map((t) => {
        const outgoing = t as {
          id: string;
          fromState: string;
          activateStates: string[];
          deactivateStates: string[];
          workflows: string[];
        };
        return {
          id: outgoing.id,
          name: outgoing.id,
          from_state_id: outgoing.fromState,
          to_state_id: outgoing.activateStates[0] ?? "",
          actions:
            outgoing.workflows?.map((wfId) => ({
              id: wfId,
              type: "workflow",
            })) ?? [],
        };
      });

    return {
      workflow_id: workflow.id,
      workflow_name: workflow.name,
      states: stateConfigs,
      transitions: transitionConfigs,
      initial_state_ids: effectiveInitialStates,
    };
  }, [selectedWorkflowId, workflows, states, initialStatesOverride]);

  const loadRunDetails = async (runId: string) => {
    try {
      setLoading(true);
      setError(null);
      const result =
        await integrationTestingService.getIntegrationTestResult(runId);
      setSelectedRun(result);
      setViewMode("detail");
    } catch (err) {
      console.error("Failed to load run details:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load run details"
      );
    } finally {
      setLoading(false);
    }
  };

  const runIntegrationTest = async () => {
    if (!projectId) {
      setError("No project selected. Please select a project first.");
      return;
    }

    if (apiHealthy === null) {
      setError("Still checking API connection. Please wait...");
      return;
    }

    if (apiHealthy === false) {
      setError("Runner is offline. Please start the runner.");
      return;
    }

    const workflowConfig = buildWorkflowConfig();
    if (!workflowConfig) {
      setError("No workflow selected. Please select a workflow first.");
      return;
    }

    try {
      setRunningTest(true);
      setError(null);
      console.log("Running integration test with config:", workflowConfig);
      const result = await integrationTestingService.runIntegrationTest(
        projectId,
        workflowConfig,
        {
          include_historical_stats: true,
          record_screenshots: true,
        }
      );
      console.log("Integration test result:", result);
      setSelectedRun(result);
      setViewMode("detail");
      fetchRuns();
    } catch (err) {
      console.error("Failed to run integration test:", err);
      setError(
        err instanceof Error ? err.message : "Failed to run integration test"
      );
    } finally {
      setRunningTest(false);
    }
  };

  const toggleViewMode = () => {
    setViewMode((prev) => (prev === "detail" ? "visual" : "detail"));
  };

  const goBackToList = () => {
    setSelectedRun(null);
    setViewMode("list");
  };

  const dismissError = () => setError(null);

  return {
    user,
    authLoading,
    projectId,
    projectLoading,
    workflows,
    states,
    selectedWorkflowId,
    setSelectedWorkflowId,
    initialStatesOverride,
    setInitialStatesOverride,
    runs,
    selectedRun,
    viewMode,
    loading,
    runningTest,
    error,
    apiHealthy,
    fetchRuns,
    loadRunDetails,
    runIntegrationTest,
    toggleViewMode,
    goBackToList,
    dismissError,
  };
}
