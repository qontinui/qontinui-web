import { useState, useMemo, useCallback } from "react";
import type { Workflow } from "../../../lib/action-schema/action-types";
import {
  workflowTemplates,
  type WorkflowTemplate,
  type TemplateCategory,
  type TemplateFilter,
} from "../../../services/workflow-templates";
import type { CategoryCounts } from "../TemplateBrowser.types";

export function useTemplateBrowser(
  onSelectTemplate: (workflow: Workflow, template: WorkflowTemplate) => void,
  currentWorkflow?: Workflow
) {
  const [selectedCategory, setSelectedCategory] = useState<
    TemplateCategory | "all"
  >("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTemplate, setSelectedTemplate] =
    useState<WorkflowTemplate | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const templates = useMemo(() => {
    const filter: TemplateFilter = {
      category: selectedCategory === "all" ? undefined : selectedCategory,
      search: searchQuery || undefined,
    };
    return workflowTemplates.getTemplates(filter);
  }, [selectedCategory, searchQuery]);

  const categoryCounts: CategoryCounts = useMemo(() => {
    const allTemplates = workflowTemplates.getTemplates();
    return {
      all: allTemplates.length,
      basic: allTemplates.filter((t) => t.category === "basic").length,
      "control-flow": allTemplates.filter((t) => t.category === "control-flow")
        .length,
      "data-processing": allTemplates.filter(
        (t) => t.category === "data-processing"
      ).length,
      automation: allTemplates.filter((t) => t.category === "automation")
        .length,
      advanced: allTemplates.filter((t) => t.category === "advanced").length,
      custom: allTemplates.filter((t) => t.category === "custom").length,
    };
  }, []);

  const handleUseTemplate = useCallback(
    (template: WorkflowTemplate) => {
      const workflow = workflowTemplates.createFromTemplate(template.id);
      if (workflow) {
        onSelectTemplate(workflow, template);
      }
    },
    [onSelectTemplate]
  );

  const handleSaveAsTemplate = useCallback(() => {
    if (!currentWorkflow) return;
    setShowSaveDialog(true);
  }, [currentWorkflow]);

  const handleSaveTemplate = useCallback(
    (
      name: string,
      description: string,
      category: TemplateCategory,
      tags: string[]
    ) => {
      if (!currentWorkflow) return;
      workflowTemplates.saveAsTemplate(
        currentWorkflow,
        name,
        description,
        category,
        tags
      );
      setShowSaveDialog(false);
    },
    [currentWorkflow]
  );

  const handleShowDetails = useCallback((template: WorkflowTemplate) => {
    setSelectedTemplate(template);
    setShowDetails(true);
  }, []);

  const handleCloseDetails = useCallback(() => {
    setShowDetails(false);
  }, []);

  const handleCloseSaveDialog = useCallback(() => {
    setShowSaveDialog(false);
  }, []);

  return {
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    selectedTemplate,
    showDetails,
    showSaveDialog,
    templates,
    categoryCounts,
    handleUseTemplate,
    handleSaveAsTemplate,
    handleSaveTemplate,
    handleShowDetails,
    handleCloseDetails,
    handleCloseSaveDialog,
  };
}
