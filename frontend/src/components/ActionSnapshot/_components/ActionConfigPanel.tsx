import React from "react";
import { ActionSnapshot } from "../../../lib/integration-testing-framework";
import { ActionConfigState } from "../types";

interface ActionConfigPanelProps {
  actionType: ActionSnapshot["actionType"];
  actionConfig: ActionConfigState;
  text: string;
  onUpdateConfig: (updates: Partial<ActionConfigState>) => void;
  onUpdateOffset: (axis: "x" | "y", value: number) => void;
  onTextChange: (text: string) => void;
}

export const ActionConfigPanel: React.FC<ActionConfigPanelProps> = ({
  actionType,
  actionConfig,
  text,
  onUpdateConfig,
  onUpdateOffset,
  onTextChange,
}) => {
  return (
    <div className="space-y-4">
      <h3 className="font-medium">Action Configuration</h3>

      {actionType === "FIND" && (
        <div>
          <label
            htmlFor="asb-similarity"
            className="block text-sm font-medium mb-1"
          >
            Similarity Threshold
          </label>
          <input
            id="asb-similarity"
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={actionConfig.similarity}
            onChange={(e) =>
              onUpdateConfig({ similarity: parseFloat(e.target.value) })
            }
            className="w-full px-3 py-1 border rounded"
          />
        </div>
      )}

      {actionType === "CLICK" && (
        <div className="space-y-2">
          <div>
            <label
              htmlFor="asb-mouse-button"
              className="block text-sm font-medium mb-1"
            >
              Mouse Button
            </label>
            <select
              id="asb-mouse-button"
              value={actionConfig.mouseButton}
              onChange={(e) => onUpdateConfig({ mouseButton: e.target.value })}
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
              <label
                htmlFor="asb-offset-x"
                className="block text-sm font-medium mb-1"
              >
                Offset X
              </label>
              <input
                id="asb-offset-x"
                type="number"
                value={actionConfig.offset.x}
                onChange={(e) => onUpdateOffset("x", parseInt(e.target.value))}
                className="w-full px-3 py-1 border rounded"
              />
            </div>
            <div>
              <label
                htmlFor="asb-offset-y"
                className="block text-sm font-medium mb-1"
              >
                Offset Y
              </label>
              <input
                id="asb-offset-y"
                type="number"
                value={actionConfig.offset.y}
                onChange={(e) => onUpdateOffset("y", parseInt(e.target.value))}
                className="w-full px-3 py-1 border rounded"
              />
            </div>
          </div>
        </div>
      )}

      {actionType === "TYPE" && (
        <div>
          <label htmlFor="asb-text" className="block text-sm font-medium mb-1">
            Text to Type
          </label>
          <input
            id="asb-text"
            type="text"
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder="Enter text to type..."
            className="w-full px-3 py-1 border rounded"
          />
        </div>
      )}
    </div>
  );
};
