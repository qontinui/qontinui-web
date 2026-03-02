import { useState, useCallback } from "react";
import { Workflow } from "../../../lib/action-schema/action-types";
import {
  workflowTemplates,
  WorkflowTemplate,
} from "../../../services/workflow-templates";
import type { TemplateCategory } from "../../../services/workflow-templates";

export function useTemplateDialog(
  onSelect: (workflow: Workflow) => void,
  onClose: () => void
) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const templates = workflowTemplates.getTemplates({
    search: searchQuery,
    category:
      selectedCategory === "all"
        ? undefined
        : (selectedCategory as TemplateCategory),
  });

  const categories = ["all", ...workflowTemplates.getCategories()];

  const handleSelectTemplate = useCallback(
    (template: WorkflowTemplate) => {
      const workflow = workflowTemplates.createFromTemplate(template.id);
      if (workflow) {
        onSelect(workflow);
        onClose();
      }
    },
    [onSelect, onClose]
  );

  return {
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    templates,
    categories,
    handleSelectTemplate,
  };
}
