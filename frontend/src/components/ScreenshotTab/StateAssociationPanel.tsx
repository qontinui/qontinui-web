import { State } from "../../contexts/automation-context/types";
import React, { useState } from "react";
import { Link2, Plus, X } from "lucide-react";
import { Screenshot } from "../../types/Screenshot";

interface StateAssociationPanelProps {
  screenshot: Screenshot;
  states: State[];
  onStateAssociation: (stateIds: string[]) => void;
}

const StateAssociationPanel: React.FC<StateAssociationPanelProps> = ({
  screenshot,
  states,
  onStateAssociation,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredStates = states.filter((state) =>
    state.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleToggleState = (stateId: string) => {
    const newAssociations = screenshot.associatedStates.includes(stateId)
      ? screenshot.associatedStates.filter((id) => id !== stateId)
      : [...screenshot.associatedStates, stateId];

    onStateAssociation(newAssociations);
  };

  const getAssociatedStateNames = () => {
    return screenshot.associatedStates
      .map((stateId) => states.find((s) => s.id === stateId))
      .filter(
        (state): state is NonNullable<typeof state> => state !== undefined
      )
      .map((state) => state.name);
  };

  if (!isExpanded) {
    return (
      <div className="border-t bg-gray-50 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">
              State Associations
            </span>
            {screenshot.associatedStates.length > 0 && (
              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                {screenshot.associatedStates.length}
              </span>
            )}
          </div>
          <button
            onClick={() => setIsExpanded(true)}
            className="p-1 hover:bg-gray-200 rounded transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {screenshot.associatedStates.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {getAssociatedStateNames().map((name, idx) => (
              <span
                key={idx}
                className="inline-block px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded"
              >
                {name}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border-t bg-white">
      <div className="p-3 border-b bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">
              State Associations
            </span>
          </div>
          <button
            onClick={() => setIsExpanded(false)}
            className="p-1 hover:bg-gray-200 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-3">
        {/* Search */}
        <div className="mb-3">
          <input
            type="text"
            placeholder="Search states..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* States List */}
        <div className="max-h-48 overflow-y-auto space-y-1">
          {filteredStates.length > 0 ? (
            filteredStates.map((state) => (
              <label
                key={state.id}
                className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={screenshot.associatedStates.includes(state.id)}
                  onChange={() => handleToggleState(state.id)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium">{state.name}</div>
                  <div className="text-xs text-gray-500">{state.id}</div>
                </div>
              </label>
            ))
          ) : (
            <div className="text-center py-4 text-sm text-gray-500">
              {searchTerm
                ? "No states found matching your search"
                : "No states available"}
            </div>
          )}
        </div>

        {/* Summary */}
        {screenshot.associatedStates.length > 0 && (
          <div className="mt-3 pt-3 border-t">
            <div className="text-xs text-gray-600">
              {screenshot.associatedStates.length} state
              {screenshot.associatedStates.length !== 1 ? "s" : ""} associated
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Regions and locations created on this screenshot will be linked to
              these states
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StateAssociationPanel;
