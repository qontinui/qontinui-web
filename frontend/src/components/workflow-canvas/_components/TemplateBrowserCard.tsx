import React from "react";
import type { TemplateCardProps } from "../TemplateBrowser.types";
import { WorkflowPreview } from "./WorkflowPreview";

export function TemplateBrowserCard({
  template,
  onUse,
  onShowDetails,
}: TemplateCardProps) {
  return (
    <div
      className="template-card"
      role="button"
      tabIndex={0}
      onClick={onShowDetails}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onShowDetails();
        }
      }}
    >
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

      <div className="template-info">
        <h3>{template.name}</h3>
        <p className="description">{template.description}</p>

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
