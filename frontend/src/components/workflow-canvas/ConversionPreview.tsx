/**
 * Conversion Preview Component
 *
 * Preview component for format conversion (sequential ↔ graph).
 * Features:
 * - Before/After workflow visualization
 * - Highlight structural changes
 * - Show added/removed/modified actions
 * - Connection changes visualization
 * - Warning messages
 * - Statistics comparison
 * - Validation results
 */

import React, { useState } from "react";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { ConversionPreview as ConversionPreviewType } from "@/services/format-converter";
import { LayoutPreview } from "./LayoutPreview";

// ============================================================================
// Types
// ============================================================================

export interface ConversionPreviewProps {
  beforeWorkflow: Workflow;
  afterWorkflow: Workflow;
  conversionPreview: ConversionPreviewType;
  showWarnings?: boolean;
  showStatistics?: boolean;
}

interface ChangeType {
  type: "added" | "removed" | "modified" | "unchanged";
  actionId: string;
  actionType: string;
  actionName?: string;
  details?: string;
}

// ============================================================================
// Conversion Preview Component
// ============================================================================

export function ConversionPreview({
  beforeWorkflow,
  afterWorkflow,
  conversionPreview,
  showWarnings = true,
  showStatistics = true,
}: ConversionPreviewProps) {
  const [activeTab, setActiveTab] = useState<"visual" | "changes" | "warnings">(
    "visual"
  );

  // Analyze changes
  const changes = analyzeChanges(beforeWorkflow, afterWorkflow);
  const addedActions = changes.filter((c) => c.type === "added");
  const removedActions = changes.filter((c) => c.type === "removed");
  const modifiedActions = changes.filter((c) => c.type === "modified");

  return (
    <div className="conversion-preview">
      {/* Tab Navigation */}
      <div className="tab-navigation">
        <button
          className={`tab-button ${activeTab === "visual" ? "active" : ""}`}
          onClick={() => setActiveTab("visual")}
        >
          👁️ Visual Preview
        </button>
        <button
          className={`tab-button ${activeTab === "changes" ? "active" : ""}`}
          onClick={() => setActiveTab("changes")}
        >
          📋 Changes ({changes.length})
        </button>
        {showWarnings && conversionPreview.warnings.length > 0 && (
          <button
            className={`tab-button ${activeTab === "warnings" ? "active" : ""}`}
            onClick={() => setActiveTab("warnings")}
          >
            ⚠️ Warnings ({conversionPreview.warnings.length})
          </button>
        )}
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === "visual" && (
          <div className="visual-preview-tab">
            <LayoutPreview
              beforeWorkflow={beforeWorkflow}
              afterWorkflow={afterWorkflow}
              comparison={{
                improvementScore: 0,
                isImprovement: false,
                summary: "Format conversion preview",
                metrics: {
                  overlaps: { before: 0, after: 0, change: 0 },
                  edgeCrossings: { before: 0, after: 0, change: 0 },
                  edgeLength: { before: 0, after: 0, change: 0 },
                  compactness: { before: 0, after: 0, change: 0 },
                  readability: { before: 0, after: 0, change: 0 },
                },
                recommendations: [],
              }}
              mode="side-by-side"
              showChangedNodes={true}
            />

            {showStatistics && (
              <div className="conversion-statistics">
                <h4>Conversion Statistics</h4>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-value added">
                      {conversionPreview.changes.actionsAdded}
                    </div>
                    <div className="stat-label">Actions Added</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value removed">
                      {conversionPreview.changes.actionsRemoved}
                    </div>
                    <div className="stat-label">Actions Removed</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value modified">
                      {conversionPreview.changes.actionsModified}
                    </div>
                    <div className="stat-label">Actions Modified</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value changed">
                      {conversionPreview.changes.connectionsChanged}
                    </div>
                    <div className="stat-label">Connections Changed</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "changes" && (
          <div className="changes-tab">
            <div className="changes-summary">
              <div className="summary-item">
                <span className="badge added">+{addedActions.length}</span>
                <span>Added</span>
              </div>
              <div className="summary-item">
                <span className="badge removed">-{removedActions.length}</span>
                <span>Removed</span>
              </div>
              <div className="summary-item">
                <span className="badge modified">
                  ~{modifiedActions.length}
                </span>
                <span>Modified</span>
              </div>
            </div>

            <div className="changes-list">
              {addedActions.length > 0 && (
                <div className="change-section">
                  <h4>Added Actions</h4>
                  {addedActions.map((change, i) => (
                    <ChangeItem key={i} change={change} />
                  ))}
                </div>
              )}

              {removedActions.length > 0 && (
                <div className="change-section">
                  <h4>Removed Actions</h4>
                  {removedActions.map((change, i) => (
                    <ChangeItem key={i} change={change} />
                  ))}
                </div>
              )}

              {modifiedActions.length > 0 && (
                <div className="change-section">
                  <h4>Modified Actions</h4>
                  {modifiedActions.map((change, i) => (
                    <ChangeItem key={i} change={change} />
                  ))}
                </div>
              )}

              {changes.length === 0 && (
                <div className="no-changes">
                  <p>No structural changes detected</p>
                </div>
              )}
            </div>

            {/* Connection Changes */}
            {conversionPreview.changes.connectionsChanged > 0 && (
              <div className="connection-changes">
                <h4>Connection Changes</h4>
                <p>
                  {conversionPreview.changes.connectionsChanged} connection
                  {conversionPreview.changes.connectionsChanged > 1
                    ? "s"
                    : ""}{" "}
                  will be
                  {conversionPreview.fromFormat === "sequential"
                    ? " created"
                    : " removed/modified"}
                </p>
                {conversionPreview.fromFormat === "sequential" && (
                  <p className="info-text">
                    Sequential actions will be connected with explicit edges in
                    the graph format.
                  </p>
                )}
                {conversionPreview.toFormat === "sequential" && (
                  <p className="info-text">
                    Graph connections will be implicit in the sequential order.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "warnings" && showWarnings && (
          <div className="warnings-tab">
            <div className="warnings-list">
              {conversionPreview.warnings.map((warning, i) => (
                <div key={i} className="warning-item">
                  <div className="warning-icon">⚠️</div>
                  <div className="warning-content">
                    <div className="warning-code">{warning.code}</div>
                    <div className="warning-message">{warning.message}</div>
                    {warning.details && (
                      <div className="warning-details">
                        {JSON.stringify(warning.details, null, 2)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Linearizability Info */}
            {conversionPreview.linearizability && (
              <div className="linearizability-info">
                <h4>Linearizability Analysis</h4>
                <div
                  className={`linearizable-status ${conversionPreview.linearizability.linearizable ? "success" : "error"}`}
                >
                  {conversionPreview.linearizability.linearizable ? (
                    <>✓ Workflow can be linearized</>
                  ) : (
                    <>✗ Workflow cannot be linearized</>
                  )}
                </div>

                {conversionPreview.linearizability.details && (
                  <div className="linearizability-details">
                    <div className="detail-row">
                      <span>Entry Points:</span>
                      <span>
                        {
                          conversionPreview.linearizability.details
                            .entryPointCount
                        }
                      </span>
                    </div>
                    <div className="detail-row">
                      <span>Branch Points:</span>
                      <span>
                        {
                          conversionPreview.linearizability.details
                            .branchingNodeCount
                        }
                      </span>
                    </div>
                    <div className="detail-row">
                      <span>Merge Points:</span>
                      <span>
                        {
                          conversionPreview.linearizability.details
                            .mergeNodeCount
                        }
                      </span>
                    </div>
                    <div className="detail-row">
                      <span>Parallel Branches:</span>
                      <span>
                        {
                          conversionPreview.linearizability.details
                            .parallelBranchCount
                        }
                      </span>
                    </div>
                    <div className="detail-row">
                      <span>Cycles:</span>
                      <span>
                        {conversionPreview.linearizability.details.cycleCount}
                      </span>
                    </div>
                  </div>
                )}

                {conversionPreview.linearizability.issues.length > 0 && (
                  <div className="linearizability-issues">
                    <h5>Issues:</h5>
                    <ul>
                      {conversionPreview.linearizability.issues.map(
                        (issue, i) => (
                          <li key={i}>{issue}</li>
                        )
                      )}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Impact Banner */}
      <div className={`impact-banner impact-${conversionPreview.impact}`}>
        <div className="impact-label">
          <strong>Impact:</strong> {conversionPreview.impact.toUpperCase()}
        </div>
        <div className="recommendation-label">
          <strong>Recommendation:</strong>{" "}
          {conversionPreview.recommendation.replace("_", " ").toUpperCase()}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Change Item Component
// ============================================================================

interface ChangeItemProps {
  change: ChangeType;
}

function ChangeItem({ change }: ChangeItemProps) {
  return (
    <div className={`change-item change-${change.type}`}>
      <div className="change-icon">
        {change.type === "added" && "+"}
        {change.type === "removed" && "-"}
        {change.type === "modified" && "~"}
      </div>
      <div className="change-content">
        <div className="change-header">
          <span className="action-type">{change.actionType}</span>
          {change.actionName && (
            <span className="action-name">{change.actionName}</span>
          )}
        </div>
        {change.details && (
          <div className="change-details">{change.details}</div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

function analyzeChanges(before: Workflow, after: Workflow): ChangeType[] {
  const changes: ChangeType[] = [];
  const beforeIds = new Set(before.actions.map((a) => a.id));
  const afterIds = new Set(after.actions.map((a) => a.id));

  // Find added actions
  for (const action of after.actions) {
    if (!beforeIds.has(action.id)) {
      changes.push({
        type: "added",
        actionId: action.id,
        actionType: action.type,
        actionName: action.name,
        details: "New action added during conversion",
      });
    }
  }

  // Find removed actions
  for (const action of before.actions) {
    if (!afterIds.has(action.id)) {
      changes.push({
        type: "removed",
        actionId: action.id,
        actionType: action.type,
        actionName: action.name,
        details: "Action removed during conversion",
      });
    }
  }

  // Find modified actions
  for (const beforeAction of before.actions) {
    const afterAction = after.actions.find((a) => a.id === beforeAction.id);
    if (afterAction) {
      // Check if config changed
      const configChanged =
        JSON.stringify(beforeAction.config) !==
        JSON.stringify(afterAction.config);
      const positionChanged =
        beforeAction.position &&
        afterAction.position &&
        (beforeAction.position[0] !== afterAction.position[0] ||
          beforeAction.position[1] !== afterAction.position[1]);

      if (configChanged) {
        changes.push({
          type: "modified",
          actionId: beforeAction.id,
          actionType: beforeAction.type,
          actionName: beforeAction.name,
          details: "Action configuration modified",
        });
      }
    }
  }

  return changes;
}
