/**
 * Publish Template Dialog Component
 *
 * Dialog for publishing a workflow to the marketplace.
 * Allows users to:
 * - Set name, description, and long description
 * - Select a category
 * - Add tags
 * - Choose a license
 * - Preview before publishing
 */

import { useState, useEffect, useCallback } from 'react';
import type { Workflow } from "@/lib/action-schema/action-types";
import { workflowTemplates } from "@/services/workflow-templates";
import type { TemplateCategory as MarketplaceCategory } from "@/types/workflow-templates";

// ============================================================================
// Types
// ============================================================================

export interface PublishTemplateDialogProps {
  workflow: Workflow;
  onClose: () => void;
  onPublished?: (templateId: number) => void;
}

// ============================================================================
// Publish Template Dialog Component
// ============================================================================

export function PublishTemplateDialog({
  workflow,
  onClose,
  onPublished,
}: PublishTemplateDialogProps) {
  // Form state
  const [name, setName] = useState(workflow.name || "");
  const [description, setDescription] = useState(
    workflow.metadata?.description || ""
  );
  const [longDescription, setLongDescription] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [tagsInput, setTagsInput] = useState("");
  const [license, setLicense] = useState("MIT");

  // UI state
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "preview" | "publishing">("form");

  const loadCategories = useCallback(async () => {
    try {
      const cats = await workflowTemplates.getMarketplaceCategories();
      setCategories(cats);
      if (cats.length > 0 && !categoryId) {
        setCategoryId(cats[0]!.id);
      }
    } catch (err) {
      console.error("Failed to load categories:", err);
    }
  }, [categoryId]);

  // Load categories on mount
  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  // Parse tags from input
  const parseTags = (): string[] => {
    return tagsInput
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
  };

  // Validate form
  const validateForm = (): string | null => {
    if (!name || name.length < 3) {
      return "Name must be at least 3 characters";
    }
    if (!description || description.length < 10) {
      return "Description must be at least 10 characters";
    }
    if (description.length > 500) {
      return "Description must be less than 500 characters";
    }
    if (longDescription && longDescription.length > 10000) {
      return "Long description must be less than 10,000 characters";
    }
    const tags = parseTags();
    if (tags.length > 10) {
      return "Maximum 10 tags allowed";
    }
    return null;
  };

  // Handle preview
  const handlePreview = () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setStep("preview");
  };

  // Handle publish
  const handlePublish = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);
    setStep("publishing");

    try {
      const template = await workflowTemplates.publishToMarketplace(workflow, {
        name,
        description,
        long_description: longDescription || undefined,
        category_id: categoryId || undefined,
        tags: parseTags(),
        license: license || undefined,
      });

      if (onPublished) {
        onPublished(template.id);
      }
      onClose();
    } catch (err) {
      console.error("Failed to publish template:", err);
      setError(err instanceof Error ? err.message : "Failed to publish template");
      setStep("form");
    } finally {
      setLoading(false);
    }
  };

  // Handle save as draft
  const handleSaveAsDraft = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await workflowTemplates.saveToMarketplaceDraft(workflow, {
        name,
        description,
        long_description: longDescription || undefined,
        category_id: categoryId || undefined,
        tags: parseTags(),
        license: license || undefined,
      });
      onClose();
    } catch (err) {
      console.error("Failed to save draft:", err);
      setError(err instanceof Error ? err.message : "Failed to save draft");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="publish-template-overlay">
      <div className="publish-template-dialog">
        <div className="dialog-header">
          <h2>
            {step === "preview"
              ? "Preview Template"
              : step === "publishing"
              ? "Publishing..."
              : "Publish to Marketplace"}
          </h2>
          <button
            className="close-button"
            onClick={onClose}
            disabled={loading}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {step === "form" && (
          <div className="dialog-content">
            {error && <div className="error-message">{error}</div>}

            <div className="form-group">
              <label htmlFor="template-name">Template Name *</label>
              <input
                id="template-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Awesome Template"
                maxLength={200}
              />
              <span className="char-count">{name.length}/200</span>
            </div>

            <div className="form-group">
              <label htmlFor="template-description">Short Description *</label>
              <textarea
                id="template-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A brief description of what this template does..."
                rows={2}
                maxLength={500}
              />
              <span className="char-count">{description.length}/500</span>
            </div>

            <div className="form-group">
              <label htmlFor="template-long-description">
                Long Description (optional)
              </label>
              <textarea
                id="template-long-description"
                value={longDescription}
                onChange={(e) => setLongDescription(e.target.value)}
                placeholder="Detailed description, usage instructions, examples..."
                rows={5}
                maxLength={10000}
              />
              <span className="char-count">{longDescription.length}/10000</span>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="template-category">Category</label>
                <select
                  id="template-category"
                  value={categoryId || ""}
                  onChange={(e) =>
                    setCategoryId(e.target.value ? Number(e.target.value) : null)
                  }
                >
                  <option value="">Select a category...</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="template-license">License</label>
                <select
                  id="template-license"
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                >
                  <option value="MIT">MIT</option>
                  <option value="Apache-2.0">Apache 2.0</option>
                  <option value="GPL-3.0">GPL 3.0</option>
                  <option value="BSD-3-Clause">BSD 3-Clause</option>
                  <option value="CC-BY-4.0">CC BY 4.0</option>
                  <option value="CC0">CC0 (Public Domain)</option>
                  <option value="Proprietary">Proprietary</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="template-tags">Tags (comma-separated)</label>
              <input
                id="template-tags"
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="automation, data, api, etc."
              />
              <span className="hint">Maximum 10 tags</span>
            </div>

            <div className="template-info-box">
              <h4>Template Info</h4>
              <p>
                <strong>Actions:</strong> {workflow.actions.length}
              </p>
              <p>
                <strong>Format:</strong> {workflow.format || "graph"}
              </p>
              {workflow.version && (
                <p>
                  <strong>Version:</strong> {workflow.version}
                </p>
              )}
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="dialog-content">
            <div className="preview-section">
              <h3>{name}</h3>
              <p className="preview-description">{description}</p>

              {longDescription && (
                <div className="preview-long-description">
                  <h4>Details</h4>
                  <p>{longDescription}</p>
                </div>
              )}

              <div className="preview-meta">
                {categoryId && (
                  <span className="meta-item">
                    <strong>Category:</strong>{" "}
                    {categories.find((c) => c.id === categoryId)?.name}
                  </span>
                )}
                <span className="meta-item">
                  <strong>License:</strong> {license}
                </span>
                <span className="meta-item">
                  <strong>Actions:</strong> {workflow.actions.length}
                </span>
              </div>

              {parseTags().length > 0 && (
                <div className="preview-tags">
                  {parseTags().map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {step === "publishing" && (
          <div className="dialog-content publishing-state">
            <div className="spinner" />
            <p>Publishing your template to the marketplace...</p>
          </div>
        )}

        <div className="dialog-footer">
          {step === "form" && (
            <>
              <button
                className="cancel-button"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="secondary-button"
                onClick={handleSaveAsDraft}
                disabled={loading}
              >
                Save as Draft
              </button>
              <button
                className="primary-button"
                onClick={handlePreview}
                disabled={loading}
              >
                Preview
              </button>
            </>
          )}

          {step === "preview" && (
            <>
              <button
                className="cancel-button"
                onClick={() => setStep("form")}
                disabled={loading}
              >
                Back
              </button>
              <button
                className="primary-button"
                onClick={handlePublish}
                disabled={loading}
              >
                Publish Now
              </button>
            </>
          )}

          {step === "publishing" && (
            <button className="cancel-button" disabled>
              Please wait...
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default PublishTemplateDialog;
