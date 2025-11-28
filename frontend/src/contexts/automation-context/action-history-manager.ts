import {
  State,
  StateImage,
  StateLocation,
  StateRegion,
  ActionHistory,
} from "./types";
import { ActionSnapshot } from "../../lib/integration-testing-framework";

export class ActionHistoryManager {
  /**
   * Update ActionHistory for a StateImage within a State
   */
  static updateStateImageActionHistory(
    state: State,
    stateImageId: string,
    actionHistory: ActionHistory
  ): State {
    return {
      ...state,
      stateImages: state.stateImages.map((img) =>
        img.id === stateImageId ? { ...img, actionHistory } : img
      ),
    };
  }

  /**
   * Update ActionHistory for a StateLocation within a State
   */
  static updateStateLocationActionHistory(
    state: State,
    locationId: string,
    actionHistory: ActionHistory
  ): State {
    return {
      ...state,
      locations: state.locations.map((loc) =>
        loc.id === locationId ? { ...loc, actionHistory } : loc
      ),
    };
  }

  /**
   * Update ActionHistory for a StateRegion within a State
   */
  static updateStateRegionActionHistory(
    state: State,
    regionId: string,
    actionHistory: ActionHistory
  ): State {
    return {
      ...state,
      regions: state.regions.map((reg) =>
        reg.id === regionId ? { ...reg, actionHistory } : reg
      ),
    };
  }

  /**
   * Add a snapshot to a state object's ActionHistory
   */
  static addSnapshot(
    actionHistory: ActionHistory | undefined,
    snapshot: ActionSnapshot
  ): ActionHistory {
    const history = actionHistory || { snapshots: [] };
    return {
      snapshots: [...history.snapshots, snapshot],
      lastUpdated: new Date(),
    };
  }

  /**
   * Remove a snapshot from ActionHistory
   */
  static removeSnapshot(
    actionHistory: ActionHistory | undefined,
    snapshotId: string
  ): ActionHistory {
    if (!actionHistory) {
      return { snapshots: [] };
    }
    return {
      snapshots: actionHistory.snapshots.filter((s) => s.id !== snapshotId),
      lastUpdated: new Date(),
    };
  }

  /**
   * Update a snapshot in ActionHistory
   */
  static updateSnapshot(
    actionHistory: ActionHistory | undefined,
    updatedSnapshot: ActionSnapshot
  ): ActionHistory {
    if (!actionHistory) {
      return {
        snapshots: [updatedSnapshot],
        lastUpdated: new Date(),
      };
    }
    return {
      snapshots: actionHistory.snapshots.map((s) =>
        s.id === updatedSnapshot.id ? updatedSnapshot : s
      ),
      lastUpdated: new Date(),
    };
  }

  /**
   * Clear all snapshots from ActionHistory
   */
  static clearHistory(actionHistory: ActionHistory | undefined): ActionHistory {
    return {
      snapshots: [],
      lastUpdated: new Date(),
    };
  }

  /**
   * Get snapshots for a specific screenshot
   */
  static getSnapshotsForScreenshot(
    actionHistory: ActionHistory | undefined,
    screenshotId: string
  ): ActionSnapshot[] {
    if (!actionHistory) return [];
    return actionHistory.snapshots.filter(
      (s) => s.screenshotId === screenshotId
    );
  }

  /**
   * Get snapshots that transition to a specific screenshot
   */
  static getTransitionsToScreenshot(
    actionHistory: ActionHistory | undefined,
    screenshotId: string
  ): ActionSnapshot[] {
    if (!actionHistory) return [];
    return actionHistory.snapshots.filter(
      (s) => s.nextScreenshotId === screenshotId
    );
  }

  /**
   * Merge two ActionHistories
   */
  static mergeHistories(
    history1: ActionHistory | undefined,
    history2: ActionHistory | undefined
  ): ActionHistory {
    const snapshots1 = history1?.snapshots || [];
    const snapshots2 = history2?.snapshots || [];

    // Combine snapshots, avoiding duplicates by ID
    const combinedMap = new Map<string, ActionSnapshot>();
    [...snapshots1, ...snapshots2].forEach((s) => {
      combinedMap.set(s.id, s);
    });

    return {
      snapshots: Array.from(combinedMap.values()),
      lastUpdated: new Date(),
    };
  }

  /**
   * Clone an ActionHistory (deep copy)
   */
  static cloneHistory(actionHistory: ActionHistory | undefined): ActionHistory {
    if (!actionHistory) {
      return { snapshots: [] };
    }
    return {
      snapshots: actionHistory.snapshots.map((s) => ({ ...s })),
      lastUpdated: actionHistory.lastUpdated,
    };
  }

  /**
   * Get statistics about an ActionHistory
   */
  static getStatistics(actionHistory: ActionHistory | undefined): {
    totalSnapshots: number;
    successfulSnapshots: number;
    failedSnapshots: number;
    uniqueScreenshots: number;
    hasTransitions: boolean;
  } {
    if (!actionHistory || actionHistory.snapshots.length === 0) {
      return {
        totalSnapshots: 0,
        successfulSnapshots: 0,
        failedSnapshots: 0,
        uniqueScreenshots: 0,
        hasTransitions: false,
      };
    }

    const snapshots = actionHistory.snapshots;
    const uniqueScreenshots = new Set(snapshots.map((s) => s.screenshotId));

    return {
      totalSnapshots: snapshots.length,
      successfulSnapshots: snapshots.filter(
        (s) => s.actionSuccess && s.resultSuccess
      ).length,
      failedSnapshots: snapshots.filter(
        (s) => !s.actionSuccess || !s.resultSuccess
      ).length,
      uniqueScreenshots: uniqueScreenshots.size,
      hasTransitions: snapshots.some((s) => s.nextScreenshotId !== undefined),
    };
  }
}
