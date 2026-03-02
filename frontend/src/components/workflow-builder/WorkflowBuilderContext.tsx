"use client";

import React, { createContext, useContext, useMemo } from "react";
import {
  WorkflowBuilderProvider as SharedWorkflowBuilderProvider,
  useWorkflowBuilder as useSharedWorkflowBuilder,
} from "@qontinui/workflow-ui";
import {
  createDefaultWorkflow,
  generateStepId,
  type UnifiedWorkflow,
} from "@/types/unified-workflow";
import type { WorkflowBuilderContextValue } from "./workflow-builder-types";
import { loadFromStorage } from "./workflow-builder-storage";
import { useWebWorkflowState } from "./_hooks/useWebWorkflowState";
import { useStepActions } from "./_hooks/useStepActions";
import { useStageActions } from "./_hooks/useStageActions";
import { useWorkflowApi } from "./_hooks/useWorkflowApi";

const WorkflowBuilderContext =
  createContext<WorkflowBuilderContextValue | null>(null);

function WebWorkflowBuilderInner({
  children,
  initialWorkflow,
}: {
  children: React.ReactNode;
  initialWorkflow?: UnifiedWorkflow;
}) {
  const shared = useSharedWorkflowBuilder();

  const {
    webState,
    originalWorkflow,
    setOriginalWorkflow,
    setIsLoadingState,
    setIsSavingState,
    setErrorState,
    setWorkflow,
    updateWorkflow,
    resetToNew,
    setLoading,
    setSaving,
    setError,
    markSaved,
  } = useWebWorkflowState(shared, initialWorkflow);

  const stepActions = useStepActions(shared);
  const stageActions = useStageActions(shared, webState.currentStageIndex);
  const apiActions = useWorkflowApi(
    shared,
    originalWorkflow,
    setOriginalWorkflow,
    setIsLoadingState,
    setIsSavingState,
    setErrorState
  );

  const value: WorkflowBuilderContextValue = useMemo(
    () => ({
      state: webState,
      features: shared.features,
      hasUnsavedChanges:
        shared.hasUnsavedChanges ||
        (originalWorkflow === null && webState.workflow.name !== ""),
      isEmpty: shared.isEmpty,
      setWorkflow,
      updateWorkflow,
      resetToNew,
      setLoading,
      setSaving,
      setError,
      markSaved,
      currentStageIndex: webState.currentStageIndex,
      ...stepActions,
      ...stageActions,
      ...apiActions,
    }),
    [
      webState,
      shared.features,
      shared.hasUnsavedChanges,
      shared.isEmpty,
      originalWorkflow,
      setWorkflow,
      updateWorkflow,
      resetToNew,
      setLoading,
      setSaving,
      setError,
      markSaved,
      stepActions,
      stageActions,
      apiActions,
    ]
  );

  return (
    <WorkflowBuilderContext.Provider value={value}>
      {children}
    </WorkflowBuilderContext.Provider>
  );
}

interface WorkflowBuilderProviderProps {
  children: React.ReactNode;
  initialWorkflow?: UnifiedWorkflow;
}

export function WorkflowBuilderProvider({
  children,
  initialWorkflow,
}: WorkflowBuilderProviderProps) {
  const storedWorkflow = !initialWorkflow ? loadFromStorage() : null;
  const resolvedInitial = initialWorkflow ??
    storedWorkflow ?? {
      ...createDefaultWorkflow(),
      id: generateStepId(),
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
    };

  return (
    <SharedWorkflowBuilderProvider initialWorkflow={resolvedInitial}>
      <WebWorkflowBuilderInner initialWorkflow={initialWorkflow}>
        {children}
      </WebWorkflowBuilderInner>
    </SharedWorkflowBuilderProvider>
  );
}

export function useWorkflowBuilder(): WorkflowBuilderContextValue {
  const context = useContext(WorkflowBuilderContext);
  if (!context) {
    throw new Error(
      "useWorkflowBuilder must be used within a WorkflowBuilderProvider"
    );
  }
  return context;
}
