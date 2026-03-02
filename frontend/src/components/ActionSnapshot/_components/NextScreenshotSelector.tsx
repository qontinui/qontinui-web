import React from "react";
import { ChevronRight, X } from "lucide-react";
import { Screenshot } from "../../../types/Screenshot";

interface NextScreenshotSelectorProps {
  currentScreenshotId: string;
  screenshots: Screenshot[];
  nextScreenshotId: string | undefined;
  showSelector: boolean;
  onToggleSelector: () => void;
  onSelect: (id: string) => void;
  onClear: () => void;
}

export const NextScreenshotSelector: React.FC<NextScreenshotSelectorProps> = ({
  currentScreenshotId,
  screenshots,
  nextScreenshotId,
  showSelector,
  onToggleSelector,
  onSelect,
  onClear,
}) => {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium">Next Screenshot (End State)</h3>
        <button
          onClick={onToggleSelector}
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
              <p className="text-xs text-text-muted">
                Transition to this screenshot after action
              </p>
            </div>
          </div>
          <button onClick={onClear} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <p className="text-sm text-text-muted">
          No transition - stays on current screenshot
        </p>
      )}

      {showSelector && (
        <div className="mt-2 max-h-48 overflow-y-auto border rounded-lg">
          {screenshots
            .filter((s) => s.id !== currentScreenshotId)
            .map((screenshot) => (
              <button
                key={screenshot.id}
                onClick={() => onSelect(screenshot.id)}
                className="w-full text-left px-3 py-2 hover:bg-surface-raised/80 border-b last:border-b-0"
              >
                <p className="text-sm font-medium">{screenshot.name}</p>
                <p className="text-xs text-text-muted">{screenshot.id}</p>
              </button>
            ))}
        </div>
      )}
    </div>
  );
};
