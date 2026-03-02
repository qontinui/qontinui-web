import React from "react";
import type { LayoutPreset } from "../PresetManagerDialog";

interface PresetItemProps {
  preset: LayoutPreset;
  isSelected: boolean;
  onSelect: (preset: LayoutPreset) => void;
  onUse: (preset: LayoutPreset) => void;
  onExport: (preset: LayoutPreset) => void;
  onEdit: (preset: LayoutPreset) => void;
  onDelete: (presetId: string) => void;
}

export function PresetItem({
  preset,
  isSelected,
  onSelect,
  onUse,
  onExport,
  onEdit,
  onDelete,
}: PresetItemProps) {
  return (
    <div
      className={`preset-item ${isSelected ? "selected" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(preset)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(preset);
        }
      }}
    >
      <div className="preset-info">
        <h4>{preset.name}</h4>
        <p>{preset.description}</p>
        <div className="preset-meta">
          <span className={`category-badge ${preset.category}`}>
            {preset.category}
          </span>
          <span className="style-badge">{preset.style}</span>
          {preset.builtin && <span className="builtin-badge">Built-in</span>}
        </div>
      </div>

      <div className="preset-actions">
        <button
          className="use-button"
          onClick={(e) => {
            e.stopPropagation();
            onUse(preset);
          }}
        >
          Use
        </button>
        <button
          className="export-button"
          onClick={(e) => {
            e.stopPropagation();
            onExport(preset);
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
                onEdit(preset);
              }}
            >
              ✎
            </button>
            <button
              className="delete-button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(preset.id);
              }}
            >
              🗑️
            </button>
          </>
        )}
      </div>
    </div>
  );
}
