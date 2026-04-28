/**
 * Type definitions for ExplorationConfigPanel and its sub-components.
 */

import type {
  BrowserTab,
  ExplorationProgress,
  TargetType,
  UIBridgeExplorationConfig,
} from "@/hooks/useUIBridgeExploration";
import type { Runner } from "@qontinui/shared-types";

export interface ExplorationConfigPanelProps {
  config: UIBridgeExplorationConfig;
  onConfigChange: (updates: Partial<UIBridgeExplorationConfig>) => void;
  progress: ExplorationProgress;
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
  /** Available runners (online). */
  runners: Runner[];
  /** Whether runners are loading */
  runnersLoading: boolean;
  /** Currently selected runner ID (UUID) */
  selectedRunnerId: string | null;
  /** Handler for runner selection change */
  onRunnerChange: (runnerId: string | null) => void;
  /** Browser tabs available for extension exploration */
  browserTabs?: BrowserTab[];
  /** Whether browser tabs are loading */
  browserTabsLoading?: boolean;
  /** Error fetching browser tabs */
  browserTabsError?: string | null;
  /** Handler to refresh browser tabs */
  onRefreshBrowserTabs?: () => void;
  /** Handler to select a browser tab */
  onSelectBrowserTab?: (tabId: number | null) => void;
  /** Hide the runner section (when parent already handles runner selection) */
  hideRunnerSection?: boolean;
}

export interface TargetTypeRequirement {
  title: string;
  requirements: string[];
  icon: React.ReactNode;
  recommended?: boolean;
}

export const DEFAULT_BROWSER_TABS: BrowserTab[] = [];

export type {
  BrowserTab,
  ExplorationProgress,
  TargetType,
  UIBridgeExplorationConfig,
};
export type { Runner };
