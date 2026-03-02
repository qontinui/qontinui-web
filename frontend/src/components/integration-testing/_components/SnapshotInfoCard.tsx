"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SnapshotRun } from "@/types/snapshots";

interface SnapshotInfoCardProps {
  selectedSnapshots: SnapshotRun[];
}

export function SnapshotInfoCard({ selectedSnapshots }: SnapshotInfoCardProps) {
  if (!selectedSnapshots || selectedSnapshots.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">
          Selected Snapshots ({selectedSnapshots.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xs space-y-2">
          {selectedSnapshots.map((snapshot, index) => (
            <div
              key={snapshot.id}
              className="p-2 bg-surface-canvas rounded border"
            >
              <div className="font-medium mb-1">Snapshot {index + 1}</div>
              <div className="space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-text-muted">Run ID:</span>
                  <span className="font-mono text-xs">
                    {snapshot.run_id.slice(0, 8)}...
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Actions:</span>
                  <span>{snapshot.total_actions}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Screenshots:</span>
                  <span>{snapshot.total_screenshots}</span>
                </div>
              </div>
            </div>
          ))}
          <div className="pt-2 border-t">
            <div className="flex justify-between font-medium">
              <span>Total Pool Size:</span>
              <span>
                {selectedSnapshots.reduce((sum, s) => sum + s.total_actions, 0)}{" "}
                actions,{" "}
                {selectedSnapshots.reduce(
                  (sum, s) => sum + s.total_screenshots,
                  0
                )}{" "}
                screenshots
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
