import React from "react";
import { Plus, X } from "lucide-react";
import { Match } from "../types";

interface MatchRegionEditorProps {
  matches: Match[];
  onAdd: () => void;
  onUpdate: (index: number, field: string, value: number | string) => void;
  onRemove: (index: number) => void;
}

const REGION_FIELDS = [
  { key: "region.x", label: "X" },
  { key: "region.y", label: "Y" },
  { key: "region.width", label: "Width" },
  { key: "region.height", label: "Height" },
] as const;

function getRegionValue(match: Match, field: string): number {
  switch (field) {
    case "region.x":
      return match.region.x;
    case "region.y":
      return match.region.y;
    case "region.width":
      return match.region.width;
    case "region.height":
      return match.region.height;
    default:
      return 0;
  }
}

export const MatchRegionEditor: React.FC<MatchRegionEditorProps> = ({
  matches,
  onAdd,
  onUpdate,
  onRemove,
}) => {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium">Match Regions</h3>
        <button
          onClick={onAdd}
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
              <span className="text-sm font-medium">Match #{index + 1}</span>
              <button
                onClick={() => onRemove(index)}
                className="text-red-500 hover:text-red-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {REGION_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <p className="block text-xs text-text-muted">{label}</p>
                  <input
                    type="number"
                    value={getRegionValue(match, key)}
                    onChange={(e) =>
                      onUpdate(index, key, parseInt(e.target.value))
                    }
                    className="w-full px-2 py-1 text-sm border rounded"
                  />
                </div>
              ))}
            </div>

            <div>
              <p className="block text-xs text-text-muted">Score</p>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={match.score}
                onChange={(e) =>
                  onUpdate(index, "score", parseFloat(e.target.value))
                }
                className="w-full px-2 py-1 text-sm border rounded"
              />
            </div>
          </div>
        ))}

        {matches.length === 0 && (
          <p className="text-sm text-text-muted text-center py-4">
            No matches defined. Add matches to define where this action finds
            elements.
          </p>
        )}
      </div>
    </div>
  );
};
