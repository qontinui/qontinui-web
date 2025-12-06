/**
 * Properties Panel Store - Zustand state management for the properties panel
 *
 * Manages the state of the properties panel including:
 * - Panel visibility and layout
 * - Collapsed sections
 * - Unsaved changes tracking
 * - Panel dimensions and position
 */

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

// ============================================================================
// Types
// ============================================================================

export type PanelPosition = "right" | "bottom" | "floating";

export interface UnsavedChange {
  actionId: string;
  property: string;
  oldValue: any;
  newValue: any;
  timestamp: number;
}

export interface PropertiesPanelState {
  // Panel visibility and layout
  isOpen: boolean;
  position: PanelPosition;

  // Panel dimensions
  width: number; // for right position
  height: number; // for bottom position

  // Floating panel
  floatingPosition: { x: number; y: number };
  floatingSize: { width: number; height: number };

  // Collapsed sections
  collapsedSections: Set<string>;

  // Unsaved changes tracking
  unsavedChanges: Map<string, UnsavedChange[]>;
  hasUnsavedChanges: boolean;

  // Auto-save settings
  autoSave: boolean;
  autoSaveDelay: number; // ms

  // Active tab/section
  activeSection: string | null;
}

export interface PropertiesPanelActions {
  // Panel visibility
  toggleOpen: () => void;
  setOpen: (isOpen: boolean) => void;

  // Position and size
  setPosition: (position: PanelPosition) => void;
  setWidth: (width: number) => void;
  setHeight: (height: number) => void;
  setFloatingPosition: (x: number, y: number) => void;
  setFloatingSize: (width: number, height: number) => void;

  // Sections
  toggleSection: (sectionId: string) => void;
  collapseSection: (sectionId: string) => void;
  expandSection: (sectionId: string) => void;
  setActiveSection: (sectionId: string | null) => void;

  // Unsaved changes
  recordChange: (
    actionId: string,
    property: string,
    oldValue: any,
    newValue: any
  ) => void;
  clearChanges: (actionId?: string) => void;
  discardChanges: (actionId?: string) => void;
  hasChangesForAction: (actionId: string) => boolean;
  getChangesForAction: (actionId: string) => UnsavedChange[];

  // Auto-save
  setAutoSave: (enabled: boolean) => void;
  setAutoSaveDelay: (delay: number) => void;

  // Reset
  reset: () => void;
}

export type PropertiesPanelStore = PropertiesPanelState &
  PropertiesPanelActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: PropertiesPanelState = {
  isOpen: true,
  position: "right",

  width: 400,
  height: 300,

  floatingPosition: { x: 100, y: 100 },
  floatingSize: { width: 400, height: 600 },

  collapsedSections: new Set(),

  unsavedChanges: new Map(),
  hasUnsavedChanges: false,

  autoSave: true,
  autoSaveDelay: 500,

  activeSection: null,
};

// ============================================================================
// Store
// ============================================================================

export const usePropertiesPanelStore = create<PropertiesPanelStore>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        // ========================================================================
        // Panel Visibility
        // ========================================================================

        toggleOpen: () => {
          set((state) => ({
            isOpen: !state.isOpen,
          }));
        },

        setOpen: (isOpen: boolean) => {
          set({ isOpen });
        },

        // ========================================================================
        // Position and Size
        // ========================================================================

        setPosition: (position: PanelPosition) => {
          set({ position });
        },

        setWidth: (width: number) => {
          // Clamp width between 300-800px
          const clampedWidth = Math.max(300, Math.min(800, width));
          set({ width: clampedWidth });
        },

        setHeight: (height: number) => {
          // Clamp height between 200-600px
          const clampedHeight = Math.max(200, Math.min(600, height));
          set({ height: clampedHeight });
        },

        setFloatingPosition: (x: number, y: number) => {
          set(() => ({
            floatingPosition: { x, y },
          }));
        },

        setFloatingSize: (width: number, height: number) => {
          // Clamp dimensions
          const clampedWidth = Math.max(300, Math.min(800, width));
          const clampedHeight = Math.max(400, Math.min(1000, height));

          set(() => ({
            floatingSize: { width: clampedWidth, height: clampedHeight },
          }));
        },

        // ========================================================================
        // Sections
        // ========================================================================

        toggleSection: (sectionId: string) => {
          set((state) => {
            const newCollapsed = new Set(state.collapsedSections);
            if (newCollapsed.has(sectionId)) {
              newCollapsed.delete(sectionId);
            } else {
              newCollapsed.add(sectionId);
            }
            return { collapsedSections: newCollapsed };
          });
        },

        collapseSection: (sectionId: string) => {
          set((state) => {
            const newCollapsed = new Set(state.collapsedSections);
            newCollapsed.add(sectionId);
            return { collapsedSections: newCollapsed };
          });
        },

        expandSection: (sectionId: string) => {
          set((state) => {
            const newCollapsed = new Set(state.collapsedSections);
            newCollapsed.delete(sectionId);
            return { collapsedSections: newCollapsed };
          });
        },

        setActiveSection: (sectionId: string | null) => {
          set({ activeSection: sectionId });
        },

        // ========================================================================
        // Unsaved Changes
        // ========================================================================

        recordChange: (
          actionId: string,
          property: string,
          oldValue: any,
          newValue: any
        ) => {
          set((state) => {
            const changes = new Map(state.unsavedChanges);
            const actionChanges = changes.get(actionId) || [];

            // Check if this property already has a change recorded
            const existingIndex = actionChanges.findIndex(
              (c) => c.property === property
            );

            const change: UnsavedChange = {
              actionId,
              property,
              oldValue,
              newValue,
              timestamp: Date.now(),
            };

            if (existingIndex >= 0) {
              // Update existing change, keep original oldValue
              const existingChange = actionChanges[existingIndex];
              if (existingChange) {
                actionChanges[existingIndex] = {
                  ...change,
                  oldValue: existingChange.oldValue,
                };
              }
            } else {
              // Add new change
              actionChanges.push(change);
            }

            changes.set(actionId, actionChanges);

            return {
              unsavedChanges: changes,
              hasUnsavedChanges: true,
            };
          });
        },

        clearChanges: (actionId?: string) => {
          set((state) => {
            if (actionId) {
              const changes = new Map(state.unsavedChanges);
              changes.delete(actionId);

              return {
                unsavedChanges: changes,
                hasUnsavedChanges: changes.size > 0,
              };
            } else {
              return {
                unsavedChanges: new Map(),
                hasUnsavedChanges: false,
              };
            }
          });
        },

        discardChanges: (actionId?: string) => {
          // Alias for clearChanges - same behavior
          get().clearChanges(actionId);
        },

        hasChangesForAction: (actionId: string) => {
          const changes = get().unsavedChanges.get(actionId);
          return changes !== undefined && changes.length > 0;
        },

        getChangesForAction: (actionId: string) => {
          return get().unsavedChanges.get(actionId) || [];
        },

        // ========================================================================
        // Auto-save
        // ========================================================================

        setAutoSave: (enabled: boolean) => {
          set({ autoSave: enabled });
        },

        setAutoSaveDelay: (delay: number) => {
          // Clamp delay between 100-5000ms
          const clampedDelay = Math.max(100, Math.min(5000, delay));
          set({ autoSaveDelay: clampedDelay });
        },

        // ========================================================================
        // Reset
        // ========================================================================

        reset: () => {
          set({
            ...initialState,
            // Keep panel position and size preferences
            position: get().position,
            width: get().width,
            height: get().height,
          });
        },
      }),
      {
        name: "properties-panel-storage",
        partialize: (state) => ({
          position: state.position,
          width: state.width,
          height: state.height,
          floatingPosition: state.floatingPosition,
          floatingSize: state.floatingSize,
          autoSave: state.autoSave,
          autoSaveDelay: state.autoSaveDelay,
          // Don't persist: isOpen, collapsedSections, unsavedChanges, activeSection
        }),
      }
    ),
    { name: "PropertiesPanelStore" }
  )
);

// ============================================================================
// Selector Hooks
// ============================================================================

/**
 * Hook to check if a specific section is collapsed
 */
export function useIsSectionCollapsed(sectionId: string): boolean {
  return usePropertiesPanelStore((state) =>
    state.collapsedSections.has(sectionId)
  );
}

/**
 * Hook to get panel dimensions based on current position
 */
export function usePanelDimensions() {
  return usePropertiesPanelStore((state) => {
    if (state.position === "right") {
      return { width: state.width, height: "100%" };
    } else if (state.position === "bottom") {
      return { width: "100%", height: state.height };
    } else {
      return state.floatingSize;
    }
  });
}

/**
 * Hook to get unsaved changes count
 */
export function useUnsavedChangesCount(): number {
  return usePropertiesPanelStore((state) => {
    let count = 0;
    state.unsavedChanges.forEach((changes) => {
      count += changes.length;
    });
    return count;
  });
}
