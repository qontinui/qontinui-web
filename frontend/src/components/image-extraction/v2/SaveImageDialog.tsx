/**
 * Save Image Dialog
 *
 * Modal dialog for saving extracted images. Supports three modes:
 * - createStateImage: Create a new StateImage and add to a state
 * - addPattern: Add as a pattern to an existing StateImage
 * - libraryOnly: Save to image library only
 */

import React, { useCallback, useMemo } from "react";
import { Plus, Layers, Library } from "lucide-react";
import type {
  SaveDialogState,
  ExtractionResultData,
} from "@/stores/page-state/image-extraction-store-v2";

interface State {
  id: string;
  name: string;
  stateImages?: StateImage[];
}

interface StateImage {
  id: string;
  name: string;
  patterns?: unknown[];
}

interface StateImageWithContext {
  stateImage: StateImage;
  stateId: string;
  stateName: string;
}

interface SaveImageDialogProps {
  isOpen: boolean;
  extractedResult: ExtractionResultData | null;
  saveDialog: SaveDialogState;
  states: State[];
  onUpdateDialog: (updates: Partial<SaveDialogState>) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
}

export const SaveImageDialog: React.FC<SaveImageDialogProps> = ({
  isOpen,
  extractedResult,
  saveDialog,
  states,
  onUpdateDialog,
  onSave,
  onCancel,
}) => {
  // Flatten all StateImages with their parent state context
  const allStateImages = useMemo((): StateImageWithContext[] => {
    const result: StateImageWithContext[] = [];
    for (const state of states) {
      for (const stateImage of state.stateImages || []) {
        result.push({
          stateImage,
          stateId: state.id,
          stateName: state.name,
        });
      }
    }
    return result;
  }, [states]);

  // Check if save button should be enabled
  const canSave = useMemo(() => {
    if (!saveDialog.imageName) return false;
    if (saveDialog.mode === "createStateImage") {
      if (!saveDialog.selectedStateId) return false;
      if (
        saveDialog.selectedStateId === "new" &&
        !saveDialog.newStateName.trim()
      )
        return false;
    }
    if (saveDialog.mode === "addPattern") {
      if (!saveDialog.selectedStateImageId) return false;
    }
    return true;
  }, [saveDialog]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (
        e.key === "Enter" &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        const target = e.target as HTMLElement;
        if (target.tagName !== "TEXTAREA" && target.tagName !== "BUTTON") {
          e.preventDefault();
          if (canSave) {
            onSave();
          }
        }
      }
    },
    [canSave, onSave]
  );

  // Handle cancel
  const handleCancel = useCallback(() => {
    onUpdateDialog({
      imageName: "",
      mode: "createStateImage",
      selectedStateId: "",
      newStateName: "",
      selectedStateImageId: "",
    });
    onCancel();
  }, [onUpdateDialog, onCancel]);

  if (!isOpen || !extractedResult) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div
        role="button"
        tabIndex={0}
        className="bg-surface-raised border border-border-default rounded-lg p-6 w-[450px] max-w-full max-h-[90vh] overflow-y-auto"
        onKeyDown={handleKeyDown}
      >
        <h3 className="text-lg font-semibold text-white mb-4">
          Save Extracted Image
        </h3>

        <div className="space-y-4">
          {/* Image Name - always required */}
          <div>
            <label
              htmlFor="sid-image-name"
              className="block text-sm font-medium text-text-secondary mb-1"
            >
              Image Name
            </label>
            <input
              id="sid-image-name"
              type="text"
              value={saveDialog.imageName}
              onChange={(e) => onUpdateDialog({ imageName: e.target.value })}
              placeholder="Enter a name for the image"
              className="w-full px-3 py-2 bg-surface-canvas border border-border-default rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary text-white"
            />
          </div>

          {/* Save Mode Selection */}
          <div>
            <p className="block text-sm font-medium text-text-secondary mb-2">
              Save As
            </p>
            <div className="space-y-2">
              <label
                aria-label="Create StateImage"
                htmlFor="type--radio-2"
                className="flex items-start p-3 bg-surface-canvas border border-border-default rounded-md cursor-pointer hover:border-border-default transition-colors"
              >
                <input
                  id="type--radio-2"
                  type="radio"
                  checked={saveDialog.mode === "createStateImage"}
                  onChange={() => onUpdateDialog({ mode: "createStateImage" })}
                  className="mt-0.5 mr-3"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Plus className="w-4 h-4 text-brand-success" />
                    <span className="text-sm font-medium text-white">
                      Create StateImage
                    </span>
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    Create a new StateImage and add it to a state
                  </p>
                </div>
              </label>

              <label
                aria-label="Add Pattern to StateImage"
                htmlFor="type--radio-1"
                className="flex items-start p-3 bg-surface-canvas border border-border-default rounded-md cursor-pointer hover:border-border-default transition-colors"
              >
                <input
                  id="type--radio-1"
                  type="radio"
                  checked={saveDialog.mode === "addPattern"}
                  onChange={() => onUpdateDialog({ mode: "addPattern" })}
                  className="mt-0.5 mr-3"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-brand-secondary" />
                    <span className="text-sm font-medium text-white">
                      Add Pattern to StateImage
                    </span>
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    Add as a pattern variation to an existing StateImage
                  </p>
                </div>
              </label>

              <label
                aria-label="Save to library only"
                htmlFor="type--radio-0"
                className="flex items-start p-3 bg-surface-canvas border border-border-default rounded-md cursor-pointer hover:border-border-default transition-colors"
              >
                <input
                  id="type--radio-0"
                  type="radio"
                  checked={saveDialog.mode === "libraryOnly"}
                  onChange={() => onUpdateDialog({ mode: "libraryOnly" })}
                  className="mt-0.5 mr-3"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Library className="w-4 h-4 text-brand-primary" />
                    <span className="text-sm font-medium text-white">
                      Save to Library Only
                    </span>
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    Save to the image library without creating a StateImage
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Conditional fields based on save mode */}
          {saveDialog.mode === "createStateImage" && (
            <>
              <div>
                <label
                  htmlFor="sid-state"
                  className="block text-sm font-medium text-text-secondary mb-1"
                >
                  Add to State
                </label>
                <select
                  id="sid-state"
                  value={saveDialog.selectedStateId}
                  onChange={(e) =>
                    onUpdateDialog({ selectedStateId: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-surface-canvas border border-border-default rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary text-white"
                >
                  <option value="">Select a state...</option>
                  <option value="new">Create New State</option>
                  {states.map((state) => (
                    <option key={state.id} value={state.id}>
                      {state.name}
                    </option>
                  ))}
                </select>
              </div>

              {saveDialog.selectedStateId === "new" && (
                <div>
                  <label
                    htmlFor="sid-new-state-name"
                    className="block text-sm font-medium text-text-secondary mb-1"
                  >
                    New State Name
                  </label>
                  <input
                    id="sid-new-state-name"
                    type="text"
                    value={saveDialog.newStateName}
                    onChange={(e) =>
                      onUpdateDialog({ newStateName: e.target.value })
                    }
                    placeholder="Enter name for the new state"
                    className="w-full px-3 py-2 bg-surface-canvas border border-border-default rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary text-white"
                  />
                </div>
              )}
            </>
          )}

          {saveDialog.mode === "addPattern" && (
            <div>
              <label
                htmlFor="sid-state-image"
                className="block text-sm font-medium text-text-secondary mb-1"
              >
                Add Pattern to StateImage
              </label>
              <select
                id="sid-state-image"
                value={saveDialog.selectedStateImageId}
                onChange={(e) =>
                  onUpdateDialog({ selectedStateImageId: e.target.value })
                }
                className="w-full px-3 py-2 bg-surface-canvas border border-border-default rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary text-white"
              >
                <option value="">Select a StateImage...</option>
                {allStateImages.map((ctx) => {
                  const patternCount = ctx.stateImage.patterns?.length || 0;
                  return (
                    <option key={ctx.stateImage.id} value={ctx.stateImage.id}>
                      {ctx.stateImage.name} ({ctx.stateName}) - {patternCount}{" "}
                      pattern{patternCount !== 1 ? "s" : ""}
                    </option>
                  );
                })}
              </select>
              {allStateImages.length === 0 && (
                <p className="text-xs text-amber-500 mt-1">
                  No StateImages exist yet. Create a StateImage first.
                </p>
              )}
            </div>
          )}

          {/* Fixed location checkbox - shown for StateImage and Pattern modes */}
          {saveDialog.mode !== "libraryOnly" && (
            <div className="flex items-center">
              <input
                type="checkbox"
                id="fixed-location"
                checked={saveDialog.fixedLocation}
                onChange={(e) =>
                  onUpdateDialog({ fixedLocation: e.target.checked })
                }
                className="h-4 w-4 text-brand-primary focus:ring-brand-primary border-border-default rounded"
              />
              <label
                htmlFor="fixed-location"
                className="ml-2 block text-sm text-text-secondary"
              >
                Fixed location (saves extraction region as search region)
              </label>
            </div>
          )}

          {/* Mask info */}
          {extractedResult.mask && (
            <div className="text-sm text-brand-primary bg-brand-primary/10 border border-brand-primary p-2 rounded">
              Mask will be saved with the image
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm text-text-secondary bg-surface-raised rounded-md hover:bg-surface-raised/80"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!canSave}
            className="px-4 py-2 text-sm text-black bg-brand-success rounded-md hover:bg-brand-success/90 disabled:bg-surface-raised disabled:text-text-muted disabled:cursor-not-allowed"
          >
            {saveDialog.mode === "libraryOnly"
              ? "Save to Library"
              : saveDialog.mode === "addPattern"
                ? "Add Pattern"
                : "Create StateImage"}
          </button>
        </div>
      </div>
    </div>
  );
};
