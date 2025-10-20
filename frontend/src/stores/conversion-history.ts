/**
 * Conversion History Store
 *
 * Tracks workflow format conversions for undo/redo and analytics.
 * Provides conversion history, statistics, and rollback capabilities.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Workflow } from '../lib/action-schema/action-types';
import type { ConversionStatistics } from '../services/format-converter';

// ============================================================================
// Types
// ============================================================================

export interface ConversionRecord {
  /** Unique ID for this conversion */
  id: string;

  /** Workflow ID that was converted */
  workflowId: string;

  /** Workflow name at time of conversion */
  workflowName: string;

  /** Source format */
  fromFormat: 'sequential' | 'graph';

  /** Target format */
  toFormat: 'sequential' | 'graph';

  /** Timestamp of conversion */
  timestamp: string;

  /** Was conversion successful */
  success: boolean;

  /** Conversion statistics */
  statistics?: ConversionStatistics;

  /** Workflow snapshot before conversion (for undo) */
  beforeSnapshot?: Workflow;

  /** Workflow snapshot after conversion */
  afterSnapshot?: Workflow;

  /** Error message if conversion failed */
  error?: string;

  /** User notes about this conversion */
  notes?: string;
}

export interface ConversionHistoryState {
  /** All conversion records */
  records: ConversionRecord[];

  /** Maximum number of records to keep */
  maxRecords: number;

  /** Maximum number of snapshots to keep (for undo) */
  maxSnapshots: number;

  /** Whether to automatically save snapshots for undo */
  autoSaveSnapshots: boolean;
}

export interface ConversionHistoryActions {
  /** Add a new conversion record */
  addRecord: (record: Omit<ConversionRecord, 'id' | 'timestamp'>) => string;

  /** Get a specific conversion record */
  getRecord: (id: string) => ConversionRecord | undefined;

  /** Get all records for a workflow */
  getWorkflowRecords: (workflowId: string) => ConversionRecord[];

  /** Get the most recent conversion for a workflow */
  getLastConversion: (workflowId: string) => ConversionRecord | undefined;

  /** Delete a conversion record */
  deleteRecord: (id: string) => void;

  /** Clear all records */
  clearHistory: () => void;

  /** Clear old records (keep only recent ones) */
  pruneOldRecords: (keepCount?: number) => void;

  /** Get conversion statistics across all records */
  getOverallStats: () => {
    totalConversions: number;
    successfulConversions: number;
    failedConversions: number;
    toGraphCount: number;
    toSequentialCount: number;
    averageConversionTime: number;
  };

  /** Get conversion trend for a workflow */
  getWorkflowTrend: (workflowId: string) => {
    totalConversions: number;
    lastConversion?: ConversionRecord;
    preferredFormat: 'sequential' | 'graph' | 'unknown';
  };

  /** Export history as JSON */
  exportHistory: () => string;

  /** Import history from JSON */
  importHistory: (json: string) => boolean;

  /** Update record with notes */
  addNotes: (id: string, notes: string) => void;

  /** Toggle auto-save snapshots */
  toggleAutoSaveSnapshots: () => void;

  /** Set max records */
  setMaxRecords: (max: number) => void;

  /** Set max snapshots */
  setMaxSnapshots: (max: number) => void;
}

export type ConversionHistoryStore = ConversionHistoryState & ConversionHistoryActions;

// ============================================================================
// Default State
// ============================================================================

const defaultState: ConversionHistoryState = {
  records: [],
  maxRecords: 100,
  maxSnapshots: 10,
  autoSaveSnapshots: true,
};

// ============================================================================
// Store
// ============================================================================

export const useConversionHistoryStore = create<ConversionHistoryStore>()(
  persist(
    (set, get) => ({
      ...defaultState,

      // ========================================================================
      // Record Management
      // ========================================================================

      addRecord: (record: Omit<ConversionRecord, 'id' | 'timestamp'>): string => {
        const id = `conversion-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = new Date().toISOString();

        const newRecord: ConversionRecord = {
          ...record,
          id,
          timestamp,
        };

        set((state) => {
          let records = [...state.records, newRecord];

          // Prune old records if exceeding max
          if (records.length > state.maxRecords) {
            records = records.slice(records.length - state.maxRecords);
          }

          // Prune old snapshots if exceeding max
          const recordsWithSnapshots = records.filter(
            (r) => r.beforeSnapshot || r.afterSnapshot
          );
          if (recordsWithSnapshots.length > state.maxSnapshots) {
            const excessCount = recordsWithSnapshots.length - state.maxSnapshots;
            // Remove snapshots from oldest records
            for (let i = 0; i < excessCount; i++) {
              const oldRecord = recordsWithSnapshots[i];
              const index = records.findIndex((r) => r.id === oldRecord.id);
              if (index !== -1) {
                records[index] = {
                  ...records[index],
                  beforeSnapshot: undefined,
                  afterSnapshot: undefined,
                };
              }
            }
          }

          return { records };
        });

        return id;
      },

      getRecord: (id: string): ConversionRecord | undefined => {
        return get().records.find((r) => r.id === id);
      },

      getWorkflowRecords: (workflowId: string): ConversionRecord[] => {
        return get().records.filter((r) => r.workflowId === workflowId);
      },

      getLastConversion: (workflowId: string): ConversionRecord | undefined => {
        const records = get().records.filter((r) => r.workflowId === workflowId);
        return records.length > 0 ? records[records.length - 1] : undefined;
      },

      deleteRecord: (id: string) => {
        set((state) => ({
          records: state.records.filter((r) => r.id !== id),
        }));
      },

      clearHistory: () => {
        set({ records: [] });
      },

      pruneOldRecords: (keepCount?: number) => {
        set((state) => {
          const keep = keepCount ?? state.maxRecords;
          const records = state.records.slice(-keep);
          return { records };
        });
      },

      // ========================================================================
      // Statistics and Analytics
      // ========================================================================

      getOverallStats: () => {
        const records = get().records;

        const totalConversions = records.length;
        const successfulConversions = records.filter((r) => r.success).length;
        const failedConversions = records.filter((r) => !r.success).length;
        const toGraphCount = records.filter((r) => r.toFormat === 'graph').length;
        const toSequentialCount = records.filter((r) => r.toFormat === 'sequential').length;

        const conversionTimes = records
          .filter((r) => r.statistics?.conversionTime)
          .map((r) => r.statistics!.conversionTime);

        const averageConversionTime =
          conversionTimes.length > 0
            ? conversionTimes.reduce((sum, time) => sum + time, 0) / conversionTimes.length
            : 0;

        return {
          totalConversions,
          successfulConversions,
          failedConversions,
          toGraphCount,
          toSequentialCount,
          averageConversionTime,
        };
      },

      getWorkflowTrend: (workflowId: string) => {
        const records = get().records.filter((r) => r.workflowId === workflowId);

        const totalConversions = records.length;
        const lastConversion = records.length > 0 ? records[records.length - 1] : undefined;

        // Determine preferred format based on most recent conversions
        const recentRecords = records.slice(-5); // Last 5 conversions
        const toGraphCount = recentRecords.filter((r) => r.toFormat === 'graph').length;
        const toSequentialCount = recentRecords.filter((r) => r.toFormat === 'sequential').length;

        let preferredFormat: 'sequential' | 'graph' | 'unknown' = 'unknown';
        if (toGraphCount > toSequentialCount) {
          preferredFormat = 'graph';
        } else if (toSequentialCount > toGraphCount) {
          preferredFormat = 'sequential';
        }

        return {
          totalConversions,
          lastConversion,
          preferredFormat,
        };
      },

      // ========================================================================
      // Import/Export
      // ========================================================================

      exportHistory: (): string => {
        const state = get();
        const exportData = {
          version: 1,
          exported: new Date().toISOString(),
          records: state.records,
        };
        return JSON.stringify(exportData, null, 2);
      },

      importHistory: (json: string): boolean => {
        try {
          const data = JSON.parse(json);

          if (!data.version || !Array.isArray(data.records)) {
            return false;
          }

          set((state) => ({
            records: [...state.records, ...data.records],
          }));

          // Prune if necessary
          get().pruneOldRecords();

          return true;
        } catch (error) {
          console.error('Failed to import history:', error);
          return false;
        }
      },

      // ========================================================================
      // Settings
      // ========================================================================

      addNotes: (id: string, notes: string) => {
        set((state) => ({
          records: state.records.map((r) => (r.id === id ? { ...r, notes } : r)),
        }));
      },

      toggleAutoSaveSnapshots: () => {
        set((state) => ({
          autoSaveSnapshots: !state.autoSaveSnapshots,
        }));
      },

      setMaxRecords: (max: number) => {
        set({ maxRecords: max });
        get().pruneOldRecords(max);
      },

      setMaxSnapshots: (max: number) => {
        set({ maxSnapshots: max });
      },
    }),
    {
      name: 'conversion-history-storage',
      version: 1,
      // Don't persist snapshots (they're too large for localStorage)
      partialize: (state) => ({
        records: state.records.map((r) => ({
          ...r,
          beforeSnapshot: undefined,
          afterSnapshot: undefined,
        })),
        maxRecords: state.maxRecords,
        maxSnapshots: state.maxSnapshots,
        autoSaveSnapshots: state.autoSaveSnapshots,
      }),
    }
  )
);

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a conversion record from a conversion result
 */
export function createConversionRecord(
  workflowId: string,
  workflowName: string,
  fromFormat: 'sequential' | 'graph',
  toFormat: 'sequential' | 'graph',
  success: boolean,
  statistics?: ConversionStatistics,
  beforeSnapshot?: Workflow,
  afterSnapshot?: Workflow,
  error?: string
): Omit<ConversionRecord, 'id' | 'timestamp'> {
  return {
    workflowId,
    workflowName,
    fromFormat,
    toFormat,
    success,
    statistics,
    beforeSnapshot,
    afterSnapshot,
    error,
  };
}

/**
 * Get a human-readable conversion description
 */
export function getConversionDescription(record: ConversionRecord): string {
  const direction = `${record.fromFormat} → ${record.toFormat}`;
  const status = record.success ? 'succeeded' : 'failed';
  return `Conversion ${direction} ${status}`;
}

/**
 * Get time since conversion
 */
export function getTimeSinceConversion(record: ConversionRecord): string {
  const now = new Date();
  const then = new Date(record.timestamp);
  const diffMs = now.getTime() - then.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days !== 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  return `${seconds} second${seconds !== 1 ? 's' : ''} ago`;
}

/**
 * Check if a conversion can be undone
 */
export function canUndoConversion(record: ConversionRecord): boolean {
  return record.success && !!record.beforeSnapshot;
}

/**
 * Check if a conversion can be redone
 */
export function canRedoConversion(record: ConversionRecord): boolean {
  return record.success && !!record.afterSnapshot;
}
