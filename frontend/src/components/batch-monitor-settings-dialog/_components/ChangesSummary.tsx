"use client";

import React from "react";

interface ChangesSummaryProps {
  modifiedCount: number;
}

export function ChangesSummary({ modifiedCount }: ChangesSummaryProps) {
  if (modifiedCount === 0) return null;

  return (
    <div className="bg-blue-950/30 border border-blue-800 rounded-lg p-3">
      <p className="text-sm text-blue-400">
        {modifiedCount} state(s) will be updated. Monitor settings will be
        applied to all state images within these states.
      </p>
    </div>
  );
}
