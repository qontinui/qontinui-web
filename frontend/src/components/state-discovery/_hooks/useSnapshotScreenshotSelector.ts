import { useState, useEffect, useMemo, useCallback } from "react";
import { useSnapshotList } from "@/hooks/useSnapshotList";
import { useQuery, useQueries } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SnapshotRun } from "@/types/snapshots";
import type {
  SnapshotScreenshot,
  ThumbnailData,
} from "../snapshot-selector-types";

const DEFAULT_STATE_FILTER: string[] = [];

export function useSnapshotScreenshotSelector(
  isOpen: boolean,
  stateFilter: string[] = DEFAULT_STATE_FILTER
) {
  const { snapshots, loading: snapshotsLoading } = useSnapshotList();
  const [selectedSnapshot, setSelectedSnapshot] = useState<SnapshotRun | null>(
    null
  );
  const [selectedScreenshots, setSelectedScreenshots] = useState<Set<string>>(
    new Set()
  );
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setSelectedSnapshot(null);
      setSelectedScreenshots(new Set());
      setSearchQuery("");
    }
  }, [isOpen]);

  // Load thumbnails for each snapshot in parallel using useQueries
  const thumbnailQueries = useQueries({
    queries: (isOpen && !snapshotsLoading ? snapshots : []).map((snapshot) => ({
      queryKey: ["snapshotThumbnails", snapshot.run_id] as const,
      queryFn: async ({
        signal,
      }: {
        signal: AbortSignal;
      }): Promise<ThumbnailData> => {
        const response = await fetch(
          `/api/integration-testing/snapshots/${snapshot.run_id}/thumbnails?limit=4`,
          { signal }
        );
        if (!response.ok) {
          throw new Error("Failed to load thumbnails");
        }
        return response.json();
      },
      staleTime: 5 * 60 * 1000,
      enabled: isOpen && !snapshotsLoading,
    })),
  });

  const thumbnailCache = useMemo(() => {
    const cache = new Map<string, ThumbnailData>();
    if (!isOpen || snapshotsLoading) return cache;
    snapshots.forEach((snapshot, idx) => {
      const query = thumbnailQueries[idx];
      if (query?.data) {
        cache.set(snapshot.run_id, query.data);
      }
    });
    return cache;
  }, [isOpen, snapshotsLoading, snapshots, thumbnailQueries]);

  const loadingThumbnails = useMemo(() => {
    const loading = new Set<string>();
    if (!isOpen || snapshotsLoading) return loading;
    snapshots.forEach((snapshot, idx) => {
      const query = thumbnailQueries[idx];
      if (query?.isLoading) {
        loading.add(snapshot.run_id);
      }
    });
    return loading;
  }, [isOpen, snapshotsLoading, snapshots, thumbnailQueries]);

  // Load screenshots when snapshot is selected
  const { data: screenshots = [], isLoading: loading } = useQuery({
    queryKey: ["snapshotScreenshots", selectedSnapshot?.run_id],
    queryFn: async ({ signal }): Promise<SnapshotScreenshot[]> => {
      const response = await fetch(
        `/api/integration-testing/snapshots/${selectedSnapshot!.run_id}/screenshots`,
        { signal }
      );
      if (!response.ok) {
        throw new Error("Failed to load screenshots");
      }
      const data = await response.json();
      return data.screenshots.map(
        (s: {
          screenshot_path: string;
          active_states: string[];
          timestamp: string;
        }) => ({
          path: s.screenshot_path,
          url: `/api/integration-testing/snapshots/${selectedSnapshot!.run_id}/screenshot/${s.screenshot_path}`,
          active_states: s.active_states,
          timestamp: s.timestamp,
          snapshotRunId: selectedSnapshot!.run_id,
          snapshotName: selectedSnapshot!.run_id.substring(0, 8),
        })
      );
    },
    enabled: !!selectedSnapshot,
    staleTime: 60 * 1000,
  });

  const uniqueStates = useMemo(() => {
    const states = new Set<string>();
    screenshots.forEach((s) =>
      s.active_states.forEach((state) => states.add(state))
    );
    return Array.from(states).sort();
  }, [screenshots]);

  const stateScreenshotCounts = useMemo(() => {
    const counts = new Map<string, number>();
    uniqueStates.forEach((state) => {
      const count = screenshots.filter((s) =>
        s.active_states.includes(state)
      ).length;
      counts.set(state, count);
    });
    return counts;
  }, [screenshots, uniqueStates]);

  const filteredScreenshots = useMemo(() => {
    return screenshots.filter((screenshot) => {
      if (stateFilter && stateFilter.length > 0) {
        const hasAllStates = stateFilter.every((filterState) =>
          screenshot.active_states.includes(filterState)
        );
        if (!hasAllStates) return false;
      }

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          screenshot.path.toLowerCase().includes(query) ||
          screenshot.active_states.some((state) =>
            state.toLowerCase().includes(query)
          )
        );
      }

      return true;
    });
  }, [screenshots, stateFilter, searchQuery]);

  const toggleScreenshot = useCallback(
    (path: string) => {
      const newSelection = new Set(selectedScreenshots);
      if (newSelection.has(path)) {
        newSelection.delete(path);
      } else {
        newSelection.add(path);
      }
      setSelectedScreenshots(newSelection);
    },
    [selectedScreenshots]
  );

  const handleSelectAll = useCallback(() => {
    const allPaths = new Set(filteredScreenshots.map((s) => s.path));
    setSelectedScreenshots(allPaths);
  }, [filteredScreenshots]);

  const handleClearAll = useCallback(() => {
    setSelectedScreenshots(new Set());
  }, []);

  const handleSelectAllWithState = useCallback(
    (stateName: string) => {
      const screenshotsWithState = screenshots
        .filter((s) => s.active_states.includes(stateName))
        .map((s) => s.path);
      setSelectedScreenshots(new Set(screenshotsWithState));
      toast.success(
        `Selected ${screenshotsWithState.length} screenshots with ${stateName}`
      );
    },
    [screenshots]
  );

  const getSelectedForConfirm = useCallback(() => {
    return screenshots
      .filter((s) => selectedScreenshots.has(s.path))
      .map((s) => ({
        url: s.url,
        name: `${s.snapshotName}_${s.path.split("/").pop()}`,
        snapshotId: s.snapshotRunId,
      }));
  }, [screenshots, selectedScreenshots]);

  return {
    snapshots,
    snapshotsLoading,
    selectedSnapshot,
    setSelectedSnapshot,
    selectedScreenshots,
    searchQuery,
    setSearchQuery,
    thumbnailCache,
    loadingThumbnails,
    screenshots,
    loading,
    uniqueStates,
    stateScreenshotCounts,
    filteredScreenshots,
    toggleScreenshot,
    handleSelectAll,
    handleClearAll,
    handleSelectAllWithState,
    getSelectedForConfirm,
  };
}
