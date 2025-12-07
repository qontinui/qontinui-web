import React, { useState } from "react";
import { Bug, X, Maximize2, Minimize2 } from "lucide-react";
import { useExecutionDebugger } from "../../stores/execution-debugger-store";
import { ExecutionControls } from "./ExecutionControls";
import { ActionTimeline } from "./ActionTimeline";
import { VariableInspector } from "./VariableInspector";
import { ExecutionLog } from "./ExecutionLog";
import type { Action } from "../../lib/action-schema/action-types";

interface ExecutionDebuggerProps {
  actions: Action[];
  onExecute?: () => void;
  onStop?: () => void;
  onStep?: () => void;
  isOpen?: boolean;
  onToggle?: () => void;
}

type TabType = "timeline" | "variables" | "log";

export const ExecutionDebugger: React.FC<ExecutionDebuggerProps> = ({
  actions,
  onExecute,
  onStop,
  onStep,
  isOpen = true,
  onToggle,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>("timeline");
  const [isExpanded, setIsExpanded] = useState(false);
  const { debugEnabled, setDebugEnabled, state, metrics, currentActionIndex } =
    useExecutionDebugger();

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-4 right-4 p-3 bg-blue-600 text-white rounded-lg shadow-lg hover:bg-blue-700 transition-colors flex items-center gap-2 z-50"
        title="Open debugger"
      >
        <Bug className="w-5 h-5" />
        <span className="text-sm font-medium">Debugger</span>
      </button>
    );
  }

  const tabs: { id: TabType; label: string; badge?: number }[] = [
    { id: "timeline", label: "Timeline", badge: actions.length },
    {
      id: "variables",
      label: "Variables",
      badge: Object.keys(useExecutionDebugger.getState().context.variables)
        .length,
    },
    {
      id: "log",
      label: "Log",
      badge: useExecutionDebugger.getState().logs.length,
    },
  ];

  return (
    <div
      className={`fixed ${
        isExpanded ? "inset-4" : "right-0 top-0 bottom-0 w-96"
      } bg-white shadow-2xl border-l flex flex-col z-40 transition-all duration-300`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b bg-gray-50">
        <div className="flex items-center gap-2">
          <Bug className="w-5 h-5 text-blue-600" />
          <h2 className="font-bold text-sm">Execution Debugger</h2>
          <label className="flex items-center gap-2 ml-4">
            <input
              type="checkbox"
              checked={debugEnabled}
              onChange={(e) => setDebugEnabled(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-600">Enable</span>
          </label>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 hover:bg-gray-200 rounded transition-colors"
            title={isExpanded ? "Minimize" : "Maximize"}
          >
            {isExpanded ? (
              <Minimize2 className="w-4 h-4 text-gray-600" />
            ) : (
              <Maximize2 className="w-4 h-4 text-gray-600" />
            )}
          </button>
          {onToggle && (
            <button
              onClick={onToggle}
              className="p-1.5 hover:bg-gray-200 rounded transition-colors"
              title="Close debugger"
            >
              <X className="w-4 h-4 text-gray-600" />
            </button>
          )}
        </div>
      </div>

      {/* Execution Controls */}
      {debugEnabled && (
        <ExecutionControls
          onExecute={onExecute}
          onStop={onStop}
          onStep={onStep}
        />
      )}

      {/* Stats Bar */}
      {debugEnabled && state !== "idle" && (
        <div className="flex items-center gap-4 px-3 py-2 bg-blue-50 border-b text-xs">
          <div className="flex items-center gap-2">
            <span className="text-gray-600">Progress:</span>
            <span className="font-semibold text-gray-900">
              {currentActionIndex >= 0 ? currentActionIndex + 1 : 0} /{" "}
              {actions.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-600">Success Rate:</span>
            <span className="font-semibold text-gray-900">
              {metrics.successRate.toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-600">Avg Time:</span>
            <span className="font-semibold text-gray-900">
              {metrics.averageActionTime.toFixed(0)}ms
            </span>
          </div>
        </div>
      )}

      {/* Tabs */}
      {debugEnabled && (
        <div className="flex border-b bg-white">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors relative ${
                activeTab === tab.id
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span
                  className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                    activeTab === tab.id
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {!debugEnabled ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 p-8 text-center">
            <Bug className="w-16 h-16 mb-4 text-gray-400" />
            <h3 className="text-lg font-semibold mb-2">Debugger Disabled</h3>
            <p className="text-sm">
              Enable the debugger to track execution state, variables, and logs
              in real-time.
            </p>
            <button
              onClick={() => setDebugEnabled(true)}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Enable Debugger
            </button>
          </div>
        ) : (
          <>
            {activeTab === "timeline" && (
              <ActionTimeline
                actions={actions}
                onActionClick={(index) => {
                  // Could implement jump-to-action functionality here
                  console.log("Clicked action:", index);
                }}
              />
            )}
            {activeTab === "variables" && <VariableInspector />}
            {activeTab === "log" && <ExecutionLog />}
          </>
        )}
      </div>

      {/* Footer with keyboard shortcuts */}
      {debugEnabled && (
        <div className="border-t p-2 bg-gray-50 text-xs text-gray-600">
          <div className="flex items-center justify-between">
            <span>Shortcuts:</span>
            <div className="flex gap-3">
              <span>
                <kbd className="px-1.5 py-0.5 bg-white border rounded">F5</kbd>{" "}
                Play
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 bg-white border rounded">F10</kbd>{" "}
                Step
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 bg-white border rounded">F9</kbd>{" "}
                Breakpoint
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExecutionDebugger;
