/**
 * Hook for layout suggestion state management and actions.
 *
 * Encapsulates issue detection, dismissal state, expansion state,
 * and fix/dismiss action handlers.
 */

import { useState, useMemo } from "react";
import type { Workflow } from "@/lib/action-schema/action-types";
import {
  getLayoutService,
  type LayoutPreviewResult,
} from "@/services/layout-service";
import { detectIssues } from "../_components/layout-issue-detection";
import type {
  LayoutIssue,
  IssueCounts,
} from "../_components/LayoutSuggestionsTypes";

export function useLayoutSuggestions(
  workflow: Workflow,
  layoutResult: LayoutPreviewResult,
  onApplySuggestion: (fixedWorkflow: Workflow) => void
) {
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

  const counts: IssueCounts = {
    errorCount: activeIssues.filter((i) => i.severity === "error").length,
    warningCount: activeIssues.filter((i) => i.severity === "warning").length,
    infoCount: activeIssues.filter((i) => i.severity === "info").length,
    autoFixableCount: activeIssues.filter((i) => i.autoFixable).length,
  };

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

  return {
    activeIssues,
    expandedIssue,
    counts,
    handleFixIssue,
    handleFixAll,
    handleDismiss,
    handleDismissAll,
    toggleExpand,
  };
}
