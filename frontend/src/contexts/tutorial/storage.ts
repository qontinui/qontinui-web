/**
 * Tutorial State Persistence
 *
 * SSR-safe localStorage persistence for tutorial state.
 * Isolated storage module following qontinui-web patterns.
 */

import type {
  PersistedTutorialState,
  TutorialProgress,
} from "@/types/tutorial";

const STORAGE_KEY = "qontinui-web-tutorial-state";

/**
 * Default persisted state
 */
const defaultState: PersistedTutorialState = {
  completedTutorials: [],
  inProgressTutorials: [],
  dontShowAgain: false,
  progressRecords: {},
};

/**
 * Check if we're running in the browser
 */
function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * Load tutorial state from localStorage
 * Returns default state if not found or on SSR
 */
export function loadState(): PersistedTutorialState {
  if (!isBrowser()) {
    return defaultState;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return defaultState;
    }

    const parsed = JSON.parse(stored) as Partial<PersistedTutorialState>;

    // Merge with defaults to handle missing fields from older versions
    return {
      completedTutorials:
        parsed.completedTutorials ?? defaultState.completedTutorials,
      inProgressTutorials:
        parsed.inProgressTutorials ?? defaultState.inProgressTutorials,
      dontShowAgain: parsed.dontShowAgain ?? defaultState.dontShowAgain,
      progressRecords: parsed.progressRecords ?? defaultState.progressRecords,
    };
  } catch (error) {
    console.error("Failed to load tutorial state:", error);
    return defaultState;
  }
}

/**
 * Save tutorial state to localStorage
 */
export function saveState(state: PersistedTutorialState): void {
  if (!isBrowser()) {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Failed to save tutorial state:", error);
  }
}

/**
 * Clear all tutorial state from localStorage
 */
export function clearState(): void {
  if (!isBrowser()) {
    return;
  }

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("Failed to clear tutorial state:", error);
  }
}

/**
 * Update a specific tutorial's progress
 */
export function updateProgress(
  tutorialId: string,
  progress: TutorialProgress
): void {
  const state = loadState();
  state.progressRecords[tutorialId] = progress;
  saveState(state);
}

/**
 * Get progress for a specific tutorial
 */
export function getProgress(tutorialId: string): TutorialProgress | null {
  const state = loadState();
  return state.progressRecords[tutorialId] ?? null;
}

/**
 * Mark a tutorial as completed
 */
export function markCompleted(tutorialId: string): void {
  const state = loadState();

  // Add to completed if not already there
  if (!state.completedTutorials.includes(tutorialId)) {
    state.completedTutorials.push(tutorialId);
  }

  // Remove from in-progress
  state.inProgressTutorials = state.inProgressTutorials.filter(
    (id) => id !== tutorialId
  );

  saveState(state);
}

/**
 * Mark a tutorial as in-progress
 */
export function markInProgress(tutorialId: string): void {
  const state = loadState();

  // Add to in-progress if not already there or completed
  if (
    !state.inProgressTutorials.includes(tutorialId) &&
    !state.completedTutorials.includes(tutorialId)
  ) {
    state.inProgressTutorials.push(tutorialId);
  }

  saveState(state);
}

/**
 * Check if a tutorial has been completed
 */
export function isCompleted(tutorialId: string): boolean {
  const state = loadState();
  return state.completedTutorials.includes(tutorialId);
}

/**
 * Check if a tutorial is in progress
 */
export function isInProgress(tutorialId: string): boolean {
  const state = loadState();
  return state.inProgressTutorials.includes(tutorialId);
}

/**
 * Set the "don't show again" preference
 */
export function setDontShowAgain(value: boolean): void {
  const state = loadState();
  state.dontShowAgain = value;
  saveState(state);
}

/**
 * Get the "don't show again" preference
 */
export function getDontShowAgain(): boolean {
  const state = loadState();
  return state.dontShowAgain;
}
