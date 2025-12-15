/**
 * Preset Manager Dialog
 *
 * Dialog for managing layout presets.
 * Features:
 * - List of all presets (built-in + custom)
 * - Category filter
 * - Search presets
 * - Preview preset
 * - Edit custom presets
 * - Delete custom presets
 * - Export preset
 * - Import preset
 * - Set as default
 */

import React, { useState, useEffect, useCallback } from "react";
import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";
import type { LayoutOptions } from "@/services/layout-service";

// ============================================================================
// Edit Preset Dialog Component
// ============================================================================

interface EditPresetDialogProps {
  preset: LayoutPreset | null;
  onClose: () => void;
  onSave: (updatedPreset: LayoutPreset) => void;
}

function EditPresetDialog({ preset, onClose, onSave }: EditPresetDialogProps) {
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

      <style jsx>{`
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

// ============================================================================
// Types
// ============================================================================

export interface PresetManagerDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectPreset: (preset: LayoutPreset) => void;
}

export interface LayoutPreset {
  id: string;
  name: string;
  description: string;
  category: "compact" | "spacious" | "balanced" | "custom";
  style: LayoutStyle;
  options: LayoutOptions;
  builtin: boolean;
}

// ============================================================================
// Preset Manager Dialog Component
// ============================================================================

export function PresetManagerDialog({
  open,
  onClose,
  onSelectPreset,
}: PresetManagerDialogProps) {
  const [presets, setPresets] = useState<LayoutPreset[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<
    "all" | "compact" | "spacious" | "balanced" | "custom"
  >("all");
  const [selectedPreset, setSelectedPreset] = useState<LayoutPreset | null>(
    null
  );
  const [editingPreset, setEditingPreset] = useState<LayoutPreset | null>(null);

  useEffect(() => {
    if (open) {
      loadPresets();
    }
  }, [open]);

  const loadPresets = () => {
    try {
      const saved = localStorage.getItem("auto-layout-custom-presets");
      const customPresets = saved ? JSON.parse(saved) : [];
      setPresets([...BUILTIN_PRESETS, ...customPresets]);
    } catch (err) {
      console.error("Failed to load presets:", err);
      setPresets([...BUILTIN_PRESETS]);
    }
  };

  const filteredPresets = presets.filter((preset) => {
    if (selectedCategory !== "all" && preset.category !== selectedCategory) {
      return false;
    }
    if (
      searchQuery &&
      !preset.name.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const handleDelete = (presetId: string) => {
    if (!confirm("Delete this preset?")) return;

    const updated = presets.filter((p) => p.id !== presetId && p.builtin);
    const customPresets = updated.filter((p) => !p.builtin);

    try {
      localStorage.setItem(
        "auto-layout-custom-presets",
        JSON.stringify(customPresets)
      );
      setPresets(updated);
    } catch (err) {
      console.error("Failed to delete preset:", err);
    }
  };

  const handleExport = (preset: LayoutPreset) => {
    const json = JSON.stringify(preset, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `layout-preset-${preset.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e: unknown) => {
      const file = e.target?.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const preset = JSON.parse(
            event.target?.result as string
          ) as LayoutPreset;
          preset.id = `custom-${Date.now()}`;
          preset.builtin = false;
          preset.category = "custom";

          const customPresets = presets.filter((p) => !p.builtin);
          customPresets.push(preset);

          localStorage.setItem(
            "auto-layout-custom-presets",
            JSON.stringify(customPresets)
          );
          loadPresets();
        } catch (err) {
          alert("Failed to import preset: Invalid file format");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleSaveEdit = useCallback(
    (updatedPreset: LayoutPreset) => {
      try {
        // Update preset in the list
        const updatedPresets = presets.map((p) =>
          p.id === updatedPreset.id ? updatedPreset : p
        );

        // Save custom presets to localStorage
        const customPresets = updatedPresets.filter((p) => !p.builtin);
        localStorage.setItem(
          "auto-layout-custom-presets",
          JSON.stringify(customPresets)
        );

        setPresets(updatedPresets);
        setEditingPreset(null);

        // Update selected preset if it was the one being edited
        if (selectedPreset?.id === updatedPreset.id) {
          setSelectedPreset(updatedPreset);
        }
      } catch (err) {
        console.error("Failed to save preset:", err);
        alert("Failed to save preset changes");
      }
    },
    [presets, selectedPreset]
  );

  if (!open) return null;

  return (
    <div className="preset-manager-overlay">
      <div className="preset-manager-dialog">
        <div className="dialog-header">
          <h2>Manage Layout Presets</h2>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="dialog-toolbar">
          <input
            type="text"
            placeholder="Search presets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <button className="import-button" onClick={handleImport}>
            📥 Import
          </button>
        </div>

        <div className="category-filter">
          {(["all", "compact", "spacious", "balanced", "custom"] as const).map(
            (cat) => (
              <button
                key={cat}
                className={selectedCategory === cat ? "active" : ""}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            )
          )}
        </div>

        <div className="presets-list">
          {filteredPresets.map((preset) => (
            <div
              key={preset.id}
              className={`preset-item ${selectedPreset?.id === preset.id ? "selected" : ""}`}
              onClick={() => setSelectedPreset(preset)}
            >
              <div className="preset-info">
                <h4>{preset.name}</h4>
                <p>{preset.description}</p>
                <div className="preset-meta">
                  <span className={`category-badge ${preset.category}`}>
                    {preset.category}
                  </span>
                  <span className="style-badge">{preset.style}</span>
                  {preset.builtin && (
                    <span className="builtin-badge">Built-in</span>
                  )}
                </div>
              </div>

              <div className="preset-actions">
                <button
                  className="use-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectPreset(preset);
                    onClose();
                  }}
                >
                  Use
                </button>
                <button
                  className="export-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExport(preset);
                  }}
                >
                  📤
                </button>
                {!preset.builtin && (
                  <>
                    <button
                      className="edit-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingPreset(preset);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="delete-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(preset.id);
                      }}
                    >
                      🗑️
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {filteredPresets.length === 0 && (
          <div className="no-presets">
            <p>No presets found</p>
          </div>
        )}
      </div>

      {/* Edit Preset Dialog */}
      {editingPreset && (
        <EditPresetDialog
          preset={editingPreset}
          onClose={() => setEditingPreset(null)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}

// ============================================================================
// Built-in Presets (simplified)
// ============================================================================

const BUILTIN_PRESETS: LayoutPreset[] = [
  {
    id: "balanced-hierarchical",
    name: "Balanced Hierarchical",
    description: "Standard top-to-bottom layout",
    category: "balanced",
    style: LayoutStyle.HIERARCHICAL,
    options: {
      nodeWidth: 180,
      nodeHeight: 80,
      horizontalSpacing: 200,
      verticalSpacing: 120,
      branchOffset: 150,
      minNodeSpacing: 20,
    },
    builtin: true,
  },
];
