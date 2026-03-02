import React from "react";
import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";
import { LayoutPreview } from "./LayoutPreview";
import { LayoutSuggestions } from "./LayoutSuggestions";
import { LAYOUT_STYLES } from "./auto-layout-constants";
import { useAutoLayout } from "./_hooks/use-auto-layout";
import { StyleButton } from "./_components/StyleButton";
import { SpacingControls } from "./_components/SpacingControls";
import { StatisticsSection } from "./_components/StatisticsSection";
import { PresetSelector } from "./_components/PresetSelector";
import type { AutoLayoutPanelProps } from "./auto-layout-types";

export type { AutoLayoutPanelProps } from "./auto-layout-types";

export function AutoLayoutPanel({
  workflow,
  onApplyLayout,
  onClose,
}: AutoLayoutPanelProps) {
  const {
    selectedStyle,
    selectedPreset,
    customOptions,
    animate,
    setAnimate,
    showPreview,
    setShowPreview,
    showStatistics,
    setShowStatistics,
    showSuggestions,
    setShowSuggestions,
    previewResult,
    customPresets,
    recommendation,
    allPresets,
    handleStyleChange,
    handlePresetChange,
    handleOptionChange,
    handleSavePreset,
  } = useAutoLayout(workflow);

  const handleApply = () => {
    if (previewResult) {
      onApplyLayout(previewResult.workflow, animate);
    }
  };

  return (
    <div className="auto-layout-panel">
      {/* Header */}
      <div className="panel-header">
        <h2>Auto-Layout</h2>
        {onClose && (
          <button className="close-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>

      <div className="panel-content">
        {/* Recommendation Banner */}
        {recommendation.confidence > 0.7 && (
          <div className="recommendation-banner">
            <div className="recommendation-icon">💡</div>
            <div className="recommendation-text">
              <strong>Recommended:</strong>{" "}
              {LAYOUT_STYLES[recommendation.style].name}
              <p>{recommendation.reason}</p>
            </div>
            {selectedStyle !== recommendation.style && (
              <button
                className="use-recommendation-button"
                onClick={() => handleStyleChange(recommendation.style)}
              >
                Use This
              </button>
            )}
          </div>
        )}

        {/* Layout Style Selection */}
        <section className="style-selection">
          <h3>Layout Style</h3>
          <div className="style-grid">
            {Object.entries(LAYOUT_STYLES).map(([styleKey, info]) => (
              <StyleButton
                key={styleKey}
                style={styleKey as LayoutStyle}
                info={info}
                selected={selectedStyle === styleKey}
                onClick={() => handleStyleChange(styleKey as LayoutStyle)}
              />
            ))}
          </div>
        </section>

        <PresetSelector
          allPresets={allPresets}
          customPresets={customPresets}
          selectedPreset={selectedPreset}
          onPresetChange={handlePresetChange}
        />

        <SpacingControls
          options={customOptions}
          onOptionChange={handleOptionChange}
        />

        {/* Preview Section */}
        {showPreview && previewResult && (
          <section className="preview-section">
            <div className="section-header">
              <h3>Preview</h3>
              <button
                className="toggle-button"
                onClick={() => setShowPreview(!showPreview)}
              >
                {showPreview ? "Hide" : "Show"}
              </button>
            </div>
            <LayoutPreview
              beforeWorkflow={workflow}
              afterWorkflow={previewResult.workflow}
              comparison={previewResult.comparison}
              mode="side-by-side"
            />
          </section>
        )}

        {/* Statistics Section */}
        {showStatistics && previewResult && (
          <StatisticsSection
            previewResult={previewResult}
            showStatistics={showStatistics}
            onToggle={() => setShowStatistics(!showStatistics)}
          />
        )}

        {/* Suggestions Section */}
        {showSuggestions && previewResult && (
          <section className="suggestions-section">
            <div className="section-header">
              <h3>Suggestions</h3>
              <button
                className="toggle-button"
                onClick={() => setShowSuggestions(!showSuggestions)}
              >
                {showSuggestions ? "Hide" : "Show"}
              </button>
            </div>
            <LayoutSuggestions
              workflow={workflow}
              layoutResult={previewResult}
              onApplySuggestion={(fixedWorkflow) => {
                onApplyLayout(fixedWorkflow, false);
              }}
            />
          </section>
        )}
      </div>

      {/* Footer Actions */}
      <div className="panel-footer">
        <div className="footer-options">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={animate}
              onChange={(e) => setAnimate(e.target.checked)}
            />
            <span>Animate layout transition</span>
          </label>
        </div>

        <div className="footer-buttons">
          <button
            className="save-preset-button"
            onClick={handleSavePreset}
            disabled={selectedPreset !== "custom"}
          >
            Save as Preset
          </button>
          <button
            className="apply-button"
            onClick={handleApply}
            disabled={!previewResult}
          >
            Apply Layout
          </button>
        </div>
      </div>
    </div>
  );
}
