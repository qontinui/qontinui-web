import React from "react";
import type { ConversionPreview } from "@/services/format-converter";
import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";
import { LayoutOption } from "./LayoutOption";

interface ConversionAnalysisProps {
  conversionPreview: ConversionPreview;
  targetFormat: "sequential" | "graph";
  selectedLayout: LayoutStyle;
  onLayoutChange: (layout: LayoutStyle) => void;
}

export function ConversionAnalysis({
  conversionPreview,
  targetFormat,
  selectedLayout,
  onLayoutChange,
}: ConversionAnalysisProps) {
  return (
    <div className="conversion-info">
      <h3>Conversion Analysis</h3>

      {/* Impact Badge */}
      <div className={`impact-badge impact-${conversionPreview.impact}`}>
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

      {/* Linearizability Check (for graph -> sequential) */}
      {targetFormat === "sequential" && conversionPreview.linearizability && (
        <div className="linearizability-check">
          <h4>Linearizability Check</h4>
          <div
            className={`check-result ${conversionPreview.linearizability.linearizable ? "success" : "error"}`}
          >
            {conversionPreview.linearizability.linearizable ? "✓" : "✗"}{" "}
            {conversionPreview.linearizability.linearizable
              ? "Workflow can be converted to sequential format"
              : "Workflow cannot be linearized"}
          </div>

          {conversionPreview.linearizability.issues.length > 0 && (
            <div className="issues-list">
              <strong>Issues:</strong>
              <ul>
                {conversionPreview.linearizability.issues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

          {conversionPreview.linearizability.details && (
            <div className="details">
              <div className="detail-item">
                Branch Points:{" "}
                {conversionPreview.linearizability.details.branchingNodeCount}
              </div>
              <div className="detail-item">
                Merge Points:{" "}
                {conversionPreview.linearizability.details.mergeNodeCount}
              </div>
              <div className="detail-item">
                Parallel Branches:{" "}
                {conversionPreview.linearizability.details.parallelBranchCount}
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

      {/* Layout Selection (for sequential -> graph) */}
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
              onClick={() => onLayoutChange(LayoutStyle.HIERARCHICAL)}
            />
            <LayoutOption
              style={LayoutStyle.HORIZONTAL}
              name="Horizontal"
              description="Left-to-right flow"
              selected={selectedLayout === LayoutStyle.HORIZONTAL}
              onClick={() => onLayoutChange(LayoutStyle.HORIZONTAL)}
            />
            <LayoutOption
              style={LayoutStyle.TREE}
              name="Tree"
              description="Compact tree structure"
              selected={selectedLayout === LayoutStyle.TREE}
              onClick={() => onLayoutChange(LayoutStyle.TREE)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
