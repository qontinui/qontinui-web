/**
 * NoIssuesMessage - Success state when no layout issues are detected.
 */

import React from "react";

export function NoIssuesMessage() {
  return (
    <div className="layout-suggestions no-issues">
      <div className="success-message">
        <span className="success-icon">{"\u2713"}</span>
        <span>No layout issues detected</span>
      </div>
    </div>
  );
}
