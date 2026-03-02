import React from "react";
import { X, Check } from "lucide-react";

interface PanelHeaderProps {
  showSaved: boolean;
  onDelete: () => void;
}

const PanelHeader: React.FC<PanelHeaderProps> = ({ showSaved, onDelete }) => (
  <div className="p-4 border-b bg-surface-raised">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold text-text-primary">
          Location Properties
        </h3>
        {showSaved && (
          <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
            <Check className="w-3 h-3" />
            Saved
          </span>
        )}
      </div>
      <button
        onClick={onDelete}
        className="p-1 hover:bg-surface-raised/80 rounded"
        title="Delete location"
      >
        <X className="w-4 h-4 text-text-secondary" />
      </button>
    </div>
  </div>
);

export default PanelHeader;
