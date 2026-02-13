"use client";

import { useState, useEffect } from "react";
import type { WorkflowPhase, StepTypeInfo } from "@/types/unified-workflow";
import { STEP_TYPES, fetchStepTypes } from "@/types/unified-workflow";

type StepTypesMap = Record<WorkflowPhase, StepTypeInfo[]>;

let cachedStepTypes: StepTypesMap | null = null;
let fetchPromise: Promise<StepTypesMap | null> | null = null;

/**
 * Hook that fetches step types from the backend API with a static fallback.
 * Results are cached globally so the fetch only happens once per page load.
 */
export function useStepTypes(): StepTypesMap {
  const [stepTypes, setStepTypes] = useState<StepTypesMap>(
    cachedStepTypes ?? STEP_TYPES
  );

  useEffect(() => {
    if (cachedStepTypes) {
      setStepTypes(cachedStepTypes);
      return;
    }

    if (!fetchPromise) {
      fetchPromise = fetchStepTypes();
    }

    fetchPromise.then((result) => {
      if (result) {
        cachedStepTypes = result;
        setStepTypes(result);
      } else {
        cachedStepTypes = STEP_TYPES;
      }
    });
  }, []);

  return stepTypes;
}
