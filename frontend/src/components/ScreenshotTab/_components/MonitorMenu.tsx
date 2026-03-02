import React from "react";
import { Monitor, Loader2 } from "lucide-react";
import { MonitorInfo } from "../types";

interface MonitorMenuProps {
  availableMonitors: MonitorInfo[];
  onCapture: (monitorIndex: number | null) => void;
}

export const MonitorMenu: React.FC<MonitorMenuProps> = ({
  availableMonitors,
  onCapture,
}) => {
  return (
    <div className="absolute left-0 mt-2 w-64 bg-surface-raised rounded-md shadow-lg z-10 border border-border-default">
      <div className="py-1">
        <div className="px-4 py-2 text-xs text-text-muted border-b border-border-default">
          Select monitor to capture
        </div>
        {availableMonitors.length === 0 ? (
          <div className="px-4 py-3 text-sm text-text-muted flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading monitors...
          </div>
        ) : (
          <>
            {availableMonitors.map((monitor) => (
              <button
                key={monitor.index}
                onClick={() => onCapture(monitor.index)}
                className="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-surface-raised flex items-center gap-2"
              >
                <Monitor className="w-4 h-4" />
                Monitor {monitor.index + 1}
                {monitor.is_primary && (
                  <span className="text-xs text-brand-success ml-1">
                    (Primary)
                  </span>
                )}
                <span className="text-xs text-text-muted ml-auto">
                  {monitor.width}x{monitor.height}
                </span>
              </button>
            ))}
            {availableMonitors.length > 1 && (
              <>
                <div className="border-t border-border-default my-1"></div>
                <button
                  onClick={() => onCapture(null)}
                  className="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-surface-raised flex items-center gap-2"
                >
                  <Monitor className="w-4 h-4" />
                  All Monitors Combined
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};
