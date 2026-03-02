/**
 * IssueCard - Displays a single layout issue with severity, details, and actions.
 */

import React from "react";
import type { LayoutIssue } from "./LayoutSuggestionsTypes";

interface IssueCardProps {
  issue: LayoutIssue;
  expanded: boolean;
  onToggleExpand: () => void;
  onFix: () => void;
  onDismiss: () => void;
}

export function IssueCard({
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
            {issue.severity === "error" && "\u26A0\uFE0F"}
            {issue.severity === "warning" && "\u26A0"}
            {issue.severity === "info" && "\u2139\uFE0F"}
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
          <button className="expand-button">
            {expanded ? "\u25BC" : "\u25B6"}
          </button>
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
