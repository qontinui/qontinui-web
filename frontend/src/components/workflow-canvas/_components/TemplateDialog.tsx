import React from "react";
import { Workflow } from "../../../lib/action-schema/action-types";
import { WorkflowTemplate } from "../../../services/workflow-templates";
import { useTemplateDialog } from "../_hooks/use-template-dialog";

interface TemplateDialogProps {
  onSelect: (workflow: Workflow) => void;
  onClose: () => void;
  open: boolean;
}

function TemplateCard({
  template,
  onSelect,
}: {
  template: WorkflowTemplate;
  onSelect: (template: WorkflowTemplate) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(template)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(template);
        }
      }}
      className="border border-border-default bg-surface-canvas rounded-lg p-4 hover:border-brand-primary hover:shadow-md cursor-pointer transition"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-lg text-white">{template.name}</h3>
        {template.builtin && (
          <span className="text-xs bg-brand-primary/20 text-brand-primary border border-brand-primary/50 px-2 py-1 rounded">
            Built-in
          </span>
        )}
      </div>
      <p className="text-sm text-text-muted mb-3">{template.description}</p>
      <div className="flex flex-wrap gap-1">
        {template.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="text-xs bg-surface-raised text-text-muted px-2 py-1 rounded"
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

export function TemplateDialog({
  onSelect,
  onClose,
  open,
}: TemplateDialogProps) {
  const {
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    templates,
    categories,
    handleSelectTemplate,
  } = useTemplateDialog(onSelect, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-surface-canvas border border-border-subtle rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-border-subtle">
          <h2 className="text-2xl font-bold mb-4 text-white">
            Choose a Template
          </h2>

          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            className="w-full bg-surface-canvas border border-border-default text-white rounded-md px-3 py-2 mb-4 focus:border-brand-primary focus:ring-1 focus:ring-brand-primary placeholder:text-text-muted"
          />

          <div className="flex space-x-2 overflow-x-auto">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-2 rounded-md whitespace-nowrap text-sm font-medium ${selectedCategory === category ? "bg-brand-primary text-black" : "bg-surface-raised text-text-secondary hover:bg-surface-raised/80"}`}
              >
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onSelect={handleSelectTemplate}
              />
            ))}
          </div>

          {templates.length === 0 && (
            <div className="text-center text-text-muted py-12">
              <p>No templates found</p>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-border-subtle flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border-default text-text-secondary rounded-md hover:bg-surface-raised"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
