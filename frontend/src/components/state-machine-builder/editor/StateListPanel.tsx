"use client";

import { useState, useMemo } from "react";
import { Search, Plus, Trash2, Globe, Maximize2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { UIBridgeState } from "@/lib/state-machine-builder/types";

interface StateListPanelProps {
  states: UIBridgeState[];
  selectedStateId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
}

interface StateGroup {
  label: string;
  icon: React.ReactNode;
  states: UIBridgeState[];
}

export function StateListPanel({
  states,
  selectedStateId,
  onSelect,
  onAdd,
  onDelete,
}: StateListPanelProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return states;
    const query = search.toLowerCase();
    return states.filter((s) => s.name.toLowerCase().includes(query));
  }, [states, search]);

  const groups = useMemo<StateGroup[]>(() => {
    const global: UIBridgeState[] = [];
    const modal: UIBridgeState[] = [];
    const content: UIBridgeState[] = [];

    for (const state of filtered) {
      if (state.isGlobal) {
        global.push(state);
      } else if (state.isModal) {
        modal.push(state);
      } else {
        content.push(state);
      }
    }

    return [
      {
        label: "Global",
        icon: <Globe className="h-3.5 w-3.5 text-text-muted" />,
        states: global,
      },
      {
        label: "Modal",
        icon: <Maximize2 className="h-3.5 w-3.5 text-text-muted" />,
        states: modal,
      },
      {
        label: "Content",
        icon: null,
        states: content,
      },
    ];
  }, [filtered]);

  const hasAnyStates = states.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b border-border-subtle">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
          <Input
            placeholder="Search states..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm bg-surface-canvas"
          />
        </div>
      </div>

      {/* State List */}
      <ScrollArea className="flex-1 min-h-0">
        {!hasAnyStates && (
          <div className="p-6 text-center">
            <p className="text-sm text-text-muted">
              No states yet. Add a state manually or run discovery.
            </p>
          </div>
        )}

        {hasAnyStates && filtered.length === 0 && (
          <div className="p-6 text-center">
            <p className="text-sm text-text-muted">
              No states match your search.
            </p>
          </div>
        )}

        {groups.map(
          (group) =>
            group.states.length > 0 && (
              <div key={group.label}>
                {/* Group Header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-surface-canvas border-b border-border-subtle">
                  {group.icon}
                  <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
                    {group.label}
                  </span>
                  <Badge
                    variant="secondary"
                    className="ml-auto text-[10px] px-1.5 py-0"
                  >
                    {group.states.length}
                  </Badge>
                </div>

                {/* State Items */}
                {group.states.map((state) => {
                  const isSelected = state.id === selectedStateId;
                  return (
                    <button
                      key={state.id}
                      type="button"
                      onClick={() => onSelect(state.id)}
                      className={`
                        group w-full text-left px-3 py-2.5 border-b border-border-subtle
                        flex items-center gap-2 transition-colors
                        hover:bg-surface-raised/50
                        ${
                          isSelected
                            ? "bg-[var(--brand-secondary)]/20 border-l-2 border-l-[var(--brand-secondary)]"
                            : "border-l-2 border-l-transparent"
                        }
                      `}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-primary truncate">
                            {state.name}
                          </span>
                          {state.fingerprints.length > 0 && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 shrink-0"
                            >
                              {state.fingerprints.length} fp
                            </Badge>
                          )}
                        </div>
                        {state.positionZone && (
                          <span className="text-xs text-text-muted">
                            {state.positionZone}
                          </span>
                        )}
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(state.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </button>
                  );
                })}
              </div>
            )
        )}
      </ScrollArea>

      {/* Add Button */}
      <div className="p-3 border-t border-border-subtle">
        <Button variant="outline" size="sm" className="w-full" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          Add State
        </Button>
      </div>
    </div>
  );
}
