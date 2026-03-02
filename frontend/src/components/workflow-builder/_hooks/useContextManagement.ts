import { useMemo, useCallback } from "react";
import { useWorkflowBuilder } from "../WorkflowBuilderContext";
import { useContextsDetailed } from "@/lib/runner/hooks/library-hooks";
import type { ContextItem } from "@/lib/runner/types/exploration";
import {
  evaluateAutoInclude,
  type IncludedContext,
} from "../context-management-types";

export function useContextManagement() {
  const { state, updateWorkflow } = useWorkflowBuilder();
  const { workflow } = state;
  const {
    data: contexts,
    isLoading,
    error,
    isOffline,
    refetch,
  } = useContextsDetailed();

  const contextIds = useMemo(
    () => workflow.context_ids ?? [],
    [workflow.context_ids]
  );
  const disabledContextIds = useMemo(
    () => new Set(workflow.disabled_context_ids ?? []),
    [workflow.disabled_context_ids]
  );
  const autoIncludeEnabled = workflow.auto_include_contexts ?? true;

  const autoDetectedContexts = useMemo(() => {
    if (!autoIncludeEnabled || !contexts) return [];
    return evaluateAutoInclude(workflow.description, contexts);
  }, [workflow.description, contexts, autoIncludeEnabled]);

  const addContext = useCallback(
    (contextId: string) => {
      if (!contextIds.includes(contextId)) {
        updateWorkflow({ context_ids: [...contextIds, contextId] });
      }
    },
    [contextIds, updateWorkflow]
  );

  const removeContext = useCallback(
    (contextId: string) => {
      updateWorkflow({
        context_ids: contextIds.filter((id) => id !== contextId),
      });
    },
    [contextIds, updateWorkflow]
  );

  const toggleContextDisabled = useCallback(
    (contextId: string) => {
      const disabled = new Set(disabledContextIds);
      if (disabled.has(contextId)) {
        disabled.delete(contextId);
      } else {
        disabled.add(contextId);
      }
      updateWorkflow({ disabled_context_ids: Array.from(disabled) });
    },
    [disabledContextIds, updateWorkflow]
  );

  const handleToggle = useCallback(
    (contextId: string, isAutoIncluded: boolean) => {
      if (isAutoIncluded) {
        toggleContextDisabled(contextId);
      } else {
        removeContext(contextId);
      }
    },
    [toggleContextDisabled, removeContext]
  );

  const setAutoInclude = useCallback(
    (value: boolean) => {
      updateWorkflow({ auto_include_contexts: value });
    },
    [updateWorkflow]
  );

  const includedContexts = useMemo((): IncludedContext[] => {
    if (!contexts) return [];
    const result: IncludedContext[] = [];

    for (const autoResult of autoDetectedContexts) {
      if (disabledContextIds.has(autoResult.contextId)) continue;
      const ctx = contexts.find((c) => c.id === autoResult.contextId);
      if (ctx) {
        result.push({
          context: ctx,
          isAutoIncluded: true,
          autoIncludeReason: `${autoResult.reason}: "${autoResult.matchedTrigger}"`,
        });
      }
    }

    for (const id of contextIds) {
      if (result.some((r) => r.context.id === id)) continue;
      const ctx = contexts.find((c) => c.id === id);
      if (ctx) {
        result.push({
          context: ctx,
          isAutoIncluded: false,
        });
      }
    }

    return result;
  }, [contexts, autoDetectedContexts, contextIds, disabledContextIds]);

  const disabledAutoContexts = useMemo(() => {
    if (!contexts || !autoIncludeEnabled) return [];
    return autoDetectedContexts
      .filter((a) => disabledContextIds.has(a.contextId))
      .map((a) => contexts.find((c) => c.id === a.contextId))
      .filter((c): c is ContextItem => c != null);
  }, [contexts, autoDetectedContexts, disabledContextIds, autoIncludeEnabled]);

  return {
    contexts,
    isLoading,
    error,
    isOffline,
    refetch,
    autoIncludeEnabled,
    includedContexts,
    disabledAutoContexts,
    addContext,
    removeContext,
    toggleContextDisabled,
    handleToggle,
    setAutoInclude,
  };
}
