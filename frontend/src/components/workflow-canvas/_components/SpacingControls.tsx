import React from "react";
import type { LayoutOptions } from "@/services/layout-service";

interface SpacingControlsProps {
  options: LayoutOptions;
  onOptionChange: (key: keyof LayoutOptions, value: number) => void;
}

export function SpacingControls({
  options,
  onOptionChange,
}: SpacingControlsProps) {
  return (
    <section className="spacing-controls">
      <h3>Spacing</h3>

      <div className="control-group">
        <label htmlFor="alp-h-spacing">
          <span>Horizontal Spacing:</span>
          <span className="value">{options.horizontalSpacing}px</span>
        </label>
        <input
          id="alp-h-spacing"
          type="range"
          min="100"
          max="400"
          step="10"
          value={options.horizontalSpacing}
          onChange={(e) =>
            onOptionChange("horizontalSpacing", parseInt(e.target.value))
          }
        />
      </div>

      <div className="control-group">
        <label htmlFor="alp-v-spacing">
          <span>Vertical Spacing:</span>
          <span className="value">{options.verticalSpacing}px</span>
        </label>
        <input
          id="alp-v-spacing"
          type="range"
          min="80"
          max="300"
          step="10"
          value={options.verticalSpacing}
          onChange={(e) =>
            onOptionChange("verticalSpacing", parseInt(e.target.value))
          }
        />
      </div>

      <div className="control-group">
        <label htmlFor="alp-branch-offset">
          <span>Branch Offset:</span>
          <span className="value">{options.branchOffset}px</span>
        </label>
        <input
          id="alp-branch-offset"
          type="range"
          min="80"
          max="300"
          step="10"
          value={options.branchOffset}
          onChange={(e) =>
            onOptionChange("branchOffset", parseInt(e.target.value))
          }
        />
      </div>

      <div className="control-group">
        <label htmlFor="alp-min-spacing">
          <span>Minimum Node Spacing:</span>
          <span className="value">{options.minNodeSpacing}px</span>
        </label>
        <input
          id="alp-min-spacing"
          type="range"
          min="10"
          max="50"
          step="5"
          value={options.minNodeSpacing}
          onChange={(e) =>
            onOptionChange("minNodeSpacing", parseInt(e.target.value))
          }
        />
      </div>
    </section>
  );
}
