/**
 * StateDetailSidebar
 *
 * Shows details about the selected state in the state graph.
 * Editable name, URL, element list, transition info, annotation coverage.
 */

import { useState } from "react";
import {
  Edit,
  Save,
  X,
  ChevronDown,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import type { NonVisualState, NonVisualTransition } from "../types";

interface StateDetailSidebarProps {
  state: NonVisualState | null;
  transitions: NonVisualTransition[];
  allStates: NonVisualState[];
  onUpdateState?: (state: NonVisualState) => void;
  annotationCoverage?: { annotated: number; total: number };
}

export function StateDetailSidebar({
  state,
  transitions,
  allStates,
  onUpdateState,
  annotationCoverage,
}: StateDetailSidebarProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState("");
  const [showElements, setShowElements] = useState(false);

  if (!state) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 text-sm p-4">
        Select a state in the graph to view details
      </div>
    );
  }

  const outgoing = transitions.filter((t) => t.fromStateId === state.id);
  const incoming = transitions.filter((t) => t.toStateId === state.id);

  const startEdit = () => {
    setEditName(state.name);
    setIsEditingName(true);
  };

  const saveEdit = () => {
    if (onUpdateState && editName.trim()) {
      onUpdateState({ ...state, name: editName.trim() });
    }
    setIsEditingName(false);
  };

  return (
    <div className="h-full overflow-auto p-4 space-y-4 border-l border-neutral-700">
      {/* State name */}
      <div>
        {isEditingName ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveEdit()}
              className="flex-1 px-2 py-1 text-sm bg-neutral-900 border border-neutral-600 rounded text-neutral-200 focus:outline-none focus:border-blue-500"
              autoFocus
            />
            <button
              onClick={saveEdit}
              className="text-emerald-400 hover:text-emerald-300"
            >
              <Save className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsEditingName(false)}
              className="text-neutral-400 hover:text-neutral-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-neutral-100 flex-1">
              {state.name}
            </h3>
            {onUpdateState && (
              <button
                onClick={startEdit}
                className="text-neutral-400 hover:text-neutral-200"
              >
                <Edit className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
        <p className="text-xs text-neutral-500 mt-1">{state.description}</p>
      </div>

      {/* URL */}
      {state.pageUrl && (
        <div className="p-2 bg-neutral-800 rounded">
          <p className="text-[10px] text-neutral-500 uppercase tracking-wide">
            URL
          </p>
          <p className="text-xs text-blue-400 truncate">{state.pageUrl}</p>
        </div>
      )}

      {/* Confidence */}
      <div className="p-2 bg-neutral-800 rounded">
        <p className="text-[10px] text-neutral-500 uppercase tracking-wide">
          Confidence
        </p>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 h-1.5 bg-neutral-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${state.confidence > 0.7 ? "bg-emerald-500" : state.confidence > 0.4 ? "bg-yellow-500" : "bg-red-500"}`}
              style={{ width: `${state.confidence * 100}%` }}
            />
          </div>
          <span className="text-xs text-neutral-300">
            {Math.round(state.confidence * 100)}%
          </span>
        </div>
      </div>

      {/* Annotation coverage */}
      {annotationCoverage && (
        <div className="p-2 bg-neutral-800 rounded">
          <p className="text-[10px] text-neutral-500 uppercase tracking-wide">
            Annotation Coverage
          </p>
          <p className="text-xs text-neutral-300 mt-1">
            {annotationCoverage.annotated}/{annotationCoverage.total} elements
          </p>
        </div>
      )}

      {/* Transitions */}
      <div>
        <p className="text-[10px] text-neutral-500 uppercase tracking-wide mb-2">
          Transitions Out ({outgoing.length})
        </p>
        {outgoing.map((t) => {
          const target = allStates.find((s) => s.id === t.toStateId);
          return (
            <div
              key={t.id}
              className="flex items-center gap-2 px-2 py-1.5 bg-neutral-800/50 rounded mb-1"
            >
              <ArrowRight className="w-3 h-3 text-emerald-400 flex-shrink-0" />
              <span className="text-xs text-neutral-200">
                {t.triggerLabel || t.triggerElementId}
              </span>
              <span className="text-[10px] text-neutral-500">
                {t.triggerAction}
              </span>
              <ArrowRight className="w-2 h-2 text-neutral-600 flex-shrink-0" />
              <span className="text-xs text-blue-400">
                {target?.name || t.toStateId}
              </span>
            </div>
          );
        })}
        {outgoing.length === 0 && (
          <p className="text-xs text-neutral-500 italic">
            No outgoing transitions
          </p>
        )}
      </div>

      {incoming.length > 0 && (
        <div>
          <p className="text-[10px] text-neutral-500 uppercase tracking-wide mb-2">
            Transitions In ({incoming.length})
          </p>
          {incoming.map((t) => {
            const source = allStates.find((s) => s.id === t.fromStateId);
            return (
              <div
                key={t.id}
                className="flex items-center gap-2 px-2 py-1.5 bg-neutral-800/50 rounded mb-1"
              >
                <span className="text-xs text-blue-400">
                  {source?.name || t.fromStateId}
                </span>
                <ArrowRight className="w-2 h-2 text-neutral-600 flex-shrink-0" />
                <span className="text-xs text-neutral-200">
                  {t.triggerLabel || t.triggerElementId}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Elements list */}
      <div>
        <button
          onClick={() => setShowElements(!showElements)}
          className="flex items-center gap-2 text-[10px] text-neutral-500 uppercase tracking-wide"
        >
          {showElements ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          Elements ({state.elementIds.length})
        </button>
        {showElements && (
          <div className="mt-1 space-y-0.5 max-h-[200px] overflow-auto">
            {state.elementIds.map((id) => (
              <div
                key={id}
                className="px-2 py-1 text-xs text-neutral-300 bg-neutral-800/30 rounded font-mono"
              >
                {id}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
