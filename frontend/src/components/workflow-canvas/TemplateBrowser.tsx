/**
 * Template Browser Component
 *
 * Browse and select workflow templates.
 * Features:
 * - Category tabs (Basic, Control Flow, Automation, Data)
 * - Search bar with filters
 * - Grid of template cards
 * - Template preview on hover
 * - Template details dialog
 * - Use Template button
 * - Save custom template
 * - Import/Export templates
 */

import React, { useState, useMemo } from "react";
import type { Workflow } from "@/lib/action-schema/action-types";
import {
  workflowTemplates,
  type WorkflowTemplate,
  type TemplateCategory,
  type TemplateFilter,
} from "@/services/workflow-templates";

// ============================================================================
// Types
// ============================================================================

export interface TemplateBrowserProps {
  onSelectTemplate: (workflow: Workflow, template: WorkflowTemplate) => void;
  onClose?: () => void;
  currentWorkflow?: Workflow;
}

// ============================================================================
// Template Browser Component
// ============================================================================

export function TemplateBrowser({
  onSelectTemplate,
  onClose,
  currentWorkflow,
}: TemplateBrowserProps) {
  const [selectedCategory, setSelectedCategory] = useState<
    TemplateCategory | "all"
  >("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTemplate, setSelectedTemplate] =
    useState<WorkflowTemplate | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Get templates with filters
  const templates = useMemo(() => {
    const filter: TemplateFilter = {
      category: selectedCategory === "all" ? undefined : selectedCategory,
      search: searchQuery || undefined,
    };
    return workflowTemplates.getTemplates(filter);
  }, [selectedCategory, searchQuery]);

  // Category counts
  const categoryCounts = useMemo(() => {
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

  const handleUseTemplate = (template: WorkflowTemplate) => {
    const workflow = workflowTemplates.createFromTemplate(template.id);
    if (workflow) {
      onSelectTemplate(workflow, template);
    }
  };

  const handleSaveAsTemplate = () => {
    if (!currentWorkflow) return;
    setShowSaveDialog(true);
  };

  const handleSaveTemplate = (
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
  };

  return (
    <div className="template-browser">
      {/* Header */}
      <div className="browser-header">
        <h2>Workflow Templates</h2>
        {onClose && (
          <button className="close-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>

      {/* Search and Actions */}
      <div className="browser-toolbar">
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="toolbar-actions">
          {currentWorkflow && (
            <button
              className="save-template-button"
              onClick={handleSaveAsTemplate}
            >
              💾 Save as Template
            </button>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="category-tabs">
        <button
          className={selectedCategory === "all" ? "active" : ""}
          onClick={() => setSelectedCategory("all")}
        >
          All ({categoryCounts.all})
        </button>
        <button
          className={selectedCategory === "basic" ? "active" : ""}
          onClick={() => setSelectedCategory("basic")}
        >
          Basic ({categoryCounts.basic})
        </button>
        <button
          className={selectedCategory === "control-flow" ? "active" : ""}
          onClick={() => setSelectedCategory("control-flow")}
        >
          Control Flow ({categoryCounts["control-flow"]})
        </button>
        <button
          className={selectedCategory === "data-processing" ? "active" : ""}
          onClick={() => setSelectedCategory("data-processing")}
        >
          Data ({categoryCounts["data-processing"]})
        </button>
        <button
          className={selectedCategory === "automation" ? "active" : ""}
          onClick={() => setSelectedCategory("automation")}
        >
          Automation ({categoryCounts.automation})
        </button>
        {categoryCounts.custom > 0 && (
          <button
            className={selectedCategory === "custom" ? "active" : ""}
            onClick={() => setSelectedCategory("custom")}
          >
            Custom ({categoryCounts.custom})
          </button>
        )}
      </div>

      {/* Template Grid */}
      <div className="template-grid">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onUse={() => handleUseTemplate(template)}
            onShowDetails={() => {
              setSelectedTemplate(template);
              setShowDetails(true);
            }}
          />
        ))}
      </div>

      {templates.length === 0 && (
        <div className="no-templates">
          <p>No templates found</p>
          {searchQuery && <p className="hint">Try a different search term</p>}
        </div>
      )}

      {/* Template Details Dialog */}
      {showDetails && selectedTemplate && (
        <TemplateDetailsDialog
          template={selectedTemplate}
          onClose={() => setShowDetails(false)}
          onUse={() => {
            handleUseTemplate(selectedTemplate);
            setShowDetails(false);
          }}
        />
      )}

      {/* Save Template Dialog */}
      {showSaveDialog && (
        <SaveTemplateDialog
          onSave={handleSaveTemplate}
          onClose={() => setShowSaveDialog(false)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Template Card Component
// ============================================================================

interface TemplateCardProps {
  template: WorkflowTemplate;
  onUse: () => void;
  onShowDetails: () => void;
}

function TemplateCard({ template, onUse, onShowDetails }: TemplateCardProps) {
  return (
    <div className="template-card" onClick={onShowDetails}>
      {/* Thumbnail */}
      <div className="template-thumbnail">
        {template.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={template.thumbnail} alt={template.name} />
        ) : (
          <div className="thumbnail-placeholder">
            <WorkflowPreview workflow={template.workflow} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="template-info">
        <h3>{template.name}</h3>
        <p className="description">{template.description}</p>

        {/* Badges */}
        <div className="template-badges">
          <span className={`category-badge category-${template.category}`}>
            {template.category.replace("-", " ")}
          </span>
          <span className="action-count-badge">
            {template.workflow.actions.length} action
            {template.workflow.actions.length > 1 ? "s" : ""}
          </span>
          {template.builtin && <span className="builtin-badge">Built-in</span>}
        </div>

        {/* Tags */}
        {template.tags.length > 0 && (
          <div className="template-tags">
            {template.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="tag">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action Button */}
      <button
        className="use-button"
        onClick={(e) => {
          e.stopPropagation();
          onUse();
        }}
      >
        Use Template
      </button>
    </div>
  );
}

// ============================================================================
// Template Details Dialog
// ============================================================================

interface TemplateDetailsDialogProps {
  template: WorkflowTemplate;
  onClose: () => void;
  onUse: () => void;
}

function TemplateDetailsDialog({
  template,
  onClose,
  onUse,
}: TemplateDetailsDialogProps) {
  return (
    <div className="template-details-overlay">
      <div className="template-details-dialog">
        <div className="dialog-header">
          <h2>{template.name}</h2>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="dialog-content">
          {/* Preview */}
          <div className="template-preview-large">
            <WorkflowPreview workflow={template.workflow} large />
          </div>

          {/* Description */}
          <div className="template-description">
            <h3>Description</h3>
            <p>{template.description}</p>
          </div>

          {/* Details */}
          <div className="template-details-grid">
            <div className="detail-item">
              <strong>Category:</strong>
              <span>{template.category.replace("-", " ")}</span>
            </div>
            <div className="detail-item">
              <strong>Actions:</strong>
              <span>{template.workflow.actions.length}</span>
            </div>
            <div className="detail-item">
              <strong>Type:</strong>
              <span>{template.builtin ? "Built-in" : "Custom"}</span>
            </div>
          </div>

          {/* Tags */}
          {template.tags.length > 0 && (
            <div className="template-tags-section">
              <h3>Tags</h3>
              <div className="tags-list">
                {template.tags.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Actions List */}
          <div className="actions-list-section">
            <h3>Actions</h3>
            <ul className="actions-list">
              {template.workflow.actions.map((action, i) => (
                <li key={i}>
                  <span className="action-number">{i + 1}.</span>
                  <span className="action-type">{action.type}</span>
                  {action.name && (
                    <span className="action-name">- {action.name}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="dialog-footer">
          <button className="cancel-button" onClick={onClose}>
            Cancel
          </button>
          <button className="use-button" onClick={onUse}>
            Use Template
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Save Template Dialog
// ============================================================================

interface SaveTemplateDialogProps {
  onSave: (
    name: string,
    description: string,
    category: TemplateCategory,
    tags: string[]
  ) => void;
  onClose: () => void;
}

function SaveTemplateDialog({ onSave, onClose }: SaveTemplateDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TemplateCategory>("custom");
  const [tagsInput, setTagsInput] = useState("");

  const handleSave = () => {
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t);
    onSave(name, description, category, tags);
  };

  return (
    <div className="save-template-overlay">
      <div className="save-template-dialog">
        <div className="dialog-header">
          <h2>Save as Template</h2>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="dialog-content">
          <div className="form-group">
            <label>Template Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Custom Template"
            />
          </div>

          <div className="form-group">
            <label>Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this template does..."
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as TemplateCategory)}
            >
              <option value="custom">Custom</option>
              <option value="basic">Basic</option>
              <option value="control-flow">Control Flow</option>
              <option value="data-processing">Data Processing</option>
              <option value="automation">Automation</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>

          <div className="form-group">
            <label>Tags (comma-separated)</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="tag1, tag2, tag3"
            />
          </div>
        </div>

        <div className="dialog-footer">
          <button className="cancel-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="save-button"
            onClick={handleSave}
            disabled={!name || !description}
          >
            Save Template
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Workflow Preview Component
// ============================================================================

interface WorkflowPreviewProps {
  workflow: Workflow;
  large?: boolean;
}

function WorkflowPreview({ workflow, large = false }: WorkflowPreviewProps) {
  const size = large ? 400 : 150;
  const nodeSize = large ? 60 : 20;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="workflow-preview-svg"
    >
      {/* Draw connections */}
      <g className="connections">
        {Object.entries(workflow.connections).map(
          ([sourceId, connections], i) => {
            const source = workflow.actions.find((a) => a.id === sourceId);
            if (!source?.position) return null;

            return connections.main?.map((conns, j) =>
              conns.map((conn, k) => {
                const target = workflow.actions.find(
                  (a) => a.id === conn.action
                );
                if (!target?.position) return null;

                const scale = size / 800;
                const x1 = source.position[0] * scale + nodeSize / 2;
                const y1 = source.position[1] * scale + nodeSize / 2;
                const x2 = target.position[0] * scale + nodeSize / 2;
                const y2 = target.position[1] * scale + nodeSize / 2;

                return (
                  <line
                    key={`${i}-${j}-${k}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="currentColor"
                    strokeWidth={large ? 2 : 1}
                    opacity={0.3}
                  />
                );
              })
            );
          }
        )}
      </g>

      {/* Draw nodes */}
      <g className="nodes">
        {workflow.actions.map((action, i) => {
          if (!action.position) return null;
          const scale = size / 800;
          const x = action.position[0] * scale;
          const y = action.position[1] * scale;

          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={nodeSize}
              height={nodeSize}
              fill="currentColor"
              opacity={0.7}
              rx={large ? 4 : 2}
            />
          );
        })}
      </g>
    </svg>
  );
}
