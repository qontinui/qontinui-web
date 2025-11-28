import React, { useState, useRef, useEffect } from "react";
import {
  Terminal,
  Download,
  Trash2,
  Filter,
  ChevronDown,
  Info,
  AlertTriangle,
  XCircle,
  Bug,
  Circle,
} from "lucide-react";
import { useExecutionDebugger } from "../../stores/execution-debugger-store";
import { ExecutionLogEntry } from "../../types/debugger/execution-types";

const LOG_LEVEL_CONFIG = {
  info: {
    icon: Info,
    color: "text-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-200",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-yellow-600",
    bg: "bg-yellow-50",
    border: "border-yellow-200",
  },
  error: {
    icon: XCircle,
    color: "text-red-600",
    bg: "bg-red-50",
    border: "border-red-200",
  },
  debug: {
    icon: Bug,
    color: "text-gray-600",
    bg: "bg-gray-50",
    border: "border-gray-200",
  },
};

const CATEGORY_COLORS = {
  action: "text-blue-600",
  condition: "text-purple-600",
  loop: "text-green-600",
  variable: "text-orange-600",
  system: "text-gray-600",
};

interface LogEntryProps {
  entry: ExecutionLogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

const LogEntry: React.FC<LogEntryProps> = ({ entry, isExpanded, onToggle }) => {
  const config = LOG_LEVEL_CONFIG[entry.level];
  const Icon = config.icon;
  const hasDetails = entry.details !== undefined;

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  };

  return (
    <div
      className={`border-l-2 ${config.border} ${config.bg} p-2 mb-1 rounded-r`}
    >
      <div className="flex items-start gap-2">
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${config.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono text-gray-500">
                  {formatTimestamp(entry.timestamp)}
                </span>
                <span
                  className={`text-xs font-medium uppercase ${
                    CATEGORY_COLORS[entry.category]
                  }`}
                >
                  {entry.category}
                </span>
                {entry.actionIndex !== undefined && (
                  <span className="text-xs text-gray-500">
                    Action {entry.actionIndex}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-900 break-words">
                {entry.message}
              </p>
            </div>
            {hasDetails && (
              <button
                onClick={onToggle}
                className="flex-shrink-0 p-1 hover:bg-white rounded transition-colors"
              >
                <ChevronDown
                  className={`w-4 h-4 text-gray-500 transition-transform ${
                    isExpanded ? "" : "-rotate-90"
                  }`}
                />
              </button>
            )}
          </div>
          {isExpanded && hasDetails && (
            <div className="mt-2 p-2 bg-white rounded border text-xs font-mono overflow-x-auto">
              <pre className="text-gray-700">
                {JSON.stringify(entry.details, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const ExecutionLog: React.FC = () => {
  const { logs, clearLogs, exportLogs } = useExecutionDebugger();
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(
    new Set()
  );
  const [levelFilter, setLevelFilter] = useState<
    Set<ExecutionLogEntry["level"]>
  >(new Set(["info", "warning", "error", "debug"]));
  const [categoryFilter, setCategoryFilter] = useState<
    Set<ExecutionLogEntry["category"]>
  >(new Set(["action", "condition", "loop", "variable", "system"]));
  const [autoScroll, setAutoScroll] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  // Detect if user manually scrolls up
  useEffect(() => {
    const container = logContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const isAtBottom =
        container.scrollHeight - container.scrollTop <=
        container.clientHeight + 50;
      setAutoScroll(isAtBottom);
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  const toggleExpanded = (entryId: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  const toggleLevelFilter = (level: ExecutionLogEntry["level"]) => {
    setLevelFilter((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const toggleCategoryFilter = (category: ExecutionLogEntry["category"]) => {
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleExport = () => {
    const logData = exportLogs();
    const blob = new Blob([logData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `execution-log-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredLogs = logs.filter(
    (log) => levelFilter.has(log.level) && categoryFilter.has(log.category)
  );

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="p-3 border-b border-gray-700 bg-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-blue-400" />
            <h3 className="font-semibold text-sm">Execution Log</h3>
            <span className="text-xs text-gray-400">
              ({filteredLogs.length}/{logs.length})
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-1.5 rounded transition-colors ${
                showFilters
                  ? "bg-blue-600 text-white"
                  : "hover:bg-gray-700 text-gray-400"
              }`}
              title="Toggle filters"
            >
              <Filter className="w-4 h-4" />
            </button>
            <button
              onClick={handleExport}
              disabled={logs.length === 0}
              className="p-1.5 hover:bg-gray-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-gray-400"
              title="Export logs"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={clearLogs}
              disabled={logs.length === 0}
              className="p-1.5 hover:bg-gray-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-gray-400"
              title="Clear logs"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="mt-3 pt-3 border-t border-gray-700 space-y-2">
            {/* Level Filter */}
            <div>
              <div className="text-xs font-semibold text-gray-400 mb-1">
                Level
              </div>
              <div className="flex gap-2 flex-wrap">
                {(["info", "warning", "error", "debug"] as const).map(
                  (level) => (
                    <button
                      key={level}
                      onClick={() => toggleLevelFilter(level)}
                      className={`px-2 py-1 text-xs rounded transition-colors ${
                        levelFilter.has(level)
                          ? "bg-blue-600 text-white"
                          : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                      }`}
                    >
                      {level}
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Category Filter */}
            <div>
              <div className="text-xs font-semibold text-gray-400 mb-1">
                Category
              </div>
              <div className="flex gap-2 flex-wrap">
                {(
                  ["action", "condition", "loop", "variable", "system"] as const
                ).map((category) => (
                  <button
                    key={category}
                    onClick={() => toggleCategoryFilter(category)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      categoryFilter.has(category)
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Log Entries */}
      <div
        ref={logContainerRef}
        className="flex-1 overflow-y-auto p-3 space-y-1"
      >
        {filteredLogs.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-8">
            {logs.length === 0
              ? "No logs yet"
              : "No logs match the current filters"}
          </div>
        ) : (
          filteredLogs.map((entry) => (
            <LogEntry
              key={entry.id}
              entry={entry}
              isExpanded={expandedEntries.has(entry.id)}
              onToggle={() => toggleExpanded(entry.id)}
            />
          ))
        )}
        <div ref={logEndRef} />
      </div>

      {/* Auto-scroll Indicator */}
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            logEndRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
          className="absolute bottom-4 right-4 px-3 py-2 bg-blue-600 text-white rounded-lg shadow-lg hover:bg-blue-700 transition-colors flex items-center gap-2 text-sm"
        >
          <Circle className="w-3 h-3 fill-current" />
          Auto-scroll off
        </button>
      )}
    </div>
  );
};
