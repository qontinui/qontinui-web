import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SnapshotRun } from "@/types/snapshots";
import type {
  SnapshotScreenshot,
  Region,
} from "@/types/direct-pattern-creation";

interface APIScreenshot {
  screenshot_path: string;
  active_states?: string[];
  timestamp: string;
  width?: number;
  height?: number;
}

export function useDirectPatternScreenshots() {
  const [selectedSnapshots, setSelectedSnapshots] = useState<SnapshotRun[]>([]);
  const [currentScreenshotIndex, setCurrentScreenshotIndex] = useState(0);
  const [prevSnapshotRunIds, setPrevSnapshotRunIds] = useState<string[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);

  const snapshotRunIds = selectedSnapshots.map((s) => s.run_id).sort();

  const { data: screenshots = [], isLoading: loadingScreenshots } = useQuery({
    queryKey: ["directPatternScreenshots", snapshotRunIds],
    queryFn: async ({ signal }): Promise<SnapshotScreenshot[]> => {
      const allScreenshots: SnapshotScreenshot[] = [];

      for (const snapshot of selectedSnapshots) {
        const response = await fetch(
          `/api/integration-testing/snapshots/${snapshot.run_id}/screenshots`,
          { signal }
        );

        if (!response.ok) {
          throw new Error(`Failed to load screenshots for ${snapshot.run_id}`);
        }

        const data = await response.json();

        const screenshotList: SnapshotScreenshot[] = data.screenshots.map(
          (s: APIScreenshot, idx: number) => ({
            id: `${snapshot.run_id}_${idx}`,
            path: s.screenshot_path,
            url: `/api/integration-testing/snapshots/${snapshot.run_id}/screenshot/${s.screenshot_path}`,
            active_states: s.active_states || [],
            timestamp: s.timestamp,
            snapshotRunId: snapshot.run_id,
            snapshotName: snapshot.run_id.substring(0, 8),
            width: s.width,
            height: s.height,
          })
        );

        allScreenshots.push(...screenshotList);
      }

      toast.success(
        `Loaded ${allScreenshots.length} screenshots from ${selectedSnapshots.length} snapshot(s)`
      );
      return allScreenshots;
    },
    enabled: selectedSnapshots.length > 0,
    staleTime: 60 * 1000,
  });

  const currentRunIds = snapshotRunIds.join(",");
  const prevRunIds = prevSnapshotRunIds.join(",");
  if (currentRunIds !== prevRunIds) {
    setPrevSnapshotRunIds(snapshotRunIds);
    setCurrentScreenshotIndex(0);
  }

  const currentScreenshot = screenshots[currentScreenshotIndex];

  const goToPrevious = () => {
    setCurrentScreenshotIndex((prev) => Math.max(0, prev - 1));
    setSelectedRegion(null);
  };

  const goToNext = () => {
    setCurrentScreenshotIndex((prev) =>
      Math.min(screenshots.length - 1, prev + 1)
    );
    setSelectedRegion(null);
  };

  return {
    selectedSnapshots,
    setSelectedSnapshots,
    screenshots,
    loadingScreenshots,
    currentScreenshotIndex,
    currentScreenshot,
    selectedRegion,
    setSelectedRegion,
    goToPrevious,
    goToNext,
  };
}
