// components/integration-testing/SnapshotMultiSelector.tsx

"use client";

import { useSnapshotList } from "@/hooks/useSnapshotList";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Database, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { SnapshotRun } from "@/types/snapshots";

interface SnapshotMultiSelectorProps {
  selectedSnapshots: SnapshotRun[];
  onChange: (snapshots: SnapshotRun[]) => void;
}

export function SnapshotMultiSelector({
  selectedSnapshots,
  onChange,
}: SnapshotMultiSelectorProps) {
  const { snapshots, loading, error, refresh } = useSnapshotList();

  const handleToggle = (snapshot: SnapshotRun) => {
    const isSelected = selectedSnapshots.some((s) => s.id === snapshot.id);

    if (isSelected) {
      onChange(selectedSnapshots.filter((s) => s.id !== snapshot.id));
    } else {
      onChange([...selectedSnapshots, snapshot]);
    }
  };

  const handleClearAll = () => {
    onChange([]);
  };

  const totalActions = selectedSnapshots.reduce(
    (sum, s) => sum + s.total_actions,
    0
  );
  const totalScreenshots = selectedSnapshots.reduce(
    (sum, s) => sum + s.total_screenshots,
    0
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Database className="w-4 h-4" />
            Select Snapshots
          </CardTitle>
          {selectedSnapshots.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearAll}
              className="h-7 text-xs"
            >
              <X className="w-3 h-3 mr-1" />
              Clear ({selectedSnapshots.length})
            </Button>
          )}
        </div>
        {selectedSnapshots.length > 0 && (
          <div className="text-xs text-gray-600 mt-2 p-2 bg-blue-50 rounded border border-blue-200">
            <div className="font-medium text-blue-900">
              {selectedSnapshots.length} snapshot
              {selectedSnapshots.length > 1 ? "s" : ""} selected
            </div>
            <div className="text-blue-800 mt-0.5">
              Pool: {totalActions} actions, {totalScreenshots} screenshots
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex items-center justify-center py-8 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">Loading snapshots...</span>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
            Error: {error.message}
          </div>
        )}

        {!loading && !error && snapshots.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">
            <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No snapshots found</p>
            <p className="text-xs mt-1">Import a snapshot to begin</p>
          </div>
        )}

        {!loading && snapshots.length > 0 && (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {snapshots.map((snapshot) => {
              const isSelected = selectedSnapshots.some(
                (s) => s.id === snapshot.id
              );

              return (
                <div
                  key={snapshot.id}
                  className={`
                    p-3 border rounded-lg cursor-pointer transition-all
                    ${
                      isSelected
                        ? "bg-blue-50 border-blue-300 ring-1 ring-blue-300"
                        : "bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }
                  `}
                  onClick={() => handleToggle(snapshot)}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => handleToggle(snapshot)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium truncate">
                          {snapshot.run_id}
                        </div>
                        <div className="text-xs text-gray-500 whitespace-nowrap">
                          {formatDistanceToNow(new Date(snapshot.start_time), {
                            addSuffix: true,
                          })}
                        </div>
                      </div>

                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-600">
                        <span>
                          {snapshot.total_actions} action
                          {snapshot.total_actions !== 1 ? "s" : ""}
                        </span>
                        <span>•</span>
                        <span>
                          {snapshot.total_screenshots} screenshot
                          {snapshot.total_screenshots !== 1 ? "s" : ""}
                        </span>
                        <span>•</span>
                        <span className="capitalize">
                          {snapshot.execution_mode}
                        </span>
                      </div>

                      {snapshot.duration_seconds !== null && (
                        <div className="mt-1 text-xs text-gray-500">
                          Duration: {Math.round(snapshot.duration_seconds)}s
                        </div>
                      )}

                      {snapshot.tags && snapshot.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {snapshot.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
