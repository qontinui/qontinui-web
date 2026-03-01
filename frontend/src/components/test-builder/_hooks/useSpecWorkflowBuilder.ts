import { useState, useCallback, useMemo } from "react";
import {
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type {
  AnalyzedElement,
  SpecStep,
  SpecStepType,
} from "../spec-workflow-types";
import {
  createDefaultStep,
  generatePlaywrightCode,
} from "../spec-workflow-utils";

// ---------------------------------------------------------------------------
// useSpecWorkflowBuilder
// ---------------------------------------------------------------------------

interface UseSpecWorkflowBuilderOptions {
  elements: AnalyzedElement[];
  initialSteps?: SpecStep[];
  onGenerate?: (code: string, steps: SpecStep[]) => void;
}

export function useSpecWorkflowBuilder({
  elements,
  initialSteps,
  onGenerate,
}: UseSpecWorkflowBuilderOptions) {
  const [steps, setSteps] = useState<SpecStep[]>(initialSteps ?? []);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const selectedStep = useMemo(
    () => steps.find((s) => s.id === selectedStepId) ?? null,
    [steps, selectedStepId]
  );

  const generatedCode = useMemo(
    () => generatePlaywrightCode(steps, elements),
    [steps, elements]
  );

  // --- DnD sensors ---
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // --- Step CRUD ---
  const addStep = useCallback((type: SpecStepType) => {
    const newStep = createDefaultStep(type);
    setSteps((prev) => [...prev, newStep]);
    setSelectedStepId(newStep.id);
  }, []);

  const updateStep = useCallback((updated: SpecStep) => {
    setSteps((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }, []);

  const deleteStep = useCallback(
    (stepId: string) => {
      setSteps((prev) => prev.filter((s) => s.id !== stepId));
      if (selectedStepId === stepId) {
        setSelectedStepId(null);
      }
    },
    [selectedStepId]
  );

  const moveStep = useCallback((index: number, direction: -1 | 1) => {
    setSteps((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const a = next[index];
      const b = next[target];
      if (!a || !b) return prev;
      next[index] = b;
      next[target] = a;
      return next;
    });
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSteps((prev) => {
      const oldIndex = prev.findIndex((s) => s.id === active.id);
      const newIndex = prev.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const next = [...prev];
      const moved = next.splice(oldIndex, 1)[0];
      if (!moved) return prev;
      next.splice(newIndex, 0, moved);
      return next;
    });
  }, []);

  // --- Clipboard ---
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [generatedCode]);

  const handleGenerate = useCallback(() => {
    setShowCode(true);
    onGenerate?.(generatedCode, steps);
  }, [generatedCode, steps, onGenerate]);

  return {
    steps,
    selectedStepId,
    selectedStep,
    showCode,
    copied,
    generatedCode,
    sensors,
    setSelectedStepId,
    setShowCode,
    addStep,
    updateStep,
    deleteStep,
    moveStep,
    handleDragEnd,
    handleCopy,
    handleGenerate,
  };
}
