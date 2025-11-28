import React, { useState } from "react";
import {
  History,
  Plus,
  Edit2,
  Trash2,
  ChevronDown,
  ChevronUp,
  Target,
  MousePointer,
  Type,
  Move,
  Clock,
  Camera,
  ArrowRight,
} from "lucide-react";
import {
  ActionHistory,
  StateImage,
  StateLocation,
  StateRegion,
} from "../../contexts/automation-context/types";
import { ActionSnapshot } from "../../lib/integration-testing-framework";
import { Screenshot } from "../../types/Screenshot";
import ActionSnapshotBuilder from "./ActionSnapshotBuilder";

interface ActionHistoryManagerProps {
  stateObject: StateImage | StateLocation | StateRegion;
  stateId: string;
  stateName: string;
  screenshots: Screenshot[];
  activeStates: string[];
  onUpdate: (actionHistory: ActionHistory) => void;
}

export const ActionHistoryManager: React.FC<ActionHistoryManagerProps> = ({
  stateObject,
  stateId,
  stateName,
  screenshots,
  activeStates,
  onUpdate,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingSnapshot, setEditingSnapshot] = useState<ActionSnapshot | null>(
    null
  );
  const [selectedScreenshot, setSelectedScreenshot] =
    useState<Screenshot | null>(screenshots.length > 0 ? screenshots[0] : null);

  const actionHistory = stateObject.actionHistory || { snapshots: [] };

  const handleAddSnapshot = (snapshot: ActionSnapshot) => {
    const updatedHistory: ActionHistory = {
      snapshots: [...actionHistory.snapshots, snapshot],
      lastUpdated: new Date(),
    };
    onUpdate(updatedHistory);
    setShowBuilder(false);
  };

  const handleUpdateSnapshot = (updatedSnapshot: ActionSnapshot) => {
    const updatedHistory: ActionHistory = {
      snapshots: actionHistory.snapshots.map((s) =>
        s.id === updatedSnapshot.id ? updatedSnapshot : s
      ),
      lastUpdated: new Date(),
    };
    onUpdate(updatedHistory);
    setEditingSnapshot(null);
  };

  const handleDeleteSnapshot = (snapshotId: string) => {
    const updatedHistory: ActionHistory = {
      snapshots: actionHistory.snapshots.filter((s) => s.id !== snapshotId),
      lastUpdated: new Date(),
    };
    onUpdate(updatedHistory);
  };

  const getActionIcon = (type: ActionSnapshot["actionType"]) => {
    switch (type) {
      case "FIND":
        return <Target className="w-3 h-3" />;
      case "CLICK":
        return <MousePointer className="w-3 h-3" />;
      case "TYPE":
        return <Type className="w-3 h-3" />;
      case "DRAG":
        return <Move className="w-3 h-3" />;
      case "SCROLL":
        return <Move className="w-3 h-3 rotate-90" />;
      case "WAIT":
        return <Clock className="w-3 h-3" />;
    }
  };

  const getScreenshotName = (id: string) => {
    const screenshot = screenshots.find((s) => s.id === id);
    return screenshot?.name || "Unknown Screenshot";
  };

  const groupSnapshotsByScreenshot = () => {
    const groups = new Map<string, ActionSnapshot[]>();

    actionHistory.snapshots.forEach((snapshot) => {
      const key = snapshot.screenshotId;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(snapshot);
    });

    return Array.from(groups.entries());
  };

  return (
    <div className="border rounded-lg bg-white shadow-sm">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-gray-600" />
          <span className="font-medium">Action History</span>
          <span className="text-sm text-gray-500">
            ({actionHistory.snapshots.length} snapshots)
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="border-t px-4 py-3">
          {/* Screenshot Selector */}
          {screenshots.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">
                Current Screenshot
              </label>
              <select
                value={selectedScreenshot?.id || ""}
                onChange={(e) => {
                  const screenshot = screenshots.find(
                    (s) => s.id === e.target.value
                  );
                  setSelectedScreenshot(screenshot || null);
                }}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                {screenshots.map((screenshot) => (
                  <option key={screenshot.id} value={screenshot.id}>
                    {screenshot.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Add Snapshot Button */}
          <button
            onClick={() => setShowBuilder(true)}
            disabled={!selectedScreenshot}
            className="w-full mb-4 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            Add Action Snapshot
          </button>

          {/* Snapshots Grouped by Screenshot */}
          {actionHistory.snapshots.length > 0 ? (
            <div className="space-y-4">
              {groupSnapshotsByScreenshot().map(([screenshotId, snapshots]) => (
                <div
                  key={screenshotId}
                  className="border rounded-lg p-3 bg-gray-50"
                >
                  <div className="flex items-center gap-2 mb-2 text-sm font-medium">
                    <Camera className="w-4 h-4 text-gray-600" />
                    {getScreenshotName(screenshotId)}
                  </div>

                  <div className="space-y-2">
                    {snapshots.map((snapshot) => (
                      <div
                        key={snapshot.id}
                        className="bg-white border rounded p-2"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              {getActionIcon(snapshot.actionType)}
                              <span className="text-sm font-medium">
                                {snapshot.actionType}
                              </span>
                              {snapshot.actionSuccess && (
                                <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                                  Success
                                </span>
                              )}
                              {!snapshot.actionSuccess && (
                                <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded">
                                  Failure
                                </span>
                              )}
                            </div>

                            {/* Snapshot Details */}
                            <div className="text-xs text-gray-600 space-y-1">
                              {snapshot.matches.length > 0 && (
                                <div>Matches: {snapshot.matches.length}</div>
                              )}
                              {snapshot.text && (
                                <div>Text: "{snapshot.text}"</div>
                              )}
                              {snapshot.nextScreenshotId && (
                                <div className="flex items-center gap-1">
                                  <ArrowRight className="w-3 h-3" />
                                  Transitions to:{" "}
                                  {getScreenshotName(snapshot.nextScreenshotId)}
                                </div>
                              )}
                              <div>Duration: {snapshot.duration}ms</div>
                            </div>

                            {/* Active States */}
                            {snapshot.activeStates.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {snapshot.activeStates.map((state) => (
                                  <span
                                    key={state}
                                    className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded"
                                  >
                                    {state}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 ml-2">
                            <button
                              onClick={() => setEditingSnapshot(snapshot)}
                              className="p-1 text-gray-500 hover:text-blue-600 transition-colors"
                              title="Edit"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleDeleteSnapshot(snapshot.id)}
                              className="p-1 text-gray-500 hover:text-red-600 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No action snapshots yet</p>
              <p className="text-xs mt-1">
                Add snapshots to define test scenarios
              </p>
            </div>
          )}

          {/* Last Updated */}
          {actionHistory.lastUpdated && (
            <div className="mt-4 pt-3 border-t text-xs text-gray-500 text-center">
              Last updated:{" "}
              {new Date(actionHistory.lastUpdated).toLocaleString()}
            </div>
          )}
        </div>
      )}

      {/* ActionSnapshot Builder Modal */}
      {showBuilder && selectedScreenshot && (
        <ActionSnapshotBuilder
          currentScreenshot={selectedScreenshot}
          screenshots={screenshots}
          stateId={stateId}
          stateName={stateName}
          activeStates={activeStates}
          onSave={handleAddSnapshot}
          onCancel={() => setShowBuilder(false)}
        />
      )}

      {/* Edit Modal - Reuse Builder with existing data */}
      {editingSnapshot && selectedScreenshot && (
        <ActionSnapshotBuilder
          currentScreenshot={selectedScreenshot}
          screenshots={screenshots}
          stateId={stateId}
          stateName={stateName}
          activeStates={editingSnapshot.activeStates}
          onSave={handleUpdateSnapshot}
          onCancel={() => setEditingSnapshot(null)}
        />
      )}
    </div>
  );
};

export default ActionHistoryManager;
