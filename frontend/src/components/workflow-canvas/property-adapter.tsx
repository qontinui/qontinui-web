/**
 * Property Adapter - Bridge between action-properties components and canvas store
 *
 * This adapter:
 * - Converts canvas Action type to action-properties Action type
 * - Provides update handlers that integrate with canvas store
 * - Manages auto-save behavior
 * - Tracks unsaved changes
 */

import { useCallback, useEffect, useRef } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { usePropertiesPanelStore } from "@/stores/properties-panel-store";
import type { Action as CanvasAction } from "@/lib/action-schema/action-types";
import type { Action as PropertyAction } from "@/components/action-properties/types";

// ============================================================================
// Type Conversions
// ============================================================================

/**
 * Convert canvas Action to action-properties Action format
 */
function canvasActionToPropertyAction(action: CanvasAction): PropertyAction {
  return {
    id: action.id,
    type: action.type as PropertyAction["type"],
    config: action.config as Record<string, any>,
  };
}

/**
 * Convert config updates back to canvas Action partial
 */
function configUpdatesToActionPartial(
  configUpdates: Record<string, any>
): Partial<CanvasAction> {
  return {
    config: configUpdates,
  };
}

// ============================================================================
// Property Adapter Hook
// ============================================================================

export interface PropertyAdapterResult {
  /** Action in action-properties format */
  action: PropertyAction | null;

  /** Update handler for property changes */
  updateConfig: (
    key: string,
    value: any,
    additionalUpdates?: Record<string, any>
  ) => void;

  /** Full action update handler */
  updateAction: (updates: Partial<CanvasAction>) => void;

  /** Check if action has unsaved changes */
  hasUnsavedChanges: boolean;

  /** Save changes to canvas */
  saveChanges: () => void;

  /** Discard unsaved changes */
  discardChanges: () => void;

  /** Original canvas action */
  canvasAction: CanvasAction | null;
}

export function usePropertyAdapter(actionId: string): PropertyAdapterResult {
  const canvasAction = useCanvasStore((state) => state.getActionById(actionId));
  const updateActionInCanvas = useCanvasStore((state) => state.updateAction);

  const recordChange = usePropertiesPanelStore((state) => state.recordChange);
  const clearChanges = usePropertiesPanelStore((state) => state.clearChanges);
  const hasChangesForAction = usePropertiesPanelStore((state) =>
    state.hasChangesForAction(actionId)
  );
  const autoSave = usePropertiesPanelStore((state) => state.autoSave);
  const autoSaveDelay = usePropertiesPanelStore((state) => state.autoSaveDelay);

  // Auto-save timeout ref
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Pending changes ref
  const pendingChangesRef = useRef<Partial<CanvasAction>>({});

  /**
   * Save pending changes to canvas
   */
  const saveChanges = useCallback(() => {
    if (Object.keys(pendingChangesRef.current).length === 0) return;

    updateActionInCanvas(actionId, pendingChangesRef.current);
    clearChanges(actionId);
    pendingChangesRef.current = {};

    // Clear auto-save timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
  }, [actionId, updateActionInCanvas, clearChanges]);

  /**
   * Discard pending changes
   */
  const discardChanges = useCallback(() => {
    pendingChangesRef.current = {};
    clearChanges(actionId);

    // Clear auto-save timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
  }, [actionId, clearChanges]);

  /**
   * Update config handler - called by action-properties components
   */
  const updateConfig = useCallback(
    (key: string, value: any, additionalUpdates?: Record<string, any>) => {
      if (!canvasAction) return;

      const oldValue = (canvasAction.config as any)[key];

      // Record change for tracking
      recordChange(actionId, `config.${key}`, oldValue, value);

      // Accumulate changes
      const updates: Record<string, any> = { [key]: value };
      if (additionalUpdates) {
        Object.assign(updates, additionalUpdates);
      }

      // Merge with pending changes
      pendingChangesRef.current = {
        ...pendingChangesRef.current,
        config: {
          ...(pendingChangesRef.current.config || {}),
          ...updates,
        },
      };

      // Handle auto-save
      if (autoSave) {
        // Clear existing timeout
        if (autoSaveTimeoutRef.current) {
          clearTimeout(autoSaveTimeoutRef.current);
        }

        // Set new timeout
        autoSaveTimeoutRef.current = setTimeout(() => {
          saveChanges();
        }, autoSaveDelay);
      }
    },
    [actionId, canvasAction, recordChange, autoSave, autoSaveDelay, saveChanges]
  );

  /**
   * Full action update handler
   */
  const updateAction = useCallback(
    (updates: Partial<CanvasAction>) => {
      if (!canvasAction) return;

      // Record changes for each updated property
      for (const [key, value] of Object.entries(updates)) {
        const oldValue = (canvasAction as any)[key];
        recordChange(actionId, key, oldValue, value);
      }

      // Merge with pending changes
      pendingChangesRef.current = {
        ...pendingChangesRef.current,
        ...updates,
      };

      // Handle auto-save
      if (autoSave) {
        if (autoSaveTimeoutRef.current) {
          clearTimeout(autoSaveTimeoutRef.current);
        }

        autoSaveTimeoutRef.current = setTimeout(() => {
          saveChanges();
        }, autoSaveDelay);
      }
    },
    [actionId, canvasAction, recordChange, autoSave, autoSaveDelay, saveChanges]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

  // Convert to property action format
  const propertyAction = canvasAction
    ? canvasActionToPropertyAction(canvasAction)
    : null;

  return {
    action: propertyAction,
    updateConfig,
    updateAction,
    hasUnsavedChanges: hasChangesForAction,
    saveChanges,
    discardChanges,
    canvasAction,
  };
}

// ============================================================================
// Multi-Action Adapter Hook
// ============================================================================

export interface MultiPropertyAdapterResult {
  /** Actions in action-properties format */
  actions: PropertyAction[];

  /** Batch update handler for common properties */
  updateCommonConfig: (key: string, value: any) => void;

  /** Get common value for a property (or undefined if mixed) */
  getCommonValue: (key: string) => any | undefined;

  /** Check if property has mixed values across selections */
  isMixedValue: (key: string) => boolean;

  /** Save all changes */
  saveAllChanges: () => void;

  /** Discard all changes */
  discardAllChanges: () => void;

  /** Original canvas actions */
  canvasActions: CanvasAction[];
}

export function useMultiPropertyAdapter(
  actionIds: string[]
): MultiPropertyAdapterResult {
  const canvasActions = useCanvasStore(
    (state) =>
      actionIds
        .map((id) => state.getActionById(id))
        .filter(Boolean) as CanvasAction[]
  );

  const updateActionInCanvas = useCanvasStore((state) => state.updateAction);
  const recordChange = usePropertiesPanelStore((state) => state.recordChange);
  const clearChanges = usePropertiesPanelStore((state) => state.clearChanges);

  /**
   * Get common value for a config property across all selected actions
   * Returns undefined if values are mixed
   */
  const getCommonValue = useCallback(
    (key: string): any | undefined => {
      if (canvasActions.length === 0) return undefined;

      const firstValue = (canvasActions[0].config as any)[key];
      const allSame = canvasActions.every(
        (action) => (action.config as any)[key] === firstValue
      );

      return allSame ? firstValue : undefined;
    },
    [canvasActions]
  );

  /**
   * Check if property has mixed values
   */
  const isMixedValue = useCallback(
    (key: string): boolean => {
      return getCommonValue(key) === undefined;
    },
    [getCommonValue]
  );

  /**
   * Update config for all selected actions
   */
  const updateCommonConfig = useCallback(
    (key: string, value: any) => {
      canvasActions.forEach((action) => {
        const oldValue = (action.config as any)[key];
        recordChange(action.id, `config.${key}`, oldValue, value);

        updateActionInCanvas(action.id, {
          config: {
            ...action.config,
            [key]: value,
          },
        });
      });
    },
    [canvasActions, recordChange, updateActionInCanvas]
  );

  /**
   * Save changes for all selected actions
   */
  const saveAllChanges = useCallback(() => {
    actionIds.forEach((actionId) => {
      clearChanges(actionId);
    });
  }, [actionIds, clearChanges]);

  /**
   * Discard changes for all selected actions
   */
  const discardAllChanges = useCallback(() => {
    actionIds.forEach((actionId) => {
      clearChanges(actionId);
    });
  }, [actionIds, clearChanges]);

  // Convert to property actions
  const propertyActions = canvasActions.map(canvasActionToPropertyAction);

  return {
    actions: propertyActions,
    updateCommonConfig,
    getCommonValue,
    isMixedValue,
    saveAllChanges,
    discardAllChanges,
    canvasActions,
  };
}

// ============================================================================
// Property Editor Component Wrapper
// ============================================================================

/**
 * Wrapper to use existing action-properties components with canvas integration
 *
 * @example
 * <PropertyEditorWrapper
 *   actionId="action-1"
 *   component={ClickActionProperties}
 * />
 */
export interface PropertyEditorWrapperProps {
  actionId: string;
  component: React.ComponentType<any>;
  images?: any[];
  states?: any[];
  processes?: any[];
}

export function PropertyEditorWrapper({
  actionId,
  component: Component,
  images = [],
  states = [],
  processes = [],
}: PropertyEditorWrapperProps) {
  const { action, updateConfig } = usePropertyAdapter(actionId);

  if (!action) {
    return (
      <div className="text-gray-400 text-sm p-4">
        Action not found: {actionId}
      </div>
    );
  }

  return (
    <Component
      action={action}
      updateConfig={updateConfig}
      images={images}
      states={states}
      processes={processes}
    />
  );
}
