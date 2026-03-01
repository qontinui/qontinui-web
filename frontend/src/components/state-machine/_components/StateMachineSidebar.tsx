"use client";

import { Button } from "@/components/ui/button";
import { Plus, Square, Trash2, Settings, Network } from "lucide-react";
import type { State } from "@/hooks/automation";
import { OutgoingTransitionBuilder } from "@/components/outgoing-transition-builder";

export interface StateMachineSidebarProps {
  states: State[];
  selectedNode: string | null;
  onAddState: () => void;
  onAutoLayout: () => void;
  onOpenBatchMonitorDialog: () => void;
  onSelectState: (stateId: string) => void;
  onDeselectEdge: () => void;
  onDeleteState: (stateId: string) => void;
}

export function StateMachineSidebar({
  states,
  selectedNode,
  onAddState,
  onAutoLayout,
  onOpenBatchMonitorDialog,
  onSelectState,
  onDeselectEdge,
  onDeleteState,
}: StateMachineSidebarProps) {
  return (
    <div className="w-80 border-r border-border-subtle bg-surface-raised/50 p-4 overflow-y-auto scrollbar-dark">
      <div className="space-y-4">
        <Button
          onClick={onAddState}
          className="w-full bg-[var(--brand-secondary)] hover:bg-[var(--brand-secondary)]/80 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add State
        </Button>

        <Button
          onClick={onAutoLayout}
          className="w-full bg-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/80 text-black"
        >
          <Network className="w-4 h-4 mr-2" />
          Auto Layout
        </Button>

        <Button
          onClick={onOpenBatchMonitorDialog}
          className="w-full bg-[#7C3AED] hover:bg-[#7C3AED]/80 text-white"
          disabled={states.length === 0}
        >
          <Settings className="w-4 h-4 mr-2" />
          Batch Monitor Settings
        </Button>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-text-muted uppercase tracking-wide">
            States
          </h3>
          {states.length === 0 ? (
            <div className="text-center py-8 text-text-muted">
              <Square className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No states yet</p>
            </div>
          ) : (
            <div className="space-y-1 max-h-60 overflow-y-auto scrollbar-dark">
              {states.map((state) => (
                <div
                  key={state.id}
                  className={`flex items-center gap-2 p-2 rounded transition-colors cursor-pointer ${
                    selectedNode === state.id
                      ? "bg-[var(--brand-secondary)]/20 border border-[var(--brand-secondary)]"
                      : "hover:bg-surface-raised/80"
                  }`}
                  onClick={() => {
                    onSelectState(state.id);
                    onDeselectEdge();
                  }}
                >
                  <span className="text-sm flex-1 truncate">{state.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-text-muted hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteState(state.id);
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-text-muted uppercase tracking-wide">
            Transitions
          </h3>
          <OutgoingTransitionBuilder />
        </div>
      </div>
    </div>
  );
}
