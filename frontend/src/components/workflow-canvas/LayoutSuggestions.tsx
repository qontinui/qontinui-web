/**
 * Layout Suggestions Component
 *
 * Displays detected layout issues with quick-fix options.
 * Features:
 * - List of detected issues
 * - Severity badges (error, warning, info)
 * - Issue description
 * - Quick-fix button for each
 * - Fix All button
 * - Dismiss button
 * - Before/After preview for each fix
 */

import React, { useState, useMemo } from "react";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { LayoutPreviewResult } from "@/services/layout-service";
import { getLayoutService } from "@/services/layout-service";
import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";

// ============================================================================
// Types
// ============================================================================

export interface LayoutSuggestionsProps {
  workflow: Workflow;
  layoutResult: LayoutPreviewResult;
  onApplySuggestion: (fixedWorkflow: Workflow) => void;
}

interface LayoutIssue {
  id: string;
  severity: "error" | "warning" | "info";
  title: string;
  description: string;
  affectedNodes: string[];
  fix?: () => Workflow;
  autoFixable: boolean;
}

// ============================================================================
// Layout Suggestions Component
// ============================================================================

export function LayoutSuggestions({
  workflow,
  layoutResult,
  onApplySuggestion,
}: LayoutSuggestionsProps) {
  const [dismissedIssues, setDismissedIssues] = useState<Set<string>>(
    new Set()
  );
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null);

  const layoutService = useMemo(() => getLayoutService(), []);

  // Detect issues
  const issues = useMemo(
    () => detectIssues(workflow, layoutResult, layoutService),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workflow, layoutResult]
  );

  // Filter out dismissed issues
  const activeIssues = issues.filter((issue) => !dismissedIssues.has(issue.id));

  const errorCount = activeIssues.filter((i) => i.severity === "error").length;
  const warningCount = activeIssues.filter(
    (i) => i.severity === "warning"
  ).length;
  const infoCount = activeIssues.filter((i) => i.severity === "info").length;

  const handleFixIssue = (issue: LayoutIssue) => {
    if (issue.fix) {
      const fixedWorkflow = issue.fix();
      onApplySuggestion(fixedWorkflow);
    }
  };

  const handleFixAll = () => {
    let fixedWorkflow = { ...workflow };
    for (const issue of activeIssues) {
      if (issue.autoFixable && issue.fix) {
        fixedWorkflow = issue.fix();
      }
    }
    onApplySuggestion(fixedWorkflow);
  };

  const handleDismiss = (issueId: string) => {
    setDismissedIssues((prev) => new Set([...prev, issueId]));
  };

  const handleDismissAll = () => {
    setDismissedIssues(new Set(issues.map((i) => i.id)));
  };

  const toggleExpand = (issueId: string) => {
    setExpandedIssue((prev) => (prev === issueId ? null : issueId));
  };

  if (activeIssues.length === 0) {
    return (
      <div className="layout-suggestions no-issues">
        <div className="success-message">
          <span className="success-icon">✓</span>
          <span>No layout issues detected</span>
        </div>
      </div>
    );
  }

  const autoFixableCount = activeIssues.filter((i) => i.autoFixable).length;

  return (
    <div className="layout-suggestions">
      {/* Summary Header */}
      <div className="suggestions-header">
        <div className="issue-counts">
          {errorCount > 0 && (
            <span className="count-badge error">
              {errorCount} Error{errorCount > 1 ? "s" : ""}
            </span>
          )}
          {warningCount > 0 && (
            <span className="count-badge warning">
              {warningCount} Warning{warningCount > 1 ? "s" : ""}
            </span>
          )}
          {infoCount > 0 && (
            <span className="count-badge info">{infoCount} Info</span>
          )}
        </div>

        <div className="header-actions">
          {autoFixableCount > 1 && (
            <button className="fix-all-button" onClick={handleFixAll}>
              Fix All ({autoFixableCount})
            </button>
          )}
          <button className="dismiss-all-button" onClick={handleDismissAll}>
            Dismiss All
          </button>
        </div>
      </div>

      {/* Issues List */}
      <div className="issues-list">
        {activeIssues.map((issue) => (
          <IssueCard
            key={issue.id}
            issue={issue}
            expanded={expandedIssue === issue.id}
            onToggleExpand={() => toggleExpand(issue.id)}
            onFix={() => handleFixIssue(issue)}
            onDismiss={() => handleDismiss(issue.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Issue Card Component
// ============================================================================

interface IssueCardProps {
  issue: LayoutIssue;
  expanded: boolean;
  onToggleExpand: () => void;
  onFix: () => void;
  onDismiss: () => void;
}

function IssueCard({
  issue,
  expanded,
  onToggleExpand,
  onFix,
  onDismiss,
}: IssueCardProps) {
  return (
    <div className={`issue-card severity-${issue.severity}`}>
      <div
        className="issue-header"
        role="button"
        tabIndex={0}
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpand();
          }
        }}
      >
        <div className="issue-main">
          <span className={`severity-badge ${issue.severity}`}>
            {issue.severity === "error" && "⚠️"}
            {issue.severity === "warning" && "⚠"}
            {issue.severity === "info" && "ℹ️"}
            {issue.severity.toUpperCase()}
          </span>
          <span className="issue-title">{issue.title}</span>
          {issue.affectedNodes.length > 0 && (
            <span className="affected-count">
              ({issue.affectedNodes.length} node
              {issue.affectedNodes.length > 1 ? "s" : ""})
            </span>
          )}
        </div>
        <div className="issue-actions">
          {issue.autoFixable && (
            <button
              className="quick-fix-button"
              onClick={(e) => {
                e.stopPropagation();
                onFix();
              }}
            >
              Quick Fix
            </button>
          )}
          <button
            className="dismiss-button"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
          >
            Dismiss
          </button>
          <button className="expand-button">{expanded ? "▼" : "▶"}</button>
        </div>
      </div>
      {expanded && (
        <div className="issue-details">
          <p className="issue-description">{issue.description}</p>

          {issue.affectedNodes.length > 0 && (
            <div className="affected-nodes">
              <strong>Affected nodes:</strong>
              <ul>
                {issue.affectedNodes.slice(0, 5).map((nodeId, i) => (
                  <li key={i}>{nodeId}</li>
                ))}
                {issue.affectedNodes.length > 5 && (
                  <li>...and {issue.affectedNodes.length - 5} more</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Issue Detection
// ============================================================================

function detectIssues(
  workflow: Workflow,
  layoutResult: LayoutPreviewResult,
  layoutService: ReturnType<typeof getLayoutService>
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];

  // Check for overlapping nodes
  const overlaps = layoutResult.statistics.nodesOverlapping;
  if (overlaps > 0) {
    const overlappingNodes = findOverlappingNodes(workflow);
    issues.push({
      id: "overlapping-nodes",
      severity: "error",
      title: `${overlaps} overlapping node${overlaps > 1 ? "s" : ""}`,
      description:
        "Nodes are overlapping and may be difficult to distinguish. Apply auto-layout to fix.",
      affectedNodes: overlappingNodes,
      autoFixable: true,
      fix: () => {
        const fixed = JSON.parse(JSON.stringify(workflow));
        layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL);
        return fixed;
      },
    });
  }

  // Check for unpositioned nodes
  const unpositioned = layoutResult.statistics.nodesWithoutPosition;
  if (unpositioned > 0) {
    const unpositionedNodes = workflow.actions
      .filter(
        (a) => !a.position || (a.position[0] === 0 && a.position[1] === 0)
      )
      .map((a) => a.id);

    issues.push({
      id: "unpositioned-nodes",
      severity: "error",
      title: `${unpositioned} unpositioned node${unpositioned > 1 ? "s" : ""}`,
      description:
        "Some nodes do not have positions. Apply auto-layout to position them.",
      affectedNodes: unpositionedNodes,
      autoFixable: true,
      fix: () => {
        const fixed = JSON.parse(JSON.stringify(workflow));
        layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL);
        return fixed;
      },
    });
  }

  // Check for high edge crossings
  const crossings = layoutResult.statistics.edgeCrossings;
  if (crossings > 10) {
    issues.push({
      id: "edge-crossings",
      severity: "warning",
      title: `${crossings} edge crossings`,
      description:
        "High number of edge crossings may reduce readability. Try a different layout style.",
      affectedNodes: [],
      autoFixable: true,
      fix: () => {
        const fixed = JSON.parse(JSON.stringify(workflow));
        layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL);
        return fixed;
      },
    });
  }

  // Check for poor compactness
  if (layoutResult.statistics.compactness < 0.2) {
    issues.push({
      id: "low-compactness",
      severity: "info",
      title: "Layout is very spread out",
      description:
        "The layout is using a lot of canvas space. Consider using Tree layout for more compact arrangement.",
      affectedNodes: [],
      autoFixable: true,
      fix: () => {
        const fixed = JSON.parse(JSON.stringify(workflow));
        layoutService.applyLayout(fixed, LayoutStyle.TREE, {
          horizontalSpacing: 150,
          verticalSpacing: 100,
        });
        return fixed;
      },
    });
  } else if (layoutResult.statistics.compactness > 0.8) {
    issues.push({
      id: "high-compactness",
      severity: "info",
      title: "Layout is very dense",
      description:
        "The layout is very compact and may be hard to read. Consider increasing spacing.",
      affectedNodes: [],
      autoFixable: true,
      fix: () => {
        const fixed = JSON.parse(JSON.stringify(workflow));
        layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL, {
          horizontalSpacing: 250,
          verticalSpacing: 150,
        });
        return fixed;
      },
    });
  }

  // Check for poor readability
  if (layoutResult.statistics.readability < 0.6) {
    issues.push({
      id: "low-readability",
      severity: "warning",
      title: "Layout readability is low",
      description:
        "The layout may be hard to understand. Consider adjusting spacing or using a different layout style.",
      affectedNodes: [],
      autoFixable: true,
      fix: () => {
        const fixed = JSON.parse(JSON.stringify(workflow));
        layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL, {
          horizontalSpacing: 200,
          verticalSpacing: 120,
          minNodeSpacing: 30,
        });
        return fixed;
      },
    });
  }

  // Check for unbalanced aspect ratio
  const aspectRatio = layoutResult.statistics.boundingBoxAspectRatio;
  if (aspectRatio > 3) {
    issues.push({
      id: "wide-aspect",
      severity: "info",
      title: "Layout is very wide",
      description:
        "The layout has a wide aspect ratio. Consider using Hierarchical layout for better balance.",
      affectedNodes: [],
      autoFixable: true,
      fix: () => {
        const fixed = JSON.parse(JSON.stringify(workflow));
        layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL);
        return fixed;
      },
    });
  } else if (aspectRatio < 0.33) {
    issues.push({
      id: "tall-aspect",
      severity: "info",
      title: "Layout is very tall",
      description:
        "The layout has a tall aspect ratio. Consider using Horizontal layout for better balance.",
      affectedNodes: [],
      autoFixable: true,
      fix: () => {
        const fixed = JSON.parse(JSON.stringify(workflow));
        layoutService.applyLayout(fixed, LayoutStyle.HORIZONTAL);
        return fixed;
      },
    });
  }

  // Check for disconnected nodes
  const disconnected = findDisconnectedNodes(workflow);
  if (disconnected.length > 0) {
    issues.push({
      id: "disconnected-nodes",
      severity: "warning",
      title: `${disconnected.length} disconnected node${disconnected.length > 1 ? "s" : ""}`,
      description:
        "Some nodes are not connected to any other nodes. Verify your workflow structure.",
      affectedNodes: disconnected,
      autoFixable: false,
    });
  }

  return issues;
}

// ============================================================================
// Helper Functions
// ============================================================================

function findOverlappingNodes(workflow: Workflow): string[] {
  const overlapping: string[] = [];
  const nodeWidth = 180;
  const nodeHeight = 80;

  for (let i = 0; i < workflow.actions.length; i++) {
    for (let j = i + 1; j < workflow.actions.length; j++) {
      const a1 = workflow.actions[i];
      const a2 = workflow.actions[j];
      if (!a1 || !a2) continue;

      if (!a1.position || !a2.position) continue;

      const [x1, y1] = a1.position;
      const [x2, y2] = a2.position;

      const overlapX = Math.abs(x1 - x2) < nodeWidth;
      const overlapY = Math.abs(y1 - y2) < nodeHeight;

      if (overlapX && overlapY) {
        if (!overlapping.includes(a1.id)) overlapping.push(a1.id);
        if (!overlapping.includes(a2.id)) overlapping.push(a2.id);
      }
    }
  }

  return overlapping;
}

function findDisconnectedNodes(workflow: Workflow): string[] {
  const connected = new Set<string>();

  // Add all nodes that have connections
  for (const [sourceId, connections] of Object.entries(workflow.connections)) {
    connected.add(sourceId);

    for (const outputType of [
      "main",
      "error",
      "success",
      "parallel",
    ] as const) {
      const outputs = connections[outputType as keyof typeof connections];
      if (!outputs) continue;

      for (const conns of outputs) {
        for (const conn of conns) {
          connected.add(conn.action);
        }
      }
    }
  }

  // Find nodes that are not connected
  return workflow.actions
    .filter((action) => !connected.has(action.id))
    .map((action) => action.id);
}
