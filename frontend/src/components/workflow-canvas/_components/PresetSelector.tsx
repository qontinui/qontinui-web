import React from "react";
import type { LayoutPreset } from "../auto-layout-types";

interface PresetSelectorProps {
  allPresets: LayoutPreset[];
  customPresets: LayoutPreset[];
  selectedPreset: string;
  onPresetChange: (presetId: string) => void;
}

export function PresetSelector({
  allPresets,
  customPresets,
  selectedPreset,
  onPresetChange,
}: PresetSelectorProps) {
  return (
    <section className="preset-selection">
      <h3>Presets</h3>
      <select
        className="preset-dropdown"
        value={selectedPreset}
        onChange={(e) => onPresetChange(e.target.value)}
      >
        <option value="custom">Custom Settings</option>
        <optgroup label="Compact">
          {allPresets
            .filter((p) => p.category === "compact")
            .map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
        </optgroup>
        <optgroup label="Balanced">
          {allPresets
            .filter((p) => p.category === "balanced")
            .map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
        </optgroup>
        <optgroup label="Spacious">
          {allPresets
            .filter((p) => p.category === "spacious")
            .map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
        </optgroup>
        {customPresets.length > 0 && (
          <optgroup label="Custom">
            {customPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {selectedPreset !== "custom" && (
        <p className="preset-description">
          {allPresets.find((p) => p.id === selectedPreset)?.description}
        </p>
      )}
    </section>
  );
}
