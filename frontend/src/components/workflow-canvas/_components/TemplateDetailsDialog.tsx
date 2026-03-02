import React from "react";
import type { TemplateDetailsDialogProps } from "../TemplateBrowser.types";
import { WorkflowPreview } from "./WorkflowPreview";

export function TemplateDetailsDialog({
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
          <div className="template-preview-large">
            <WorkflowPreview workflow={template.workflow} large />
          </div>

          <div className="template-description">
            <h3>Description</h3>
            <p>{template.description}</p>
          </div>

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
