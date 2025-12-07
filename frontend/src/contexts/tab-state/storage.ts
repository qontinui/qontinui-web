/**
 * Tab State Storage
 *
 * Single Responsibility: Handle localStorage persistence for tab states.
 * Provides type-safe load/save operations with error handling.
 */

import { TabStates } from "./types";

const STORAGE_KEY = "qontinui-tab-states";

/**
 * Load tab states from localStorage
 * @returns Stored tab states or empty object if none exist
 */
export function loadTabStates(): TabStates {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as TabStates;
    }
  } catch (error) {
    console.error("[TabStateStorage] Failed to load tab states:", error);
  }

  return {};
}

/**
 * Save tab states to localStorage
 * @param states Tab states to persist
 */
export function saveTabStates(states: TabStates): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
  } catch (error) {
    console.error("[TabStateStorage] Failed to save tab states:", error);
  }
}

/**
 * Clear all tab states from localStorage
 */
export function clearTabStates(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("[TabStateStorage] Failed to clear tab states:", error);
  }
}
