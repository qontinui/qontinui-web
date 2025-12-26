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
        className="bg-[#27272A] border border-gray-700 rounded-lg p-6 w-[450px] max-w-full max-h-[90vh] overflow-y-auto"
        onKeyDown={handleKeyDown}
      >
        <h3 className="text-lg font-semibold text-white mb-4">
          Save Extracted Image
        </h3>

        <div className="space-y-4">
          {/* Image Name - always required */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Image Name
            </label>
            <input
              type="text"
              value={saveDialog.imageName}
              onChange={(e) => onUpdateDialog({ imageName: e.target.value })}
              placeholder="Enter a name for the image"
              className="w-full px-3 py-2 bg-[#0A0A0B] border border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00D9FF] text-white"
            />
          </div>

          {/* Save Mode Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Save As
            </label>
            <div className="space-y-2">
              <label className="flex items-start p-3 bg-[#0A0A0B] border border-gray-700 rounded-md cursor-pointer hover:border-gray-600 transition-colors">
                <input
                  type="radio"
                  checked={saveDialog.mode === "createStateImage"}
                  onChange={() => onUpdateDialog({ mode: "createStateImage" })}
                  className="mt-0.5 mr-3"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Plus className="w-4 h-4 text-[#00FF88]" />
                    <span className="text-sm font-medium text-white">
                      Create StateImage
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Create a new StateImage and add it to a state
                  </p>
                </div>
              </label>

              <label className="flex items-start p-3 bg-[#0A0A0B] border border-gray-700 rounded-md cursor-pointer hover:border-gray-600 transition-colors">
                <input
                  type="radio"
                  checked={saveDialog.mode === "addPattern"}
                  onChange={() => onUpdateDialog({ mode: "addPattern" })}
                  className="mt-0.5 mr-3"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-[#BD00FF]" />
                    <span className="text-sm font-medium text-white">
                      Add Pattern to StateImage
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Add as a pattern variation to an existing StateImage
                  </p>
                </div>
              </label>

              <label className="flex items-start p-3 bg-[#0A0A0B] border border-gray-700 rounded-md cursor-pointer hover:border-gray-600 transition-colors">
                <input
                  type="radio"
                  checked={saveDialog.mode === "libraryOnly"}
                  onChange={() => onUpdateDialog({ mode: "libraryOnly" })}
                  className="mt-0.5 mr-3"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Library className="w-4 h-4 text-[#00D9FF]" />
                    <span className="text-sm font-medium text-white">
                      Save to Library Only
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
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
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Add to State
                </label>
                <select
                  value={saveDialog.selectedStateId}
                  onChange={(e) =>
                    onUpdateDialog({ selectedStateId: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-[#0A0A0B] border border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00D9FF] text-white"
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
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    New State Name
                  </label>
                  <input
                    type="text"
                    value={saveDialog.newStateName}
                    onChange={(e) =>
                      onUpdateDialog({ newStateName: e.target.value })
                    }
                    placeholder="Enter name for the new state"
                    className="w-full px-3 py-2 bg-[#0A0A0B] border border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00D9FF] text-white"
                  />
                </div>
              )}
            </>
          )}

          {saveDialog.mode === "addPattern" && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Add Pattern to StateImage
              </label>
              <select
                value={saveDialog.selectedStateImageId}
                onChange={(e) =>
                  onUpdateDialog({ selectedStateImageId: e.target.value })
                }
                className="w-full px-3 py-2 bg-[#0A0A0B] border border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00D9FF] text-white"
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
                className="h-4 w-4 text-[#00D9FF] focus:ring-[#00D9FF] border-gray-700 rounded"
              />
              <label
                htmlFor="fixed-location"
                className="ml-2 block text-sm text-gray-300"
              >
                Fixed location (saves extraction region as search region)
              </label>
            </div>
          )}

          {/* Mask info */}
          {extractedResult.mask && (
            <div className="text-sm text-[#00D9FF] bg-[#00D9FF]/10 border border-[#00D9FF] p-2 rounded">
              Mask will be saved with the image
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm text-gray-300 bg-gray-700 rounded-md hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!canSave}
            className="px-4 py-2 text-sm text-black bg-[#00FF88] rounded-md hover:bg-[#00FF88]/90 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed"
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
