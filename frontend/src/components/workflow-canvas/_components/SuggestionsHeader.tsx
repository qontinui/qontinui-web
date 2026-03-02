/**
 * SuggestionsHeader - Displays issue count badges and bulk action buttons.
 */

import React from "react";
import type { IssueCounts } from "./LayoutSuggestionsTypes";

interface SuggestionsHeaderProps {
  counts: IssueCounts;
  onFixAll: () => void;
  onDismissAll: () => void;
}

export function SuggestionsHeader({
  counts,
  onFixAll,
  onDismissAll,
}: SuggestionsHeaderProps) {
  const { errorCount, warningCount, infoCount, autoFixableCount } = counts;

  return (
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
          <button className="fix-all-button" onClick={onFixAll}>
            Fix All ({autoFixableCount})
          </button>
        )}
        <button className="dismiss-all-button" onClick={onDismissAll}>
          Dismiss All
        </button>
      </div>
    </div>
  );
}
