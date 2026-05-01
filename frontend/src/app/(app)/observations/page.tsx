"use client";

import { ObservationBrowser } from "@/components/observations/ObservationBrowser";

export default function ObservationsPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <div className="px-6 py-4 border-b border-border-subtle/50">
        <h1 className="text-lg font-semibold">Observations</h1>
        <p className="text-sm text-text-muted">
          Browse cross-session knowledge with temporal filtering and revision
          history.
        </p>
      </div>
      <ObservationBrowser />
    </div>
  );
}
