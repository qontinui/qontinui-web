/**
 * State manager for State Discovery
 * Single Responsibility: Manage local state for state images and discovered states
 */

import { createLogger } from "@/lib/logger";
import { StateImage, DiscoveredState } from "@/types/stateDiscovery";

const logger = createLogger("StateManager");

export class StateDiscoveryStateManager {
  private stateImages: StateImage[] = [];
  private states: DiscoveredState[] = [];
  private listeners: Set<(type: string, data: unknown) => void> = new Set();

  constructor() {
    logger.debug("Initialized");
  }

  // Subscribe to state changes
  subscribe(listener: (type: string, data: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(type: string, data: unknown): void {
    this.listeners.forEach((listener) => listener(type, data));
  }

  // State Images Management
  getStateImages(): StateImage[] {
    return this.stateImages;
  }

  setStateImages(stateImages: StateImage[]): void {
    logger.debug("Setting state images:", stateImages.length);
    this.stateImages = stateImages;
    this.notify("stateImages", this.stateImages);
  }

  addStateImage(stateImage: StateImage): void {
    logger.debug("Adding state image:", stateImage.id);
    this.stateImages.push(stateImage);
    this.notify("stateImages", this.stateImages);
  }

  updateStateImage(stateImageId: string, updates: Partial<StateImage>): void {
    logger.debug("Updating state image:", {
      id: stateImageId,
      updates,
    });

    this.stateImages = this.stateImages.map((si) =>
      si.id === stateImageId ? { ...si, ...updates } : si
    );
    this.notify("stateImages", this.stateImages);
  }

  removeStateImage(stateImageId: string): void {
    logger.debug("Removing state image:", stateImageId);

    const before = this.stateImages.length;
    this.stateImages = this.stateImages.filter((si) => si.id !== stateImageId);

    logger.debug("State images after removal:", {
      before,
      after: this.stateImages.length,
    });

    // Also update states to remove references
    this.removeStateImageFromStates(stateImageId);

    this.notify("stateImages", this.stateImages);
  }

  bulkRemoveStateImages(ids: string[]): void {
    logger.debug("Bulk removing state images:", ids.length);

    const idsSet = new Set(ids);
    const before = this.stateImages.length;

    this.stateImages = this.stateImages.filter((si) => !idsSet.has(si.id));

    logger.debug("State images after bulk removal:", {
      before,
      after: this.stateImages.length,
      removed: before - this.stateImages.length,
    });

    // Also update states to remove references
    ids.forEach((id) => this.removeStateImageFromStates(id));

    this.notify("stateImages", this.stateImages);
  }

  // States Management
  getStates(): DiscoveredState[] {
    return this.states;
  }

  setStates(states: DiscoveredState[]): void {
    logger.debug("Setting states:", states.length);
    this.states = states;
    this.notify("states", this.states);
  }

  private removeStateImageFromStates(stateImageId: string): void {
    const before = this.states.length;

    this.states = this.states
      .map((state) => ({
        ...state,
        stateImageIds: state.stateImageIds.filter((id) => id !== stateImageId),
      }))
      .filter((state) => state.stateImageIds.length > 0);

    const after = this.states.length;
    if (before !== after) {
      logger.debug("States after state image removal:", {
        before,
        after,
        removedStates: before - after,
      });
      this.notify("states", this.states);
    }
  }

  // Clear all state
  clear(): void {
    logger.debug("Clearing all state");
    this.stateImages = [];
    this.states = [];
    this.notify("clear", null);
  }

  // Get statistics
  getStatistics(): {
    stateImagesCount: number;
    statesCount: number;
    averageStateImagesPerState: number;
  } {
    const statesWithImages = this.states.filter(
      (s) => s.stateImageIds.length > 0
    );
    const totalStateImages = statesWithImages.reduce(
      (sum, s) => sum + s.stateImageIds.length,
      0
    );

    return {
      stateImagesCount: this.stateImages.length,
      statesCount: this.states.length,
      averageStateImagesPerState:
        statesWithImages.length > 0
          ? totalStateImages / statesWithImages.length
          : 0,
    };
  }
}
