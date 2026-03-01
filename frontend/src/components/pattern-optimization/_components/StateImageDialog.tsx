"use client";

import React from "react";

interface StateOption {
  id: string;
  name: string;
}

interface StateImageDialogProps {
  stateImageName: string;
  selectedStateId: string;
  newStateName: string;
  fixedLocation: boolean;
  editedPattern: string | null;
  states: StateOption[];
  onStateImageNameChange: (name: string) => void;
  onSelectedStateIdChange: (id: string) => void;
  onNewStateNameChange: (name: string) => void;
  onFixedLocationChange: (fixed: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export const StateImageDialog: React.FC<StateImageDialogProps> = ({
  stateImageName,
  selectedStateId,
  newStateName,
  fixedLocation,
  editedPattern,
  states,
  onStateImageNameChange,
  onSelectedStateIdChange,
  onNewStateNameChange,
  onFixedLocationChange,
  onCancel,
  onConfirm,
}) => {
  const isConfirmDisabled =
    !stateImageName ||
    !selectedStateId ||
    (selectedStateId === "new" && !newStateName.trim());

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-surface-raised border border-border-default rounded-lg p-6 w-96 max-w-full">
        <h3 className="text-lg font-semibold text-white mb-4">
          Create StateImage
        </h3>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="pos-state-image-name"
              className="block text-sm font-medium text-text-secondary mb-1"
            >
              StateImage Name
            </label>
            <input
              id="pos-state-image-name"
              type="text"
              value={stateImageName}
              onChange={(e) => onStateImageNameChange(e.target.value)}
              placeholder="Enter name for the StateImage"
              className="w-full px-3 py-2 bg-surface-canvas border border-border-default rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary text-white"
            />
          </div>

          <div>
            <label
              htmlFor="pos-add-to-state"
              className="block text-sm font-medium text-text-secondary mb-1"
            >
              Add to State
            </label>
            <select
              id="pos-add-to-state"
              value={selectedStateId}
              onChange={(e) => onSelectedStateIdChange(e.target.value)}
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

          {selectedStateId === "new" && (
            <div>
              <label
                htmlFor="pos-new-state-name"
                className="block text-sm font-medium text-text-secondary mb-1"
              >
                New State Name
              </label>
              <input
                id="pos-new-state-name"
                type="text"
                value={newStateName}
                onChange={(e) => onNewStateNameChange(e.target.value)}
                placeholder="Enter name for the new state"
                className="w-full px-3 py-2 bg-surface-canvas border border-border-default rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary text-white"
              />
            </div>
          )}

          <div className="flex items-center">
            <input
              type="checkbox"
              id="fixed-location-pattern"
              checked={fixedLocation}
              onChange={(e) => onFixedLocationChange(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-border-default rounded"
            />
            <label
              htmlFor="fixed-location-pattern"
              className="ml-2 block text-sm text-text-secondary"
            >
              Fixed location pattern (saves pattern region as search region)
            </label>
          </div>

          {editedPattern && (
            <div className="text-sm text-amber-600 bg-amber-50 p-2 rounded">
              Using edited pattern with transparency modifications
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-text-secondary bg-surface-raised rounded-md hover:bg-surface-raised/80"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isConfirmDisabled}
            className="px-4 py-2 text-sm text-black bg-brand-success rounded-md hover:bg-brand-success/90 disabled:bg-surface-raised disabled:text-text-muted disabled:cursor-not-allowed"
          >
            Create StateImage
          </button>
        </div>
      </div>
    </div>
  );
};
