/**
 * StateList Component
 *
 * Sidebar component that displays a list of all states in the project.
 * Allows users to select a state to visualize.
 *
 * Features:
 * - Searchable list of states
 * - Shows element counts for each state
 * - Highlights selected state
 * - Groups states by initial/normal
 */

import React, { useState, useMemo } from "react";
import type { State } from "@/contexts/automation-context/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Star, Layers } from "lucide-react";

export interface StateListProps {
  states: State[];
  selectedStateId: string | null;
  onSelectState: (stateId: string) => void;
}

function getElementCounts(state: State) {
  const imageCount =
    state.stateImages?.filter((img) =>
      img.patterns?.some(
        (p) => p.fixed && p.offsetX !== undefined && p.offsetY !== undefined
      )
    ).length || 0;
  const regionCount = state.regions?.length || 0;
  const locationCount = state.locations?.length || 0;
  const total = imageCount + regionCount + locationCount;
  return { imageCount, regionCount, locationCount, total };
}

interface StateItemProps {
  state: State;
  isSelected: boolean;
  onSelectState: (stateId: string) => void;
}

function StateItem({ state, isSelected, onSelectState }: StateItemProps) {
  const counts = getElementCounts(state);

  return (
    <div
      className={`
        flex flex-col gap-2 p-3 rounded-lg border cursor-pointer
        transition-colors
        ${
          isSelected
            ? "bg-primary/10 border-primary shadow-sm"
            : "hover:bg-muted/50 hover:border-muted-foreground/20"
        }
      `}
      onClick={() => onSelectState(state.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {state.initial && (
              <Star
                className="h-3 w-3 text-yellow-500 flex-shrink-0"
                fill="currentColor"
              />
            )}
            <div className="font-medium truncate">{state.name}</div>
          </div>
          {state.description && (
            <div className="text-xs text-muted-foreground truncate mt-1">
              {state.description}
            </div>
          )}
        </div>
        {counts.total > 0 && (
          <Badge variant="outline" className="flex-shrink-0">
            {counts.total}
          </Badge>
        )}
      </div>

      {/* Element counts breakdown */}
      {counts.total > 0 && (
        <div className="flex gap-2 text-xs text-muted-foreground">
          {counts.imageCount > 0 && (
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 bg-blue-500 rounded-sm" />
              {counts.imageCount} img
            </span>
          )}
          {counts.regionCount > 0 && (
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 bg-green-500 rounded-sm" />
              {counts.regionCount} rgn
            </span>
          )}
          {counts.locationCount > 0 && (
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 bg-orange-500 rounded-sm" />
              {counts.locationCount} loc
            </span>
          )}
        </div>
      )}

      {counts.total === 0 && (
        <div className="text-xs text-muted-foreground italic">
          No positioned elements
        </div>
      )}
    </div>
  );
}

export function StateList({
  states,
  selectedStateId,
  onSelectState,
}: StateListProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // Filter states by search query
  const filteredStates = useMemo(() => {
    if (!searchQuery.trim()) return states;

    const query = searchQuery.toLowerCase();
    return states.filter(
      (state) =>
        state.name.toLowerCase().includes(query) ||
        state.description?.toLowerCase().includes(query)
    );
  }, [states, searchQuery]);

  // Group states by initial/normal
  const { initialStates, normalStates } = useMemo(() => {
    const initial: State[] = [];
    const normal: State[] = [];

    filteredStates.forEach((state) => {
      if (state.initial) {
        initial.push(state);
      } else {
        normal.push(state);
      }
    });

    return { initialStates: initial, normalStates: normal };
  }, [filteredStates]);

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <span>States</span>
          <Badge variant="outline">{states.length}</Badge>
        </CardTitle>
        <CardDescription>Select a state to visualize</CardDescription>

        {/* Search */}
        <div className="relative pt-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search states..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </CardHeader>

      <CardContent className="flex-1 min-h-0">
        {filteredStates.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground py-8">
              <Layers className="mx-auto h-8 w-8 mb-2 opacity-50" />
              {searchQuery ? (
                <>
                  <p className="text-sm">No states found</p>
                  <p className="text-xs mt-1">Try a different search term</p>
                </>
              ) : (
                <>
                  <p className="text-sm">No states yet</p>
                  <p className="text-xs mt-1">
                    Create states to visualize them
                  </p>
                </>
              )}
            </div>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="space-y-4">
              {/* Initial States */}
              {initialStates.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <Star
                      className="h-3 w-3 text-yellow-500"
                      fill="currentColor"
                    />
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Initial States
                    </div>
                  </div>
                  <div className="space-y-2">
                    {initialStates.map((state) => (
                      <StateItem
                        key={state.id}
                        state={state}
                        isSelected={selectedStateId === state.id}
                        onSelectState={onSelectState}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Normal States */}
              {normalStates.length > 0 && (
                <div>
                  {initialStates.length > 0 && (
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <Layers className="h-3 w-3 text-muted-foreground" />
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        States
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    {normalStates.map((state) => (
                      <StateItem
                        key={state.id}
                        state={state}
                        isSelected={selectedStateId === state.id}
                        onSelectState={onSelectState}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
