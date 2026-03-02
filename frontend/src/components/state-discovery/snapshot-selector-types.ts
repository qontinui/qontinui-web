import type { SnapshotRun } from "@/types/snapshots";

export interface SnapshotScreenshotSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (
    screenshots: Array<{ url: string; name: string; snapshotId: string }>
  ) => void;
  stateFilter?: string[];
}

export interface SnapshotScreenshot {
  path: string;
  url: string;
  active_states: string[];
  timestamp: string;
  snapshotRunId: string;
  snapshotName: string;
}

export interface ThumbnailInfo {
  url: string;
  active_states: string[];
  action_number: number;
  timestamp: string;
}

export interface ThumbnailData {
  run_id: string;
  thumbnails: ThumbnailInfo[];
  total_screenshots: number;
}

export interface SnapshotRunListProps {
  snapshots: SnapshotRun[];
  snapshotsLoading: boolean;
  selectedSnapshot: SnapshotRun | null;
  onSelectSnapshot: (snapshot: SnapshotRun) => void;
  thumbnailCache: Map<string, ThumbnailData>;
  loadingThumbnails: Set<string>;
}

export interface ScreenshotGridProps {
  selectedSnapshot: SnapshotRun | null;
  screenshots: SnapshotScreenshot[];
  loading: boolean;
  filteredScreenshots: SnapshotScreenshot[];
  selectedScreenshots: Set<string>;
  uniqueStates: string[];
  stateScreenshotCounts: Map<string, number>;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onToggleScreenshot: (path: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onSelectAllWithState: (stateName: string) => void;
}
