// components/integration-testing/SnapshotSelector.tsx

"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSnapshotList } from "@/hooks/useSnapshotList";
import { RefreshCw } from "lucide-react";
import type { SnapshotRun } from "@/types/snapshots";

interface SnapshotSelectorProps {
  value?: SnapshotRun;
  onChange?: (snapshot: SnapshotRun | undefined) => void;
}

export function SnapshotSelector({ value, onChange }: SnapshotSelectorProps) {
  const { snapshots, loading, reload } = useSnapshotList({ autoLoad: true });

  const handleValueChange = (runId: string) => {
    const selected = snapshots.find((s) => s.run_id === runId);
    onChange?.(selected);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Select Snapshot</label>
        <Button variant="ghost" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Select
        value={value?.run_id}
        onValueChange={handleValueChange}
        disabled={loading || snapshots.length === 0}
      >
        <SelectTrigger>
          <SelectValue placeholder="Choose a snapshot..." />
        </SelectTrigger>
        <SelectContent>
          {snapshots.map((snapshot) => (
            <SelectItem key={snapshot.id} value={snapshot.run_id}>
              <div className="flex items-center justify-between w-full">
                <span>{snapshot.run_id}</span>
                <span className="text-xs text-text-muted ml-4">
                  {snapshot.total_actions} actions
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {value && (
        <div className="text-sm text-text-muted mt-2">
          <p>
            {value.successful_actions}/{value.total_actions} actions •{" "}
            {value.total_screenshots} screenshots • {value.patterns_count}{" "}
            patterns
          </p>
        </div>
      )}
    </div>
  );
}
