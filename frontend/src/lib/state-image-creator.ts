import type { StateImage, State, SearchRegion } from '@/contexts/automation-context/types';

export interface StateImageCreationOptions {
  name: string;
  image: string; // Base64 data URL
  mask?: string; // Base64 data URL for mask (optional)
  source: string; // Source identifier (e.g., 'pattern-optimization', 'image-extraction')
  fixed?: boolean;
  searchRegion?: SearchRegion; // Optional search region to add to the pattern
}

export interface StateImageCreationResult {
  stateImage: StateImage;
  targetState?: State; // If creating/updating a state
  action: 'create-state' | 'update-state' | 'stateimage-only';
}

/**
 * Creates a StateImage object with proper pattern-based structure
 */
export function createStateImage(options: StateImageCreationOptions): StateImage {
  const { name, image, mask, source, fixed = false, searchRegion } = options;

  // Create the pattern with search regions
  const searchRegions = searchRegion ? [searchRegion] : [];

  const pattern = {
    id: `pattern_${Date.now()}`,
    name,
    image,
    mask,
    searchRegions,
    fixed,
  };

  return {
    id: `stateimage-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    patterns: [pattern],
    shared: false,
    source,
  };
}

/**
 * Creates a new state with the given StateImage
 */
export function createStateWithImage(
  stateImage: StateImage,
  stateName?: string
): State {
  return {
    id: `state-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: stateName || `State with ${stateImage.name}`,
    description: `Created from ${stateImage.source}`,
    initial: false,
    stateImages: [stateImage],
    regions: [],
    locations: [],
    strings: [],
    position: { x: 100, y: 100 },
  };
}

/**
 * Adds a StateImage to an existing state
 */
export function addStateImageToState(
  state: State,
  stateImage: StateImage
): State {
  return {
    ...state,
    stateImages: [...(state.stateImages || []), stateImage],
  };
}

/**
 * Prepares a complete creation result based on target selection
 */
export function prepareStateImageCreation(
  options: StateImageCreationOptions,
  targetStateId: string | 'new',
  existingStates: State[],
  newStateName: string | undefined
): StateImageCreationResult {
  const stateImage = createStateImage(options);

  if (targetStateId === 'new') {
    return {
      stateImage,
      targetState: createStateWithImage(stateImage, newStateName),
      action: 'create-state',
    };
  } else if (targetStateId) {
    const existingState = existingStates.find(s => s.id === targetStateId);
    if (existingState) {
      return {
        stateImage,
        targetState: addStateImageToState(existingState, stateImage),
        action: 'update-state',
      };
    }
  }

  return {
    stateImage,
    action: 'stateimage-only',
  };
}
