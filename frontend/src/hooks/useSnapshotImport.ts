// hooks/useSnapshotImport.ts

import { useState } from "react";
import { importSnapshot } from "@/lib/api/snapshots";
import type { ImportSnapshotRequest, SnapshotRun } from "@/types/snapshots";

export function useSnapshotImport() {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastImported, setLastImported] = useState<SnapshotRun | null>(null);

  const importSnapshotDirectory = async (request: ImportSnapshotRequest) => {
    setImporting(true);
    setError(null);

    try {
      const snapshot = await importSnapshot(request);
      setLastImported(snapshot);
      return snapshot;
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error");
      setError(error);
      throw error;
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setError(null);
    setLastImported(null);
  };

  return {
    importing,
    error,
    lastImported,
    importSnapshotDirectory,
    reset,
  };
}
