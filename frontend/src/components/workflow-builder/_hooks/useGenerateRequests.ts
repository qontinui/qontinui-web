import { useCallback } from "react";
import { toast } from "sonner";
import { runnerApi } from "@/lib/runner-api";
import type { GenerateWorkflowRequest } from "@/lib/runner/types/workflow";
import type { SpecSourceState } from "../SpecSourceSection";
import { buildSpecPrompt } from "@/lib/spec-prompt-builder";
import { autoSaveGenerationPrompt } from "../ai-generate-utils";
import {
  AUTO_RUN_AFTER_GENERATE_KEY,
  type AutoRunAfterGenerate,
  type SubmittingAction,
} from "../ai-generate-types";

interface UseGenerateRequestsParams {
  // Form state
  description: string;
  selectedContextIds: string[];
  inlineContext: string;
  specState: SpecSourceState;
  hasSpecs: boolean;
  isBatchMode: boolean;

  // Advanced options
  category: string;
  tagsInput: string;
  maxIterations: string;
  provider: string;
  model: string;
  maxFixIterations: string;
  autoIncludeContexts: boolean;
  discoveryMode: "auto" | "enabled" | "disabled";
  includeUIBridge: boolean;
  reflectionMode: boolean;
  investigateCodebase: boolean;
  includeDesignGuidance: boolean;

  // Actions
  setSubmittingAction: (value: SubmittingAction) => void;
  onNavigateToActiveRuns: (taskRunId: string) => void;
}

export function useGenerateRequests(params: UseGenerateRequestsParams) {
  const {
    description,
    selectedContextIds,
    inlineContext,
    specState,
    hasSpecs,
    isBatchMode,
    category,
    tagsInput,
    maxIterations,
    provider,
    model,
    maxFixIterations,
    autoIncludeContexts,
    discoveryMode,
    includeUIBridge,
    reflectionMode,
    investigateCodebase,
    includeDesignGuidance,
    setSubmittingAction,
    onNavigateToActiveRuns,
  } = params;

  const canGenerate = !!(description.trim() || hasSpecs);

  /** Build the base request (everything except description). */
  const buildBaseRequest = useCallback((): Omit<
    GenerateWorkflowRequest,
    "description"
  > => {
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (hasSpecs && !tags.includes("spec-generated")) {
      tags.push("spec-generated");
    }

    return {
      category: category.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      context_ids:
        selectedContextIds.length > 0 ? selectedContextIds : undefined,
      inline_context: inlineContext.trim() || undefined,
      max_iterations: maxIterations ? parseInt(maxIterations, 10) : undefined,
      provider: provider.trim() || undefined,
      model: model.trim() || undefined,
      max_fix_iterations: maxFixIterations
        ? parseInt(maxFixIterations, 10)
        : undefined,
      auto_include_contexts: autoIncludeContexts,
      discovery_mode: discoveryMode !== "auto" ? discoveryMode : undefined,
      include_ui_bridge_instructions: includeUIBridge,
      reflection_mode: reflectionMode,
      investigate_codebase: investigateCodebase,
      include_design_guidance: includeDesignGuidance || undefined,
    };
  }, [
    tagsInput,
    category,
    selectedContextIds,
    inlineContext,
    maxIterations,
    provider,
    model,
    maxFixIterations,
    autoIncludeContexts,
    discoveryMode,
    hasSpecs,
    includeUIBridge,
    reflectionMode,
    investigateCodebase,
    includeDesignGuidance,
  ]);

  /** Build a single request (non-batch or fallback). */
  const buildGenerateRequest = useCallback((): GenerateWorkflowRequest => {
    const base = buildBaseRequest();

    let fullDescription = "";
    if (
      specState.discoveredSpecs.length > 0 &&
      specState.selectedGroupIds.size > 0
    ) {
      const specResult = buildSpecPrompt({
        discoveredSpecs: specState.discoveredSpecs,
        selectedGroupIds: specState.selectedGroupIds,
      });
      fullDescription = specResult.prompt;
      if (description.trim()) {
        fullDescription += `\n\n## Additional Instructions\n${description.trim()}`;
      }
    } else {
      fullDescription = description.trim();
    }

    return { ...base, description: fullDescription };
  }, [buildBaseRequest, description, specState]);

  /** Build one request per selected page (batch mode). */
  const buildBatchRequests = useCallback((): GenerateWorkflowRequest[] => {
    const base = buildBaseRequest();
    const requests: GenerateWorkflowRequest[] = [];

    for (const pageUrl of specState.selectedPageUrls) {
      // Filter specs belonging to this page
      const pageSpecs = specState.discoveredSpecs.filter(
        (s) => (s.config.metadata?.pageUrl || s.specId) === pageUrl
      );
      if (pageSpecs.length === 0) continue;

      // Filter selectedGroupIds to only groups in this page's specs
      const pageGroupIds = new Set<string>();
      for (const spec of pageSpecs) {
        for (const group of spec.config.groups) {
          if (specState.selectedGroupIds.has(group.id)) {
            pageGroupIds.add(group.id);
          }
        }
      }
      if (pageGroupIds.size === 0) continue;

      const specResult = buildSpecPrompt({
        discoveredSpecs: pageSpecs,
        selectedGroupIds: pageGroupIds,
      });

      let fullDescription = specResult.prompt;
      if (description.trim()) {
        fullDescription += `\n\n## Additional Instructions\n${description.trim()}`;
      }

      requests.push({ ...base, description: fullDescription });
    }

    return requests;
  }, [buildBaseRequest, description, specState]);

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setSubmittingAction("generate");
    try {
      let firstTaskRunId: string;
      if (isBatchMode) {
        const requests = buildBatchRequests();
        const results = await Promise.all(
          requests.map((r) => runnerApi.generateWorkflowAsync(r))
        );
        firstTaskRunId = results[0]?.task_run_id ?? "";
        toast.success(`${results.length} workflows generated`);
      } else {
        const response = await runnerApi.generateWorkflowAsync(
          buildGenerateRequest()
        );
        firstTaskRunId = response.task_run_id;
      }
      if (description.trim()) {
        autoSaveGenerationPrompt(description); // fire-and-forget
      }
      onNavigateToActiveRuns(firstTaskRunId);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to start workflow generation"
      );
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleGenerateAndRun = async () => {
    if (!canGenerate) return;
    setSubmittingAction("generate-and-run");
    const toastId = toast.loading("Starting workflow generation...");
    try {
      let firstTaskRunId: string;
      if (isBatchMode) {
        const requests = buildBatchRequests();
        const results = await Promise.all(
          requests.map((r) => runnerApi.generateWorkflowAsync(r))
        );
        firstTaskRunId = results[0]?.task_run_id ?? "";
        // Signal auto-run for the first workflow
        if (firstTaskRunId) {
          localStorage.setItem(
            AUTO_RUN_AFTER_GENERATE_KEY,
            JSON.stringify({
              taskRunId: firstTaskRunId,
              timestamp: Date.now(),
            } satisfies AutoRunAfterGenerate)
          );
        }
        toast.success(`${results.length} workflows generated`, {
          id: toastId,
        });
      } else {
        const response = await runnerApi.generateWorkflowAsync(
          buildGenerateRequest()
        );
        firstTaskRunId = response.task_run_id;
        localStorage.setItem(
          AUTO_RUN_AFTER_GENERATE_KEY,
          JSON.stringify({
            taskRunId: firstTaskRunId,
            timestamp: Date.now(),
          } satisfies AutoRunAfterGenerate)
        );
        toast.dismiss(toastId);
      }
      if (description.trim()) {
        autoSaveGenerationPrompt(description); // fire-and-forget
      }
      onNavigateToActiveRuns(firstTaskRunId);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to start workflow generation",
        { id: toastId }
      );
    } finally {
      setSubmittingAction(null);
    }
  };

  return {
    canGenerate,
    handleGenerate,
    handleGenerateAndRun,
  };
}
