import React from "react";
import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";
import type { LayoutOptions } from "@/services/layout-service";
import { usePresetManager } from "./_hooks/use-preset-manager";
import { EditPresetDialog } from "./_components/EditPresetDialog";
import { PresetItem } from "./_components/PresetItem";

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
  const {
    filteredPresets,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    selectedPreset,
    setSelectedPreset,
    editingPreset,
    setEditingPreset,
    handleDelete,
    handleExport,
    handleImport,
    handleSaveEdit,
  } = usePresetManager(open);

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
            <PresetItem
              key={preset.id}
              preset={preset}
              isSelected={selectedPreset?.id === preset.id}
              onSelect={setSelectedPreset}
              onUse={(p) => {
                onSelectPreset(p);
                onClose();
              }}
              onExport={handleExport}
              onEdit={setEditingPreset}
              onDelete={handleDelete}
            />
          ))}
        </div>

        {filteredPresets.length === 0 && (
          <div className="no-presets">
            <p>No presets found</p>
          </div>
        )}
      </div>

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
