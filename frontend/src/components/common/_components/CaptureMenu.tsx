import React from "react";
import { Camera } from "lucide-react";
import { MonitorSelector } from "@/components/monitor-selector";
import type { RunnerMonitor } from "@/lib/schemas/geometry";

const DELAY_OPTIONS = [0, 3, 5, 10];

interface CaptureMenuProps {
  menuRef: React.RefObject<HTMLDivElement | null>;
  menuPosition: { top: number; left: number };
  captureDelay: number;
  onDelayChange: (delay: number) => void;
  selectedMonitors: number[];
  onMonitorSelectionChange: (monitors: number[]) => void;
  runnerMonitors: RunnerMonitor[];
  isRunnerConnected: boolean;
  onCapture: () => void;
}

export const CaptureMenu: React.FC<CaptureMenuProps> = ({
  menuRef,
  menuPosition,
  captureDelay,
  onDelayChange,
  selectedMonitors,
  onMonitorSelectionChange,
  runnerMonitors,
  isRunnerConnected,
  onCapture,
}) => {
  return (
    <div
      ref={menuRef}
      className="fixed bg-surface-raised rounded-lg shadow-lg z-50 border border-border-default p-3"
      style={{ top: menuPosition.top, left: menuPosition.left }}
    >
      <div className="mb-3">
        <p className="text-xs text-text-muted block mb-2">Capture Delay</p>
        <div className="flex gap-1">
          {DELAY_OPTIONS.map((delay) => (
            <button
              key={delay}
              onClick={() => onDelayChange(delay)}
              className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                captureDelay === delay
                  ? "bg-brand-secondary text-white"
                  : "bg-surface-raised text-text-secondary hover:bg-surface-raised/80"
              }`}
            >
              {delay}s
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <MonitorSelector
          monitors={selectedMonitors}
          onChange={onMonitorSelectionChange}
          runnerMonitors={runnerMonitors}
          isRunnerConnected={isRunnerConnected}
          label="Select Monitors"
          showLabel={true}
          showConnectionStatus={true}
        />
      </div>

      <button
        onClick={onCapture}
        disabled={selectedMonitors.length === 0}
        className="w-full px-3 py-2 bg-brand-secondary text-white rounded-md hover:bg-brand-secondary/90 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        <Camera className="w-4 h-4" />
        Capture{" "}
        {selectedMonitors.length > 1
          ? `${selectedMonitors.length} Monitors`
          : "Screen"}
        {captureDelay > 0 && ` (${captureDelay}s delay)`}
      </button>
    </div>
  );
};
