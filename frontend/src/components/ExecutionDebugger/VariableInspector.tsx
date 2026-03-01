import React, { useState } from "react";
import {
  Variable,
  ChevronRight,
  ChevronDown,
  Sparkles,
  History,
  Search,
} from "lucide-react";
import { useExecutionDebugger } from "../../stores/execution-debugger-store";

interface VariableValueProps {
  value: unknown;
  type: string;
}

function VariableValue({ value, type }: VariableValueProps) {
  if (value === null) return <span className="text-text-muted">null</span>;
  if (value === undefined)
    return <span className="text-text-muted">undefined</span>;

  const isArray = Array.isArray(value);

  switch (type) {
    case "string":
      return (
        <span className="text-green-600">&quot;{String(value)}&quot;</span>
      );
    case "number":
      return <span className="text-blue-600">{String(value)}</span>;
    case "boolean":
      return <span className="text-purple-600">{String(value)}</span>;
    case "object":
      if (isArray) {
        return (
          <span className="text-text-muted">
            [{(value as unknown[]).length} items]
          </span>
        );
      }
      return <span className="text-text-muted">{"{...}"}</span>;
    default:
      return <span className="text-text-secondary">{String(value)}</span>;
  }
}

interface VariableNodeProps {
  name: string;
  value: unknown;
  type: string;
  isNew?: boolean;
  isChanged?: boolean;
  depth?: number;
}

const VariableNode: React.FC<VariableNodeProps> = ({
  name,
  value,
  type,
  isNew,
  isChanged,
  depth = 0,
}) => {
  const [isExpanded, setIsExpanded] = useState(depth === 0);

  const isExpandable =
    type === "object" && value !== null && typeof value === "object";
  const isArray = Array.isArray(value);

  const getChildEntries = () => {
    if (!isExpandable) return [];
    if (isArray) {
      return value.map((item: unknown, index: number) => ({
        key: String(index),
        value: item,
        type: typeof item,
      }));
    }
    return Object.entries(value).map(([key, val]) => ({
      key,
      value: val,
      type: typeof val,
    }));
  };

  return (
    <div className={`${depth > 0 ? "ml-4" : ""}`}>
      <div
        className={`flex items-center gap-2 py-1 px-2 rounded group hover:bg-surface-raised/80 ${
          isNew ? "bg-green-50" : isChanged ? "bg-yellow-50" : ""
        }`}
      >
        {isExpandable && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-0.5 hover:bg-surface-raised/80 rounded"
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-text-muted" />
            ) : (
              <ChevronRight className="w-3 h-3 text-text-muted" />
            )}
          </button>
        )}
        {!isExpandable && <div className="w-4" />}

        <span className="text-sm font-mono text-text-secondary font-medium">
          {name}
        </span>
        <span className="text-xs text-text-muted">{type}</span>
        {isNew && (
          <span title="New variable">
            <Sparkles className="w-3 h-3 text-green-500" />
          </span>
        )}
        {isChanged && !isNew && (
          <span title="Value changed">
            <History className="w-3 h-3 text-yellow-500" />
          </span>
        )}
        <span className="text-sm font-mono flex-1 text-right">
          <VariableValue value={value} type={type} />
        </span>
      </div>

      {isExpanded && isExpandable && (
        <div className="border-l-2 border-border-subtle ml-2">
          {getChildEntries().map((entry) => (
            <VariableNode
              key={entry.key}
              name={entry.key}
              value={entry.value}
              type={entry.type}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const VariableInspector: React.FC = () => {
  const { context, variableHistory, currentActionIndex } =
    useExecutionDebugger();
  const [searchQuery, setSearchQuery] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const recentChanges = variableHistory
    .filter((h) => h.actionIndex === currentActionIndex)
    .reduce(
      (acc, h) => {
        acc[h.variableName] = true;
        return acc;
      },
      {} as Record<string, boolean>
    );

  const isNewVariable = (name: string) => {
    const history = variableHistory.filter((h) => h.variableName === name);
    return history.length === 1 && recentChanges[name];
  };

  const filteredVariables = Object.entries(context.variables).filter(([name]) =>
    name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const variableHistoryMap = variableHistory.reduce(
    (acc, entry) => {
      if (!acc[entry.variableName]) {
        acc[entry.variableName] = [];
      }
      acc[entry.variableName]?.push(entry);
      return acc;
    },
    {} as Record<string, typeof variableHistory>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b bg-surface-raised">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Variable className="w-4 h-4 text-blue-600" />
            <h3 className="font-semibold text-sm">Variables</h3>
            <span className="text-xs text-text-muted">
              ({Object.keys(context.variables).length})
            </span>
          </div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`px-2 py-1 text-xs rounded flex items-center gap-1 transition-colors ${
              showHistory
                ? "bg-blue-600 text-white"
                : "bg-white border text-text-muted hover:bg-surface-raised/80"
            }`}
          >
            <History className="w-3 h-3" />
            History
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search variables..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {!showHistory ? (
          <div className="space-y-1">
            {filteredVariables.length === 0 ? (
              <div className="text-center text-text-muted text-sm py-8">
                {searchQuery
                  ? "No variables match your search"
                  : "No variables yet"}
              </div>
            ) : (
              filteredVariables.map(([name, varValue]) => (
                <VariableNode
                  key={name}
                  name={name}
                  value={varValue.value}
                  type={varValue.type}
                  isNew={isNewVariable(name)}
                  isChanged={recentChanges[name] && !isNewVariable(name)}
                />
              ))
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {Object.keys(context.variables).length === 0 ? (
              <div className="text-center text-text-muted text-sm py-8">
                No variable history yet
              </div>
            ) : (
              Object.entries(variableHistoryMap).map(([varName, history]) => (
                <div key={varName} className="border rounded-lg p-3 bg-white">
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b">
                    <span className="font-mono font-medium text-sm">
                      {varName}
                    </span>
                    <span className="text-xs text-text-muted">
                      ({history.length} change{history.length !== 1 ? "s" : ""})
                    </span>
                  </div>
                  <div className="space-y-2">
                    {history.map((entry, index) => (
                      <div
                        key={`${entry.timestamp}-${index}`}
                        className="flex items-start gap-2 text-xs"
                      >
                        <span className="text-text-muted font-mono">
                          Action {entry.actionIndex}:
                        </span>
                        <span className="font-mono text-text-secondary">
                          {typeof entry.value === "object"
                            ? JSON.stringify(entry.value)
                            : String(entry.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {Object.keys(context.loopIterations).length > 0 && (
        <div className="border-t p-3 bg-surface-raised">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-text-muted">
              Loop Iterations
            </span>
          </div>
          <div className="space-y-1">
            {Object.entries(context.loopIterations).map(([loopId, count]) => (
              <div key={loopId} className="flex justify-between text-xs">
                <span className="font-mono text-text-muted">{loopId}</span>
                <span className="font-medium text-text-secondary">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
