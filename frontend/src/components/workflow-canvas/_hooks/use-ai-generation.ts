import { useState, useCallback, useEffect, useRef } from "react";
import {
  getMCPClient,
  type GeneratedWorkflow,
  type GenerationContext,
} from "../../../services/mcp-client";
import type { Workflow } from "../../../lib/action-schema/action-types";
import type { PromptTemplate } from "../../../services/prompt-templates";
import type { GenerationState } from "../AIGenerationDialog.types";

interface UseAIGenerationParams {
  isOpen: boolean;
  initialPrompt: string;
  existingWorkflow?: Workflow;
  onAccept: (workflow: Workflow) => void;
  onClose: () => void;
}

export function useAIGeneration({
  isOpen,
  initialPrompt,
  existingWorkflow,
  onAccept,
  onClose,
}: UseAIGenerationParams) {
  const [description, setDescription] = useState(initialPrompt);
  const [state, setState] = useState<GenerationState>("idle");
  const [result, setResult] = useState<GeneratedWorkflow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedAlternative, setSelectedAlternative] = useState<number | null>(
    null
  );
  const [refinementInput, setRefinementInput] = useState("");
  const [showExamples, setShowExamples] = useState(true);
  const [useExistingWorkflow, setUseExistingWorkflow] =
    useState(!!existingWorkflow);
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);

  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const mcpClient = getMCPClient();

  useEffect(() => {
    if (isOpen && textAreaRef.current) {
      textAreaRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setDescription(initialPrompt);
      setState("idle");
      setError(null);
      setSelectedAlternative(null);
      setRefinementInput("");
    }
  }, [isOpen, initialPrompt]);

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) {
      setError("Please enter a workflow description");
      return;
    }

    setState("generating");
    setError(null);
    setResult(null);
    setSelectedAlternative(null);

    try {
      const context: GenerationContext = {
        existingWorkflow: useExistingWorkflow ? existingWorkflow : undefined,
        templates: selectedTemplates,
      };

      const generated = await mcpClient.generateWorkflow(description, context);

      setResult(generated);
      setState("success");
      setShowExamples(false);
    } catch (err) {
      console.error("Generation failed:", err);
      setError(
        err instanceof Error ? err.message : "Failed to generate workflow"
      );
      setState("error");
    }
  }, [
    description,
    existingWorkflow,
    useExistingWorkflow,
    selectedTemplates,
    mcpClient,
  ]);

  const handleRefine = useCallback(async () => {
    if (!result || !refinementInput.trim()) return;

    setState("refining");
    setError(null);

    try {
      const refined = await mcpClient.refineWorkflow(
        result.workflow,
        refinementInput
      );

      setResult(refined);
      setState("success");
      setRefinementInput("");
    } catch (err) {
      console.error("Refinement failed:", err);
      setError(
        err instanceof Error ? err.message : "Failed to refine workflow"
      );
      setState("success");
    }
  }, [result, refinementInput, mcpClient]);

  const handleAccept = useCallback(() => {
    if (!result) return;

    const workflowToAccept =
      selectedAlternative !== null
        ? result.alternatives?.[selectedAlternative]?.workflow
        : result.workflow;

    if (workflowToAccept) {
      onAccept(workflowToAccept);
      onClose();
    }
  }, [result, selectedAlternative, onAccept, onClose]);

  const handleTemplateSelect = useCallback((template: PromptTemplate) => {
    setSelectedTemplates([template.id]);
    setDescription(template.template);
    setShowExamples(false);
  }, []);

  const toggleTemplate = useCallback((templateId: string) => {
    setSelectedTemplates((prev) =>
      prev.includes(templateId)
        ? prev.filter((t) => t !== templateId)
        : [...prev, templateId]
    );
  }, []);

  const currentWorkflow =
    selectedAlternative !== null
      ? result?.alternatives?.[selectedAlternative]?.workflow
      : result?.workflow;

  const confidence =
    selectedAlternative !== null
      ? result?.alternatives?.[selectedAlternative]?.confidence
      : result?.confidence;

  return {
    description,
    setDescription,
    state,
    result,
    error,
    selectedAlternative,
    setSelectedAlternative,
    refinementInput,
    setRefinementInput,
    showExamples,
    useExistingWorkflow,
    setUseExistingWorkflow,
    selectedTemplates,
    toggleTemplate,
    textAreaRef,
    currentWorkflow,
    confidence,
    handleGenerate,
    handleRefine,
    handleAccept,
    handleTemplateSelect,
  };
}
