import React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Edit2,
  Check,
  X,
  Upload,
  Image as ImageIcon,
  Clock,
  MousePointerClick,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "../utils";
import type { DiscoveredState } from "../types";

interface StateListPanelProps {
  filteredStates: DiscoveredState[];
  allStatesCount: number;
  selectedState: DiscoveredState | null;
  onSelectState: (state: DiscoveredState) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  editingStateId: string | null;
  editValue: string;
  onEditValueChange: (value: string) => void;
  onStartEditing: (stateId: string) => void;
  onCancelEditing: () => void;
  onRenameState: (stateId: string, newName: string) => void;
  onExport: () => void;
  isLoading: boolean;
  hasStates: boolean;
}

export function StateListPanel({
  filteredStates,
  allStatesCount,
  selectedState,
  onSelectState,
  searchQuery,
  onSearchQueryChange,
  editingStateId,
  editValue,
  onEditValueChange,
  onStartEditing,
  onCancelEditing,
  onRenameState,
  onExport,
  isLoading,
  hasStates,
}: StateListPanelProps) {
  return (
    <Card className="col-span-1">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">States</CardTitle>
          <Badge variant="secondary">{filteredStates.length}</Badge>
        </div>
        {/* Search */}
        <div className="relative mt-2">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search states..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="pl-8"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[600px]">
          <div className="space-y-1 p-2">
            {filteredStates.map((state) => (
              <div
                key={state.state_id}
                role="option"
                tabIndex={0}
                aria-selected={selectedState?.state_id === state.state_id}
                onClick={() => onSelectState(state)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectState(state); } }}
                className={cn(
                  "p-3 rounded-lg cursor-pointer transition-colors border",
                  selectedState?.state_id === state.state_id
                    ? "bg-primary/10 border-primary"
                    : "hover:bg-accent border-transparent"
                )}
              >
                {editingStateId === state.state_id ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={editValue}
                      onChange={(e) => onEditValueChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onRenameState(state.state_id, editValue);
                        } else if (e.key === "Escape") {
                          onCancelEditing();
                        }
                      }}
                      className="h-7 text-xs"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => onRenameState(state.state_id, editValue)}
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={onCancelEditing}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">
                        {state.state_id}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          onStartEditing(state.state_id);
                        }}
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <ImageIcon className="h-3 w-3" />
                        <span>{state.metadata.screenshot_count}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>
                          {formatDuration(state.metadata.duration_seconds)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <MousePointerClick className="h-3 w-3" />
                        <span>{state.input_events.length}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="secondary" className="text-xs">
                        Visits: {state.visit_count}
                      </Badge>
                      {state.outgoing_transitions.length > 0 && (
                        <Badge variant="outline" className="text-xs">
                          <ArrowRight className="h-2 w-2 mr-1" />
                          {state.outgoing_transitions.length}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {filteredStates.length === 0 && !isLoading && (
              <div className="text-center text-muted-foreground py-8">
                {allStatesCount === 0
                  ? "No states loaded"
                  : "No states match search"}
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
      <CardFooter className="pt-3 pb-3">
        <Button onClick={onExport} disabled={!hasStates} className="w-full">
          <Upload className="w-4 h-4 mr-2" />
          Export to Automation
        </Button>
      </CardFooter>
    </Card>
  );
}
