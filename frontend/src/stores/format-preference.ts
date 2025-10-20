/**
 * Format Preference Store
 *
 * Manages user preferences for workflow view formats (list vs graph).
 * Preferences are persisted to localStorage and can be set globally or per-workflow.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================================================
// Types
// ============================================================================

export type ViewFormat = 'list' | 'graph';

export interface FormatPreference {
  /** Preferred view format for a specific workflow */
  format: ViewFormat;
  /** Last time this preference was updated */
  lastUpdated: string;
}

export interface FormatPreferenceState {
  /** Default view format for new workflows */
  defaultView: ViewFormat;

  /** Automatically convert workflows on load to preferred format */
  autoConvert: boolean;

  /** Show confirmation dialog before converting */
  confirmBeforeConvert: boolean;

  /** Remember format preference per individual workflow */
  rememberPerWorkflow: boolean;

  /** Per-workflow format preferences (keyed by workflow ID) */
  workflowPreferences: Record<string, FormatPreference>;

  /** Show conversion warnings in preview */
  showConversionWarnings: boolean;

  /** Show conversion statistics after conversion */
  showConversionStats: boolean;
}

export interface FormatPreferenceActions {
  /** Set the default view format for all workflows */
  setDefaultView: (view: ViewFormat) => void;

  /** Get the preferred view format for a specific workflow */
  getPreferredView: (workflowId: string) => ViewFormat;

  /** Set the preferred view format for a specific workflow */
  setWorkflowPreference: (workflowId: string, view: ViewFormat) => void;

  /** Clear preference for a specific workflow (fall back to default) */
  clearWorkflowPreference: (workflowId: string) => void;

  /** Clear all workflow preferences */
  clearAllWorkflowPreferences: () => void;

  /** Toggle auto-convert on load */
  toggleAutoConvert: () => void;

  /** Toggle confirm before convert */
  toggleConfirmBeforeConvert: () => void;

  /** Toggle remember per workflow */
  toggleRememberPerWorkflow: () => void;

  /** Toggle show conversion warnings */
  toggleShowConversionWarnings: () => void;

  /** Toggle show conversion statistics */
  toggleShowConversionStats: () => void;

  /** Get most recently used format (excluding specific workflow) */
  getMostRecentFormat: () => ViewFormat;

  /** Get statistics about format preferences */
  getPreferenceStats: () => {
    totalPreferences: number;
    listCount: number;
    graphCount: number;
    mostUsedFormat: ViewFormat;
  };

  /** Reset all preferences to defaults */
  resetToDefaults: () => void;
}

export type FormatPreferenceStore = FormatPreferenceState & FormatPreferenceActions;

// ============================================================================
// Default State
// ============================================================================

const defaultState: FormatPreferenceState = {
  defaultView: 'graph',
  autoConvert: false,
  confirmBeforeConvert: true,
  rememberPerWorkflow: true,
  workflowPreferences: {},
  showConversionWarnings: true,
  showConversionStats: true,
};

// ============================================================================
// Store
// ============================================================================

export const useFormatPreferenceStore = create<FormatPreferenceStore>()(
  persist(
    (set, get) => ({
      ...defaultState,

      // ========================================================================
      // View Format Management
      // ========================================================================

      setDefaultView: (view: ViewFormat) => {
        set({ defaultView: view });
      },

      getPreferredView: (workflowId: string): ViewFormat => {
        const state = get();

        // If remember per workflow is disabled, always use default
        if (!state.rememberPerWorkflow) {
          return state.defaultView;
        }

        // Check if there's a specific preference for this workflow
        const preference = state.workflowPreferences[workflowId];
        if (preference) {
          return preference.format;
        }

        // Fall back to default view
        return state.defaultView;
      },

      setWorkflowPreference: (workflowId: string, view: ViewFormat) => {
        set((state) => ({
          workflowPreferences: {
            ...state.workflowPreferences,
            [workflowId]: {
              format: view,
              lastUpdated: new Date().toISOString(),
            },
          },
        }));
      },

      clearWorkflowPreference: (workflowId: string) => {
        set((state) => {
          const { [workflowId]: _, ...remaining } = state.workflowPreferences;
          return { workflowPreferences: remaining };
        });
      },

      clearAllWorkflowPreferences: () => {
        set({ workflowPreferences: {} });
      },

      // ========================================================================
      // Settings Toggles
      // ========================================================================

      toggleAutoConvert: () => {
        set((state) => ({ autoConvert: !state.autoConvert }));
      },

      toggleConfirmBeforeConvert: () => {
        set((state) => ({ confirmBeforeConvert: !state.confirmBeforeConvert }));
      },

      toggleRememberPerWorkflow: () => {
        set((state) => ({ rememberPerWorkflow: !state.rememberPerWorkflow }));
      },

      toggleShowConversionWarnings: () => {
        set((state) => ({ showConversionWarnings: !state.showConversionWarnings }));
      },

      toggleShowConversionStats: () => {
        set((state) => ({ showConversionStats: !state.showConversionStats }));
      },

      // ========================================================================
      // Statistics and Analytics
      // ========================================================================

      getMostRecentFormat: (): ViewFormat => {
        const state = get();
        const preferences = Object.values(state.workflowPreferences);

        if (preferences.length === 0) {
          return state.defaultView;
        }

        // Sort by lastUpdated descending
        const sorted = preferences.sort(
          (a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
        );

        return sorted[0].format;
      },

      getPreferenceStats: () => {
        const state = get();
        const preferences = Object.values(state.workflowPreferences);

        const totalPreferences = preferences.length;
        const listCount = preferences.filter((p) => p.format === 'list').length;
        const graphCount = preferences.filter((p) => p.format === 'graph').length;

        const mostUsedFormat: ViewFormat = graphCount >= listCount ? 'graph' : 'list';

        return {
          totalPreferences,
          listCount,
          graphCount,
          mostUsedFormat,
        };
      },

      resetToDefaults: () => {
        set(defaultState);
      },
    }),
    {
      name: 'format-preference-storage',
      version: 1,
      // Only persist user preferences, not derived state
      partialize: (state) => ({
        defaultView: state.defaultView,
        autoConvert: state.autoConvert,
        confirmBeforeConvert: state.confirmBeforeConvert,
        rememberPerWorkflow: state.rememberPerWorkflow,
        workflowPreferences: state.workflowPreferences,
        showConversionWarnings: state.showConversionWarnings,
        showConversionStats: state.showConversionStats,
      }),
    }
  )
);

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the opposite view format
 */
export function getOppositeFormat(format: ViewFormat): ViewFormat {
  return format === 'list' ? 'graph' : 'list';
}

/**
 * Get human-readable format name
 */
export function getFormatDisplayName(format: ViewFormat): string {
  return format === 'list' ? 'List View' : 'Graph View';
}

/**
 * Get format description
 */
export function getFormatDescription(format: ViewFormat): string {
  if (format === 'list') {
    return 'Sequential list with nested control flow. Best for simple linear workflows.';
  } else {
    return 'Visual graph with node connections. Best for complex branching workflows.';
  }
}

/**
 * Get format icon name (for UI components)
 */
export function getFormatIcon(format: ViewFormat): string {
  return format === 'list' ? 'list' : 'graph';
}

/**
 * Check if format is valid
 */
export function isValidFormat(format: string): format is ViewFormat {
  return format === 'list' || format === 'graph';
}
