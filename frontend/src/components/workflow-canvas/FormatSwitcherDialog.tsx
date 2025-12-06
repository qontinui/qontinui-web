/**
 * Format Switcher Dialog
 *
 * Dialog for switching between sequential and graph workflow formats.
 * Features:
 * - View toggle (List View / Graph View)
 * - Format info cards
 * - Conversion preview
 * - Linearizability check results
 * - Warning messages
 * - Layout selection
 * - Convert button with progress
 */

import React, { useState, useEffect, useMemo } from "react";
import type { Workflow } from "@/lib/action-schema/action-types";
import {
  getFormatConverter,
  ConversionPreview,
  ConversionResult,
} from "@/services/format-converter";
import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";
import { ConversionPreview as ConversionPreviewComponent } from "./ConversionPreview";

// ============================================================================
// Types
// ============================================================================

export interface FormatSwitcherDialogProps {
  open: boolean;
  workflow: Workflow;
  currentFormat: "sequential" | "graph";
  onSwitch: (newWorkflow: Workflow, newFormat: "sequential" | "graph") => void;
  onClose: () => void;
}

type ViewMode = "list" | "preview";

// ============================================================================
// Format Info Cards
// ============================================================================

interface FormatInfo {
  title: string;
  description: string;
  useCases: string[];
  advantages: string[];
  disadvantages: string[];
  icon: string;
}

const FORMAT_INFO: Record<"sequential" | "graph", FormatInfo> = {
  sequential: {
    title: "Sequential Format",
    description: "Actions execute in order, one after another",
    icon: "📋",
    useCases: [
      "Simple automation scripts",
      "Form filling workflows",
      "Linear test scenarios",
      "Step-by-step procedures",
    ],
    advantages: [
      "Easy to understand",
      "Clear execution order",
      "Simple to debug",
      "Compact representation",
    ],
    disadvantages: [
      "Limited branching",
      "No parallel execution",
      "Less flexible",
      "Cannot represent complex flows",
    ],
  },
  graph: {
    title: "Graph Format",
    description: "Actions connected as nodes with flexible flow control",
    icon: "🕸️",
    useCases: [
      "Complex workflows with branching",
      "Error handling and retry logic",
      "Parallel execution paths",
      "State machines",
    ],
    advantages: [
      "Powerful branching",
      "Visual workflow structure",
      "Parallel execution support",
      "Flexible connections",
    ],
    disadvantages: [
      "More complex to understand",
      "Can become cluttered",
      "Requires layout management",
      "Harder to debug",
    ],
  },
};

// ============================================================================
// Format Switcher Dialog
// ============================================================================

export function FormatSwitcherDialog({
  open,
  workflow,
  currentFormat,
  onSwitch,
  onClose,
}: FormatSwitcherDialogProps) {
  const [targetFormat, setTargetFormat] = useState<"sequential" | "graph">(
    currentFormat === "sequential" ? "graph" : "sequential"
  );
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedLayout, setSelectedLayout] = useState<LayoutStyle>(
    LayoutStyle.HIERARCHICAL
  );
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversionPreview, setConversionPreview] =
    useState<ConversionPreview | null>(null);
  const [previewWorkflow, setPreviewWorkflow] = useState<Workflow | null>(null);

  const converter = useMemo(() => getFormatConverter(), []);

  // Load conversion preview when dialog opens
  useEffect(() => {
    if (open) {
      setError(null);
      setTargetFormat(currentFormat === "sequential" ? "graph" : "sequential");

      const preview = converter.previewConversion(workflow, targetFormat);
      setConversionPreview(preview);

      // Generate preview workflow
      generatePreviewWorkflow();
    }
  }, [open, workflow, currentFormat]);

  // Update preview when target format changes
  useEffect(() => {
    if (open && conversionPreview) {
      const preview = converter.previewConversion(workflow, targetFormat);
      setConversionPreview(preview);
      generatePreviewWorkflow();
    }
  }, [targetFormat]);

  const generatePreviewWorkflow = async () => {
    try {
      let result: ConversionResult;

      if (targetFormat === "graph") {
        result = await converter.convertToGraph(workflow, {
          autoLayout: true,
          layoutStyle: selectedLayout as
            | "tree"
            | "horizontal"
            | "hierarchical"
            | undefined,
          validate: true,
        });
      } else {
        result = await converter.convertToSequential(workflow, {
          validate: true,
        });
      }

      if (result.success && result.workflow) {
        setPreviewWorkflow(result.workflow);
      }
    } catch (err) {
      console.error("Failed to generate preview:", err);
    }
  };

  const handleConvert = async () => {
    setIsConverting(true);
    setError(null);

    try {
      let result: ConversionResult;

      if (targetFormat === "graph") {
        result = await converter.convertToGraph(workflow, {
          autoLayout: true,
          layoutStyle: selectedLayout as
            | "tree"
            | "horizontal"
            | "hierarchical"
            | undefined,
          validate: true,
        });
      } else {
        result = await converter.convertToSequential(workflow, {
          validate: true,
        });
      }

      if (result.success && result.workflow) {
        onSwitch(result.workflow, targetFormat);
        onClose();
      } else {
        setError(result.errors?.[0]?.message || "Conversion failed");
      }
    } catch (err: any) {
      setError(err.message || "Conversion failed");
    } finally {
      setIsConverting(false);
    }
  };

  const handleCancel = () => {
    setError(null);
    onClose();
  };

  if (!open) return null;

  const canConvert = conversionPreview?.canConvert ?? false;
  const targetInfo = FORMAT_INFO[targetFormat];

  return (
    <div className="format-switcher-overlay">
      <div className="format-switcher-dialog">
        {/* Header */}
        <div className="format-switcher-header">
          <h2>Switch Workflow Format</h2>
          <button
            className="close-button"
            onClick={handleCancel}
            aria-label="Close"
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
                <div className="conversion-info">
                  <h3>Conversion Analysis</h3>

                  {/* Impact Badge */}
                  <div
                    className={`impact-badge impact-${conversionPreview.impact}`}
                  >
                    Impact: {conversionPreview.impact.toUpperCase()}
                  </div>

                  {/* Recommendation */}
                  <div
                    className={`recommendation recommendation-${conversionPreview.recommendation}`}
                  >
                    <strong>Recommendation:</strong>{" "}
                    {conversionPreview.recommendation.replace("_", " ")}
                  </div>

                  {/* Changes */}
                  <div className="changes-summary">
                    <h4>Expected Changes</h4>
                    <div className="change-item">
                      <span className="label">Actions Added:</span>
                      <span className="value">
                        {conversionPreview.changes.actionsAdded}
                      </span>
                    </div>
                    <div className="change-item">
                      <span className="label">Actions Removed:</span>
                      <span className="value">
                        {conversionPreview.changes.actionsRemoved}
                      </span>
                    </div>
                    <div className="change-item">
                      <span className="label">Actions Modified:</span>
                      <span className="value">
                        {conversionPreview.changes.actionsModified}
                      </span>
                    </div>
                    <div className="change-item">
                      <span className="label">Connections Changed:</span>
                      <span className="value">
                        {conversionPreview.changes.connectionsChanged}
                      </span>
                    </div>
                  </div>

                  {/* Linearizability Check (for graph → sequential) */}
                  {targetFormat === "sequential" &&
                    conversionPreview.linearizability && (
                      <div className="linearizability-check">
                        <h4>Linearizability Check</h4>
                        <div
                          className={`check-result ${conversionPreview.linearizability.linearizable ? "success" : "error"}`}
                        >
                          {conversionPreview.linearizability.linearizable
                            ? "✓"
                            : "✗"}{" "}
                          {conversionPreview.linearizability.linearizable
                            ? "Workflow can be converted to sequential format"
                            : "Workflow cannot be linearized"}
                        </div>

                        {conversionPreview.linearizability.issues.length >
                          0 && (
                          <div className="issues-list">
                            <strong>Issues:</strong>
                            <ul>
                              {conversionPreview.linearizability.issues.map(
                                (issue, i) => (
                                  <li key={i}>{issue}</li>
                                )
                              )}
                            </ul>
                          </div>
                        )}

                        {conversionPreview.linearizability.details && (
                          <div className="details">
                            <div className="detail-item">
                              Branch Points:{" "}
                              {
                                conversionPreview.linearizability.details
                                  .branchingNodeCount
                              }
                            </div>
                            <div className="detail-item">
                              Merge Points:{" "}
                              {
                                conversionPreview.linearizability.details
                                  .mergeNodeCount
                              }
                            </div>
                            <div className="detail-item">
                              Parallel Branches:{" "}
                              {
                                conversionPreview.linearizability.details
                                  .parallelBranchCount
                              }
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                  {/* Warnings */}
                  {conversionPreview.warnings.length > 0 && (
                    <div className="warnings">
                      <h4>⚠️ Warnings</h4>
                      <ul>
                        {conversionPreview.warnings.map((warning, i) => (
                          <li key={i} className="warning-item">
                            <strong>{warning.code}:</strong> {warning.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Layout Selection (for sequential → graph) */}
                  {targetFormat === "graph" && (
                    <div className="layout-selection">
                      <h4>Layout Style</h4>
                      <p className="description">
                        Choose how the graph should be arranged:
                      </p>
                      <div className="layout-options">
                        <LayoutOption
                          style={LayoutStyle.HIERARCHICAL}
                          name="Hierarchical"
                          description="Top-to-bottom flow (recommended)"
                          selected={selectedLayout === LayoutStyle.HIERARCHICAL}
                          onClick={() =>
                            setSelectedLayout(LayoutStyle.HIERARCHICAL)
                          }
                        />
                        <LayoutOption
                          style={LayoutStyle.HORIZONTAL}
                          name="Horizontal"
                          description="Left-to-right flow"
                          selected={selectedLayout === LayoutStyle.HORIZONTAL}
                          onClick={() =>
                            setSelectedLayout(LayoutStyle.HORIZONTAL)
                          }
                        />
                        <LayoutOption
                          style={LayoutStyle.TREE}
                          name="Tree"
                          description="Compact tree structure"
                          selected={selectedLayout === LayoutStyle.TREE}
                          onClick={() => setSelectedLayout(LayoutStyle.TREE)}
                        />
                      </div>
                    </div>
                  )}
                </div>
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
          >
            Cancel
          </button>
          <button
            className="convert-button"
            onClick={handleConvert}
            disabled={!canConvert || isConverting}
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

// ============================================================================
// Format Card Component
// ============================================================================

interface FormatCardProps {
  format: "sequential" | "graph";
  info: FormatInfo;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}

function FormatCard({
  format: _format,
  info,
  selected,
  disabled,
  onClick,
}: FormatCardProps) {
  return (
    <div
      className={`format-card ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}`}
      onClick={disabled ? undefined : onClick}
    >
      <div className="format-icon">{info.icon}</div>
      <h4>{info.title}</h4>
      <p className="description">{info.description}</p>

      <div className="format-details">
        <div className="detail-section">
          <strong>When to use:</strong>
          <ul>
            {info.useCases.map((useCase, i) => (
              <li key={i}>{useCase}</li>
            ))}
          </ul>
        </div>

        <div className="detail-section">
          <strong>Advantages:</strong>
          <ul>
            {info.advantages.slice(0, 3).map((adv, i) => (
              <li key={i} className="advantage">
                ✓ {adv}
              </li>
            ))}
          </ul>
        </div>

        <div className="detail-section">
          <strong>Limitations:</strong>
          <ul>
            {info.disadvantages.slice(0, 2).map((dis, i) => (
              <li key={i} className="disadvantage">
                • {dis}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {disabled && <div className="current-format-badge">Current Format</div>}
    </div>
  );
}

// ============================================================================
// Layout Option Component
// ============================================================================

interface LayoutOptionProps {
  style: LayoutStyle;
  name: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}

function LayoutOption({
  style,
  name,
  description,
  selected,
  onClick,
}: LayoutOptionProps) {
  return (
    <div
      className={`layout-option ${selected ? "selected" : ""}`}
      onClick={onClick}
    >
      <div className="layout-preview">
        <LayoutPreviewIcon style={style} />
      </div>
      <div className="layout-info">
        <strong>{name}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}

// ============================================================================
// Layout Preview Icon
// ============================================================================

function LayoutPreviewIcon({ style }: { style: LayoutStyle }) {
  // Simple ASCII-art style preview of layout
  switch (style) {
    case LayoutStyle.HIERARCHICAL:
      return (
        <svg width="60" height="60" viewBox="0 0 60 60">
          <rect
            x="20"
            y="5"
            width="20"
            height="12"
            fill="currentColor"
            opacity="0.7"
            rx="2"
          />
          <rect
            x="5"
            y="25"
            width="20"
            height="12"
            fill="currentColor"
            opacity="0.7"
            rx="2"
          />
          <rect
            x="35"
            y="25"
            width="20"
            height="12"
            fill="currentColor"
            opacity="0.7"
            rx="2"
          />
          <rect
            x="20"
            y="45"
            width="20"
            height="12"
            fill="currentColor"
            opacity="0.7"
            rx="2"
          />
          <path
            d="M30 17 L15 25 M30 17 L45 25 M15 37 L30 45 M45 37 L30 45"
            stroke="currentColor"
            fill="none"
            opacity="0.5"
          />
        </svg>
      );
    case LayoutStyle.HORIZONTAL:
      return (
        <svg width="60" height="60" viewBox="0 0 60 60">
          <rect
            x="5"
            y="24"
            width="12"
            height="12"
            fill="currentColor"
            opacity="0.7"
            rx="2"
          />
          <rect
            x="24"
            y="24"
            width="12"
            height="12"
            fill="currentColor"
            opacity="0.7"
            rx="2"
          />
          <rect
            x="43"
            y="24"
            width="12"
            height="12"
            fill="currentColor"
            opacity="0.7"
            rx="2"
          />
          <path
            d="M17 30 L24 30 M36 30 L43 30"
            stroke="currentColor"
            fill="none"
            opacity="0.5"
            strokeWidth="2"
          />
        </svg>
      );
    case LayoutStyle.TREE:
      return (
        <svg width="60" height="60" viewBox="0 0 60 60">
          <rect
            x="25"
            y="5"
            width="10"
            height="10"
            fill="currentColor"
            opacity="0.7"
            rx="1"
          />
          <rect
            x="10"
            y="20"
            width="10"
            height="10"
            fill="currentColor"
            opacity="0.7"
            rx="1"
          />
          <rect
            x="25"
            y="20"
            width="10"
            height="10"
            fill="currentColor"
            opacity="0.7"
            rx="1"
          />
          <rect
            x="40"
            y="20"
            width="10"
            height="10"
            fill="currentColor"
            opacity="0.7"
            rx="1"
          />
          <rect
            x="5"
            y="35"
            width="10"
            height="10"
            fill="currentColor"
            opacity="0.7"
            rx="1"
          />
          <rect
            x="25"
            y="35"
            width="10"
            height="10"
            fill="currentColor"
            opacity="0.7"
            rx="1"
          />
          <rect
            x="45"
            y="35"
            width="10"
            height="10"
            fill="currentColor"
            opacity="0.7"
            rx="1"
          />
          <path
            d="M30 15 L15 20 M30 15 L30 20 M30 15 L45 20 M15 30 L10 35 M30 30 L30 35 M45 30 L50 35"
            stroke="currentColor"
            fill="none"
            opacity="0.3"
          />
        </svg>
      );
    default:
      return null;
  }
}
