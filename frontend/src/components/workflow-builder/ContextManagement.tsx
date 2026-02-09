"use client";

import React from "react";
import { Plus, X } from "lucide-react";
import { useWorkflowBuilder } from "./WorkflowBuilderContext";
import { useContexts } from "@/lib/runner-api";

export function ContextManagement() {
  const { state, updateWorkflow } = useWorkflowBuilder();
  const { data: contexts } = useContexts();
  const workflow = state.workflow;
  const selectedIds = workflow.context_ids ?? [];

  const addContext = (id: string) => {
    if (!selectedIds.includes(id)) {
      updateWorkflow({ context_ids: [...selectedIds, id] });
    }
  };

  const removeContext = (id: string) => {
    updateWorkflow({ context_ids: selectedIds.filter((cid) => cid !== id) });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-zinc-400">Contexts</label>
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          <input
            type="checkbox"
            className="rounded"
            checked={workflow.auto_include_contexts !== false}
            onChange={(e) =>
              updateWorkflow({ auto_include_contexts: e.target.checked })
            }
          />
          Auto-include
        </label>
      </div>

      {/* Selected contexts */}
      {selectedIds.length > 0 && (
        <div className="space-y-1">
          {selectedIds.map((id) => {
            const ctx = contexts?.find((c) => c.id === id);
            return (
              <div
                key={id}
                className="flex items-center gap-2 px-2 py-1 bg-zinc-800 rounded text-sm"
              >
                <span className="flex-1 text-zinc-300 truncate">
                  {ctx?.name ?? id}
                </span>
                <button
                  className="text-zinc-500 hover:text-red-400"
                  onClick={() => removeContext(id)}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Available contexts to add */}
      {contexts && contexts.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 mb-1">Available:</p>
          <div className="flex flex-wrap gap-1">
            {contexts
              .filter((c) => !selectedIds.includes(c.id))
              .slice(0, 10)
              .map((ctx) => (
                <button
                  key={ctx.id}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs bg-zinc-800/50 hover:bg-zinc-700 rounded text-zinc-400"
                  onClick={() => addContext(ctx.id)}
                >
                  <Plus className="w-3 h-3" />
                  {ctx.name}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
