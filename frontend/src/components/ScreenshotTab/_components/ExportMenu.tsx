import React from "react";
import { Download, FileJson, FileCode } from "lucide-react";

interface ExportMenuProps {
  onExportJson: () => void;
  onExportPython: () => void;
  onExportAll: () => void;
}

export const ExportMenu: React.FC<ExportMenuProps> = ({
  onExportJson,
  onExportPython,
  onExportAll,
}) => {
  return (
    <div className="absolute right-0 mt-2 w-56 bg-surface-raised rounded-md shadow-lg z-10 border border-border-default">
      <div className="py-1">
        <button
          onClick={onExportJson}
          className="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-surface-raised flex items-center gap-2"
        >
          <FileJson className="w-4 h-4" />
          Export as JSON
          <span className="text-xs text-text-muted ml-auto">qontinui</span>
        </button>
        <button
          onClick={onExportPython}
          className="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-surface-raised flex items-center gap-2"
        >
          <FileCode className="w-4 h-4" />
          Export as Python Code
        </button>
        <div className="border-t border-border-default my-1"></div>
        <button
          onClick={onExportAll}
          className="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-surface-raised flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Export Raw Data
          <span className="text-xs text-text-muted ml-auto">debug</span>
        </button>
      </div>
    </div>
  );
};
