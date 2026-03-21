import React from "react";
import { Edit2, Check, X, Trash2 } from "lucide-react";
import { Screenshot } from "../../../types/Screenshot";
import { QontinuiSidebar, QontinuiCard, QontinuiInput } from "../../qontinui";

interface ScreenshotSidebarProps {
  screenshots: Screenshot[];
  selectedScreenshot: Screenshot | null;
  editingScreenshotId: string | null;
  editingName: string;
  onSelect: (screenshot: Screenshot) => void;
  onDelete: (screenshotId: string) => void;
  onStartEdit: (screenshot: Screenshot) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditingNameChange: (name: string) => void;
}

export const ScreenshotSidebar: React.FC<ScreenshotSidebarProps> = ({
  screenshots,
  selectedScreenshot,
  editingScreenshotId,
  editingName,
  onSelect,
  onDelete,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditingNameChange,
}) => {
  return (
    <QontinuiSidebar className="overflow-y-auto">
      <h3 className="text-sm font-medium text-text-secondary mb-3">
        Screenshots ({screenshots.length})
      </h3>

      <div className="space-y-2">
        {screenshots.map((screenshot) => (
          <QontinuiCard
            key={screenshot.id}
            selected={selectedScreenshot?.id === screenshot.id}
            hoverable
            onClick={() => onSelect(screenshot)}
            className="group cursor-pointer p-2"
          >
            {/* Thumbnail */}
            <div className="aspect-video relative overflow-hidden rounded bg-surface-canvas">
              {screenshot.imageData ? (
                /* eslint-disable-next-line @next/next/no-img-element -- Screenshot data URL from user upload */
                <img
                  src={screenshot.imageData}
                  alt={screenshot.name}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-text-muted text-xs">
                  No image
                </div>
              )}
            </div>

            {/* Name editing */}
            {editingScreenshotId === screenshot.id ? (
              <div
                role="group"
                className="mt-2 flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
              >
                <QontinuiInput
                  value={editingName}
                  onChange={(e) => onEditingNameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onSaveEdit();
                    } else if (e.key === "Escape") {
                      onCancelEdit();
                    }
                  }}
                  className="flex-1 text-xs"
                />
                <button
                  onClick={onSaveEdit}
                  className="p-1 bg-brand-success text-black rounded hover:bg-brand-success/90"
                  title="Save (Enter)"
                >
                  <Check className="w-3 h-3" />
                </button>
                <button
                  onClick={onCancelEdit}
                  className="p-1 bg-surface-raised text-white rounded hover:bg-surface-raised/80"
                  title="Cancel (Esc)"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-1">
                <p className="flex-1 text-xs font-medium truncate text-text-secondary">
                  {screenshot.name}
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartEdit(screenshot);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-brand-primary transition-opacity"
                  title="Edit name"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Delete button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(screenshot.id);
              }}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 bg-red-500/90 text-white rounded hover:bg-red-600 transition-opacity"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </QontinuiCard>
        ))}
      </div>
    </QontinuiSidebar>
  );
};
