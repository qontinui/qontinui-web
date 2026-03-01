import { useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { runnerApi, usePromptsDetailed } from "@/lib/runner-api";
import type { WorkflowGenerationTemplate } from "@/lib/workflow-generation-templates";

export interface TemplatesState {
  showTemplates: boolean;
  setShowTemplates: (value: boolean) => void;
  isSavingTemplate: boolean;
  generationPrompts: Array<{
    id: string;
    name: string;
    content: string;
    category?: string;
  }>;
  handleApplyTemplate: (
    template: WorkflowGenerationTemplate,
    setDescription: (value: string) => void,
    setDiscoveryMode: (value: "auto" | "enabled" | "disabled") => void,
    setCategory: (value: string) => void,
    setTagsInput: (value: string) => void,
    setShowAdvanced: (value: boolean) => void,
    setIncludeDesignGuidance: (value: boolean) => void
  ) => void;
  handleSaveAsTemplate: (description: string) => Promise<void>;
  handleDeleteSavedTemplate: (id: string, e: React.MouseEvent) => Promise<void>;
}

export function useTemplates(): TemplatesState {
  const [showTemplates, setShowTemplates] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Saved prompts (generation category)
  const { data: savedPrompts, refetch: refetchPrompts } = usePromptsDetailed();
  const generationPrompts = useMemo(
    () => (savedPrompts || []).filter((p) => p.category === "Generation"),
    [savedPrompts]
  );

  const handleApplyTemplate = useCallback(
    (
      template: WorkflowGenerationTemplate,
      setDescription: (value: string) => void,
      setDiscoveryMode: (value: "auto" | "enabled" | "disabled") => void,
      setCategory: (value: string) => void,
      setTagsInput: (value: string) => void,
      setShowAdvanced: (value: boolean) => void,
      setIncludeDesignGuidance: (value: boolean) => void
    ) => {
      setDescription(template.content);
      if (template.advancedDefaults) {
        const d = template.advancedDefaults;
        if (d.discoveryMode) setDiscoveryMode(d.discoveryMode);
        if (d.category) setCategory(d.category);
        if (d.tags) setTagsInput(d.tags);
        if (d.includeDesignGuidance !== undefined)
          setIncludeDesignGuidance(d.includeDesignGuidance);
        setShowAdvanced(true);
      }
      setShowTemplates(false);
    },
    []
  );

  const handleSaveAsTemplate = useCallback(
    async (description: string) => {
      const trimmed = description.trim();
      if (!trimmed) return;
      setIsSavingTemplate(true);
      try {
        const name =
          trimmed.length > 60 ? trimmed.substring(0, 57) + "..." : trimmed;
        await runnerApi.createPrompt({
          name,
          content: trimmed,
          category: "Generation",
          description: "",
          tags: ["user-template"],
        });
        refetchPrompts();
        toast.success("Template saved");
      } catch {
        toast.error("Failed to save template");
      } finally {
        setIsSavingTemplate(false);
      }
    },
    [refetchPrompts]
  );

  const handleDeleteSavedTemplate = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await runnerApi.deletePrompt(id);
        refetchPrompts();
      } catch {
        toast.error("Failed to delete template");
      }
    },
    [refetchPrompts]
  );

  return {
    showTemplates,
    setShowTemplates,
    isSavingTemplate,
    generationPrompts,
    handleApplyTemplate,
    handleSaveAsTemplate,
    handleDeleteSavedTemplate,
  };
}
