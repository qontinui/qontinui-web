import React, { useState } from "react";
import {
  Camera,
  Target,
  MousePointer,
  Type,
  Move,
  Clock,
  Check,
  X,
  Plus,
  ChevronRight,
} from "lucide-react";
import { Screenshot } from "../../types/Screenshot";
import { ActionSnapshot } from "../../lib/integration-testing-framework";

interface ActionSnapshotBuilderProps {
  currentScreenshot: Screenshot;
  screenshots: Screenshot[];
  stateId: string;
  stateName: string;
  activeStates: string[];
  onSave: (snapshot: ActionSnapshot) => void;
  onCancel: () => void;
}

export const ActionSnapshotBuilder: React.FC<ActionSnapshotBuilderProps> = ({
  currentScreenshot,
  screenshots,
  stateId,
  stateName,
  activeStates,
  onSave,
  onCancel,
}) => {
  const [actionType, setActionType] =
    useState<ActionSnapshot["actionType"]>("FIND");
  const [nextScreenshotId, setNextScreenshotId] = useState<
    string | undefined
  >();
  const [actionSuccess, setActionSuccess] = useState(true);
  const [resultSuccess, setResultSuccess] = useState(true);
  const [duration, setDuration] = useState(100);
  const [text, setText] = useState<string>("");
  const [matches, setMatches] = useState<any[]>([]);
  const [showScreenshotSelector, setShowScreenshotSelector] = useState(false);

  // Action configuration
  const [actionConfig, setActionConfig] = useState({
    similarity: 0.8,
    waitTime: 0,
    mouseButton: "LEFT",
    offset: { x: 0, y: 0 },
  });

  const actionTypes: ActionSnapshot["actionType"][] = [
    "FIND",
    "CLICK",
    "TYPE",
    "DRAG",
    "SCROLL",
    "WAIT",
  ];

  const handleAddMatch = () => {
    const newMatch = {
      region: { x: 0, y: 0, width: 100, height: 100 },
      score: 0.95,
      stateImageId: undefined,
    };
    setMatches([...matches, newMatch]);
  };

  const handleUpdateMatch = (index: number, field: string, value: any) => {
    const updated = [...matches];
    if (field.includes(".")) {
      const [parent, child] = field.split(".");
      updated[index][parent][child] = value;
    } else {
      updated[index][field] = value;
    }
    setMatches(updated);
  };

  const handleRemoveMatch = (index: number) => {
    setMatches(matches.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const snapshot: ActionSnapshot = {
      id: generateId(),
      timestamp: new Date(),
      actionType,
      actionConfig,
      matches,
      stateName,
      stateId,
      activeStates,
      actionSuccess,
      resultSuccess,
      screenshotId: currentScreenshot.id,
      nextScreenshotId,
      duration,
      text: actionType === "TYPE" ? text : undefined,
    };

    onSave(snapshot);
  };

  const getActionIcon = (type: ActionSnapshot["actionType"]) => {
    switch (type) {
      case "FIND":
        return <Target className="w-4 h-4" />;
      case "CLICK":
        return <MousePointer className="w-4 h-4" />;
      case "TYPE":
        return <Type className="w-4 h-4" />;
      case "DRAG":
        return <Move className="w-4 h-4" />;
      case "SCROLL":
        return <Move className="w-4 h-4 rotate-90" />;
      case "WAIT":
        return <Clock className="w-4 h-4" />;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="border-b p-4">
          <h2 className="text-xl font-semibold">Build Action Snapshot</h2>
          <p className="text-sm text-gray-600 mt-1">
            Create a snapshot for state: {stateName} ({stateId})
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Current Screenshot Info */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Camera className="w-4 h-4 text-gray-600" />
              <span className="font-medium">Current Screenshot</span>
            </div>
            <p className="text-sm text-gray-600">{currentScreenshot.name}</p>
            <p className="text-xs text-gray-500">ID: {currentScreenshot.id}</p>
          </div>

          {/* Action Type Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Action Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {actionTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => setActionType(type)}
                  className={`flex items-center gap-2 px-3 py-2 rounded border transition-colors ${
                    actionType === type
                      ? "bg-blue-50 border-blue-300 text-blue-700"
                      : "bg-white border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {getActionIcon(type)}
                  <span className="text-sm">{type}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Action Configuration */}
          <div className="space-y-4">
            <h3 className="font-medium">Action Configuration</h3>

            {actionType === "FIND" && (
              <div>
                <label className="block text-sm font-medium mb-1">
                  Similarity Threshold
                </label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  value={actionConfig.similarity}
                  onChange={(e) =>
                    setActionConfig({
                      ...actionConfig,
                      similarity: parseFloat(e.target.value),
                    })
                  }
                  className="w-full px-3 py-1 border rounded"
                />
              </div>
            )}

            {actionType === "CLICK" && (
              <div className="space-y-2">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Mouse Button
                  </label>
                  <select
                    value={actionConfig.mouseButton}
                    onChange={(e) =>
                      setActionConfig({
                        ...actionConfig,
                        mouseButton: e.target.value,
                      })
                    }
                    className="w-full px-3 py-1 border rounded"
                  >
                    <option value="LEFT">Left Click</option>
                    <option value="RIGHT">Right Click</option>
                    <option value="MIDDLE">Middle Click</option>
                    <option value="DOUBLE">Double Click</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Offset X
                    </label>
                    <input
                      type="number"
                      value={actionConfig.offset.x}
                      onChange={(e) =>
                        setActionConfig({
                          ...actionConfig,
                          offset: {
                            ...actionConfig.offset,
                            x: parseInt(e.target.value),
                          },
                        })
                      }
                      className="w-full px-3 py-1 border rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Offset Y
                    </label>
                    <input
                      type="number"
                      value={actionConfig.offset.y}
                      onChange={(e) =>
                        setActionConfig({
                          ...actionConfig,
                          offset: {
                            ...actionConfig.offset,
                            y: parseInt(e.target.value),
                          },
                        })
                      }
                      className="w-full px-3 py-1 border rounded"
                    />
                  </div>
                </div>
              </div>
            )}

            {actionType === "TYPE" && (
              <div>
                <label className="block text-sm font-medium mb-1">
                  Text to Type
                </label>
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Enter text to type..."
                  className="w-full px-3 py-1 border rounded"
                />
              </div>
            )}

            {actionType === "WAIT" && (
              <div>
                <label className="block text-sm font-medium mb-1">
                  Wait Time (ms)
                </label>
                <input
                  type="number"
                  min="0"
                  value={actionConfig.waitTime}
                  onChange={(e) =>
                    setActionConfig({
                      ...actionConfig,
                      waitTime: parseInt(e.target.value),
                    })
                  }
                  className="w-full px-3 py-1 border rounded"
                />
              </div>
            )}
          </div>

          {/* Matches */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium">Match Regions</h3>
              <button
                onClick={handleAddMatch}
                className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
              >
                <Plus className="w-4 h-4" />
                Add Match
              </button>
            </div>

            <div className="space-y-2">
              {matches.map((match, index) => (
                <div key={index} className="border rounded p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      Match #{index + 1}
                    </span>
                    <button
                      onClick={() => handleRemoveMatch(index)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <label className="block text-xs text-gray-600">X</label>
                      <input
                        type="number"
                        value={match.region.x}
                        onChange={(e) =>
                          handleUpdateMatch(
                            index,
                            "region.x",
                            parseInt(e.target.value)
                          )
                        }
                        className="w-full px-2 py-1 text-sm border rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600">Y</label>
                      <input
                        type="number"
                        value={match.region.y}
                        onChange={(e) =>
                          handleUpdateMatch(
                            index,
                            "region.y",
                            parseInt(e.target.value)
                          )
                        }
                        className="w-full px-2 py-1 text-sm border rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600">
                        Width
                      </label>
                      <input
                        type="number"
                        value={match.region.width}
                        onChange={(e) =>
                          handleUpdateMatch(
                            index,
                            "region.width",
                            parseInt(e.target.value)
                          )
                        }
                        className="w-full px-2 py-1 text-sm border rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600">
                        Height
                      </label>
                      <input
                        type="number"
                        value={match.region.height}
                        onChange={(e) =>
                          handleUpdateMatch(
                            index,
                            "region.height",
                            parseInt(e.target.value)
                          )
                        }
                        className="w-full px-2 py-1 text-sm border rounded"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-600">Score</label>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={match.score}
                      onChange={(e) =>
                        handleUpdateMatch(
                          index,
                          "score",
                          parseFloat(e.target.value)
                        )
                      }
                      className="w-full px-2 py-1 text-sm border rounded"
                    />
                  </div>
                </div>
              ))}

              {matches.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">
                  No matches defined. Add matches to define where this action
                  finds elements.
                </p>
              )}
            </div>
          </div>

          {/* Success Flags */}
          <div className="space-y-2">
            <h3 className="font-medium">Success Configuration</h3>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={actionSuccess}
                onChange={(e) => setActionSuccess(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">Action succeeds</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={resultSuccess}
                onChange={(e) => setResultSuccess(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">Result succeeds</span>
            </label>
          </div>

          {/* Next Screenshot Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium">Next Screenshot (End State)</h3>
              <button
                onClick={() =>
                  setShowScreenshotSelector(!showScreenshotSelector)
                }
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                {nextScreenshotId ? "Change" : "Select"} Screenshot
              </button>
            </div>

            {nextScreenshotId ? (
              <div className="bg-blue-50 p-3 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ChevronRight className="w-4 h-4 text-blue-600" />
                  <div>
                    <p className="text-sm font-medium">
                      {screenshots.find((s) => s.id === nextScreenshotId)?.name}
                    </p>
                    <p className="text-xs text-gray-600">
                      Transition to this screenshot after action
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setNextScreenshotId(undefined)}
                  className="text-red-500 hover:text-red-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                No transition - stays on current screenshot
              </p>
            )}

            {showScreenshotSelector && (
              <div className="mt-2 max-h-48 overflow-y-auto border rounded-lg">
                {screenshots
                  .filter((s) => s.id !== currentScreenshot.id)
                  .map((screenshot) => (
                    <button
                      key={screenshot.id}
                      onClick={() => {
                        setNextScreenshotId(screenshot.id);
                        setShowScreenshotSelector(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-b-0"
                    >
                      <p className="text-sm font-medium">{screenshot.name}</p>
                      <p className="text-xs text-gray-500">{screenshot.id}</p>
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Duration */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Expected Duration (ms)
            </label>
            <input
              type="number"
              min="0"
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
              className="w-full px-3 py-1 border rounded"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t p-4 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 border rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            Save Snapshot
          </button>
        </div>
      </div>
    </div>
  );
};

function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

export default ActionSnapshotBuilder;
