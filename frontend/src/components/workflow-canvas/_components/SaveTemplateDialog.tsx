import React, { useState } from "react";
import type { TemplateCategory } from "../../../services/workflow-templates";
import type { SaveTemplateDialogProps } from "../TemplateBrowser.types";

export function SaveTemplateDialog({
  onSave,
  onClose,
}: SaveTemplateDialogProps) {
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
            <label htmlFor="tb-template-name">Template Name *</label>
            <input
              id="tb-template-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Custom Template"
            />
          </div>

          <div className="form-group">
            <label htmlFor="tb-description">Description *</label>
            <textarea
              id="tb-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this template does..."
              rows={3}
            />
          </div>

          <div className="form-group">
            <label htmlFor="tb-category">Category</label>
            <select
              id="tb-category"
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
            <label htmlFor="tb-tags">Tags (comma-separated)</label>
            <input
              id="tb-tags"
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
