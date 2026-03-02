import React from "react";

export const EmptyPatternState: React.FC = () => (
  <div className="h-full flex items-center justify-center text-text-muted">
    <div className="text-center">
      <svg
        className="w-16 h-16 mx-auto mb-4 text-text-secondary"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
        />
      </svg>
      <p className="text-lg font-medium">No Pattern Selected</p>
      <p className="text-sm mt-1">
        Select a pattern from the list to view details
      </p>
    </div>
  </div>
);
