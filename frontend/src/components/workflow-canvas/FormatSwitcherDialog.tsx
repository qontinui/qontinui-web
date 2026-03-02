import React from "react";
import type { Workflow } from "@/lib/action-schema/action-types";
import { ConversionPreview as ConversionPreviewComponent } from "./ConversionPreview";
import { useFormatSwitcher } from "./_hooks/use-format-switcher";
import { FormatCard, FORMAT_INFO } from "./_components/FormatCard";
import { ConversionAnalysis } from "./_components/ConversionAnalysis";

export interface FormatSwitcherDialogProps {
  open: boolean;
  workflow: Workflow;
  currentFormat: "sequential" | "graph";
  onSwitch: (newWorkflow: Workflow, newFormat: "sequential" | "graph") => void;
  onClose: () => void;
}

export function FormatSwitcherDialog({
  open,
  workflow,
  currentFormat,
  onSwitch,
  onClose,
}: FormatSwitcherDialogProps) {
  const {
    targetFormat,
    setTargetFormat,
    viewMode,
    setViewMode,
    selectedLayout,
    setSelectedLayout,
    isConverting,
    error,
    conversionPreview,
    previewWorkflow,
    canConvert,
    handleConvert,
    handleCancel,
  } = useFormatSwitcher({ open, workflow, currentFormat, onSwitch, onClose });

  if (!open) return null;

  const targetInfo = FORMAT_INFO[targetFormat];

  return (
    <div className="format-switcher-overlay">
      <div
        className="format-switcher-dialog"
        data-ui-id="dialog-format-switcher"
      >
        {/* Header */}
        <div className="format-switcher-header">
          <h2>Switch Workflow Format</h2>
          <button
            className="close-button"
            onClick={handleCancel}
            aria-label="Close"
            data-ui-id="dialog-format-switcher-close-btn"
          >
            ×
          </button>
        </div>

        {/* View Toggle */}
        <div className="view-toggle">
          <button
            className={viewMode === "list" ? "active" : ""}
            onClick={() => setViewMode("list")}
          >
            📋 List View
          </button>
          <button
            className={viewMode === "preview" ? "active" : ""}
            onClick={() => setViewMode("preview")}
            disabled={!canConvert}
          >
            👁️ Preview
          </button>
        </div>

        {/* Content */}
        <div className="format-switcher-content">
          {viewMode === "list" ? (
            <>
              {/* Format Selection */}
              <div className="format-selection">
                <h3>Select Target Format</h3>
                <div className="format-cards">
                  <FormatCard
                    format="sequential"
                    info={FORMAT_INFO.sequential}
                    selected={targetFormat === "sequential"}
                    disabled={currentFormat === "sequential"}
                    onClick={() => setTargetFormat("sequential")}
                  />
                  <FormatCard
                    format="graph"
                    info={FORMAT_INFO.graph}
                    selected={targetFormat === "graph"}
                    disabled={currentFormat === "graph"}
                    onClick={() => setTargetFormat("graph")}
                  />
                </div>
              </div>

              {/* Conversion Info */}
              {conversionPreview && (
                <ConversionAnalysis
                  conversionPreview={conversionPreview}
                  targetFormat={targetFormat}
                  selectedLayout={selectedLayout}
                  onLayoutChange={setSelectedLayout}
                />
              )}
            </>
          ) : (
            /* Preview Mode */
            <div className="preview-mode">
              {previewWorkflow ? (
                <ConversionPreviewComponent
                  beforeWorkflow={workflow}
                  afterWorkflow={previewWorkflow}
                  conversionPreview={conversionPreview!}
                />
              ) : (
                <div className="preview-loading">Generating preview...</div>
              )}
            </div>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="error-message">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Footer */}
        <div className="format-switcher-footer">
          <button
            className="cancel-button"
            onClick={handleCancel}
            disabled={isConverting}
            data-ui-id="dialog-format-switcher-cancel-btn"
          >
            Cancel
          </button>
          <button
            className="convert-button"
            onClick={handleConvert}
            disabled={!canConvert || isConverting}
            data-ui-id="dialog-format-switcher-confirm-btn"
          >
            {isConverting ? (
              <>
                <span className="spinner" />
                Converting...
              </>
            ) : (
              <>Convert to {targetInfo.title}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
