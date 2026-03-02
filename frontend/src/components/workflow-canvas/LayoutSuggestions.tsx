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

import React from "react";
import { useLayoutSuggestions } from "./_hooks/use-layout-suggestions";
import { IssueCard } from "./_components/IssueCard";
import { SuggestionsHeader } from "./_components/SuggestionsHeader";
import { NoIssuesMessage } from "./_components/NoIssuesMessage";

// Re-export types for public API compatibility
export type { LayoutSuggestionsProps } from "./_components/LayoutSuggestionsTypes";
import type { LayoutSuggestionsProps } from "./_components/LayoutSuggestionsTypes";

export function LayoutSuggestions({
  workflow,
  layoutResult,
  onApplySuggestion,
}: LayoutSuggestionsProps) {
  const {
    activeIssues,
    expandedIssue,
    counts,
    handleFixIssue,
    handleFixAll,
    handleDismiss,
    handleDismissAll,
    toggleExpand,
  } = useLayoutSuggestions(workflow, layoutResult, onApplySuggestion);

  if (activeIssues.length === 0) {
    return <NoIssuesMessage />;
  }

  return (
    <div className="layout-suggestions">
      <SuggestionsHeader
        counts={counts}
        onFixAll={handleFixAll}
        onDismissAll={handleDismissAll}
      />

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
