import React, { useState, useEffect } from "react";
import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";
import type { LayoutOptions } from "@/services/layout-service";
import type { LayoutPreset } from "../PresetManagerDialog";

interface EditPresetDialogProps {
  preset: LayoutPreset | null;
  onClose: () => void;
  onSave: (updatedPreset: LayoutPreset) => void;
}

export function EditPresetDialog({
  preset,
  onClose,
  onSave,
}: EditPresetDialogProps) {
  const [name, setName] = useState(preset?.name || "");
  const [description, setDescription] = useState(preset?.description || "");
  const [style, setStyle] = useState<LayoutStyle>(
    preset?.style || LayoutStyle.HIERARCHICAL
  );
  const [options, setOptions] = useState<LayoutOptions>(
    preset?.options || {
      nodeWidth: 180,
      nodeHeight: 80,
      horizontalSpacing: 200,
      verticalSpacing: 120,
      branchOffset: 150,
      minNodeSpacing: 20,
    }
  );

  useEffect(() => {
    if (preset) {
      setName(preset.name);
      setDescription(preset.description);
      setStyle(preset.style);
      setOptions(preset.options);
    }
  }, [preset]);

  const handleSave = () => {
    if (!preset || !name.trim()) return;

    const updatedPreset: LayoutPreset = {
      ...preset,
      name: name.trim(),
      description: description.trim(),
      style,
      options,
    };

    onSave(updatedPreset);
  };

  const updateOption = (key: keyof LayoutOptions, value: number) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };

  if (!preset) return null;

  return (
    <div className="edit-preset-overlay">
      <div className="edit-preset-dialog">
        <div className="dialog-header">
          <h3>Edit Preset</h3>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="edit-form">
          <div className="form-group">
            <label htmlFor="preset-name">Name</label>
            <input
              id="preset-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Preset name"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="preset-description">Description</label>
            <textarea
              id="preset-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Preset description"
              className="form-textarea"
              rows={2}
            />
          </div>

          <div className="form-group">
            <label htmlFor="preset-style">Layout Style</label>
            <select
              id="preset-style"
              value={style}
              onChange={(e) => setStyle(e.target.value as LayoutStyle)}
              className="form-select"
            >
              {Object.values(LayoutStyle).map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="form-section">
            <h4>Layout Options</h4>

            <div className="options-grid">
              <div className="form-group">
                <label htmlFor="node-width">Node Width</label>
                <input
                  id="node-width"
                  type="number"
                  value={options.nodeWidth}
                  onChange={(e) =>
                    updateOption("nodeWidth", parseInt(e.target.value) || 180)
                  }
                  min={50}
                  max={500}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="node-height">Node Height</label>
                <input
                  id="node-height"
                  type="number"
                  value={options.nodeHeight}
                  onChange={(e) =>
                    updateOption("nodeHeight", parseInt(e.target.value) || 80)
                  }
                  min={30}
                  max={300}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="h-spacing">Horizontal Spacing</label>
                <input
                  id="h-spacing"
                  type="number"
                  value={options.horizontalSpacing}
                  onChange={(e) =>
                    updateOption(
                      "horizontalSpacing",
                      parseInt(e.target.value) || 200
                    )
                  }
                  min={50}
                  max={500}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="v-spacing">Vertical Spacing</label>
                <input
                  id="v-spacing"
                  type="number"
                  value={options.verticalSpacing}
                  onChange={(e) =>
                    updateOption(
                      "verticalSpacing",
                      parseInt(e.target.value) || 120
                    )
                  }
                  min={50}
                  max={500}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="branch-offset">Branch Offset</label>
                <input
                  id="branch-offset"
                  type="number"
                  value={options.branchOffset}
                  onChange={(e) =>
                    updateOption(
                      "branchOffset",
                      parseInt(e.target.value) || 150
                    )
                  }
                  min={0}
                  max={500}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="min-spacing">Min Node Spacing</label>
                <input
                  id="min-spacing"
                  type="number"
                  value={options.minNodeSpacing}
                  onChange={(e) =>
                    updateOption(
                      "minNodeSpacing",
                      parseInt(e.target.value) || 20
                    )
                  }
                  min={0}
                  max={100}
                  className="form-input"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="dialog-footer">
          <button className="cancel-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="save-button"
            onClick={handleSave}
            disabled={!name.trim()}
          >
            Save Changes
          </button>
        </div>
      </div>

      <style>{`
        .edit-preset-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10001;
        }

        .edit-preset-dialog {
          background: var(--background, #1a1a2e);
          border: 1px solid var(--border, #333);
          border-radius: 8px;
          width: 480px;
          max-height: 80vh;
          overflow-y: auto;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }

        .dialog-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border, #333);
        }

        .dialog-header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--foreground, #fff);
        }

        .close-button {
          background: none;
          border: none;
          color: var(--muted-foreground, #888);
          font-size: 20px;
          cursor: pointer;
          padding: 4px 8px;
        }

        .close-button:hover {
          color: var(--foreground, #fff);
        }

        .edit-form {
          padding: 20px;
        }

        .form-group {
          margin-bottom: 16px;
        }

        .form-group label {
          display: block;
          font-size: 13px;
          font-weight: 500;
          color: var(--muted-foreground, #888);
          margin-bottom: 6px;
        }

        .form-input,
        .form-textarea,
        .form-select {
          width: 100%;
          padding: 8px 12px;
          background: var(--input, #0d0d1a);
          border: 1px solid var(--border, #333);
          border-radius: 6px;
          color: var(--foreground, #fff);
          font-size: 14px;
        }

        .form-input:focus,
        .form-textarea:focus,
        .form-select:focus {
          outline: none;
          border-color: var(--primary, #00d9ff);
        }

        .form-textarea {
          resize: vertical;
          min-height: 60px;
        }

        .form-section {
          margin-top: 20px;
          padding-top: 16px;
          border-top: 1px solid var(--border, #333);
        }

        .form-section h4 {
          margin: 0 0 12px 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--foreground, #fff);
        }

        .options-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .options-grid .form-group {
          margin-bottom: 0;
        }

        .dialog-footer {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          padding: 16px 20px;
          border-top: 1px solid var(--border, #333);
        }

        .cancel-button,
        .save-button {
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .cancel-button {
          background: transparent;
          border: 1px solid var(--border, #333);
          color: var(--muted-foreground, #888);
        }

        .cancel-button:hover {
          background: var(--accent, #252540);
          color: var(--foreground, #fff);
        }

        .save-button {
          background: var(--primary, #00d9ff);
          border: none;
          color: #000;
        }

        .save-button:hover:not(:disabled) {
          background: var(--primary-hover, #00b8d4);
        }

        .save-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
