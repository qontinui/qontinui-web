/**
 * State manager for State Discovery
 * Single Responsibility: Manage local state for state images and discovered states
 */

import { StateImage, DiscoveredState } from '@/types/stateDiscovery';

export class StateDiscoveryStateManager {
  private stateImages: StateImage[] = [];
  private states: DiscoveredState[] = [];
  private listeners: Set<(type: string, data: any) => void> = new Set();

  constructor() {
    console.log('[StateManager] Initialized');
  }

  // Subscribe to state changes
  subscribe(listener: (type: string, data: any) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(type: string, data: any): void {
    this.listeners.forEach(listener => listener(type, data));
  }

  // State Images Management
  getStateImages(): StateImage[] {
    return this.stateImages;
  }

  setStateImages(stateImages: StateImage[]): void {
    console.log('[StateManager] Setting state images:', stateImages.length);
    this.stateImages = stateImages;
    this.notify('stateImages', this.stateImages);
  }

  addStateImage(stateImage: StateImage): void {
    console.log('[StateManager] Adding state image:', stateImage.id);
    this.stateImages.push(stateImage);
    this.notify('stateImages', this.stateImages);
  }

  updateStateImage(stateImageId: string, updates: Partial<StateImage>): void {
    console.log('[StateManager] Updating state image:', {
      id: stateImageId,
      updates
    });

    this.stateImages = this.stateImages.map(si =>
      si.id === stateImageId ? { ...si, ...updates } : si
    );
    this.notify('stateImages', this.stateImages);
  }

  removeStateImage(stateImageId: string): void {
    console.log('[StateManager] Removing state image:', stateImageId);

    const before = this.stateImages.length;
    this.stateImages = this.stateImages.filter(si => si.id !== stateImageId);

    console.log('[StateManager] State images after removal:', {
      before,
      after: this.stateImages.length
    });

    // Also update states to remove references
    this.removeStateImageFromStates(stateImageId);

    this.notify('stateImages', this.stateImages);
  }

  bulkRemoveStateImages(ids: string[]): void {
    console.log('[StateManager] Bulk removing state images:', ids.length);

    const idsSet = new Set(ids);
    const before = this.stateImages.length;

    this.stateImages = this.stateImages.filter(si => !idsSet.has(si.id));

    console.log('[StateManager] State images after bulk removal:', {
      before,
      after: this.stateImages.length,
      removed: before - this.stateImages.length
    });

    // Also update states to remove references
    ids.forEach(id => this.removeStateImageFromStates(id));

    this.notify('stateImages', this.stateImages);
  }

  // States Management
  getStates(): DiscoveredState[] {
    return this.states;
  }

  setStates(states: DiscoveredState[]): void {
    console.log('[StateManager] Setting states:', states.length);
    this.states = states;
    this.notify('states', this.states);
  }

  private removeStateImageFromStates(stateImageId: string): void {
    const before = this.states.length;

    this.states = this.states.map(state => ({
      ...state,
      stateImageIds: state.stateImageIds.filter(id => id !== stateImageId)
    })).filter(state => state.stateImageIds.length > 0);

    const after = this.states.length;
    if (before !== after) {
      console.log('[StateManager] States after state image removal:', {
        before,
        after,
        removedStates: before - after
      });
      this.notify('states', this.states);
    }
  }

  // Clear all state
  clear(): void {
    console.log('[StateManager] Clearing all state');
    this.stateImages = [];
    this.states = [];
    this.notify('clear', null);
  }

  // Get statistics
  getStatistics(): {
    stateImagesCount: number;
    statesCount: number;
    averageStateImagesPerState: number;
  } {
    const statesWithImages = this.states.filter(s => s.stateImageIds.length > 0);
    const totalStateImages = statesWithImages.reduce(
      (sum, s) => sum + s.stateImageIds.length,
      0
    );

    return {
      stateImagesCount: this.stateImages.length,
      statesCount: this.states.length,
      averageStateImagesPerState: statesWithImages.length > 0
        ? totalStateImages / statesWithImages.length
        : 0
    };
  }
}
