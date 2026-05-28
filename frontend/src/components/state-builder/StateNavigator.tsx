"use client";

import React from "react";
import {
  Search,
  Plus,
  Trash2,
  Copy,
  ImageIcon,
  ArrowRightLeft,
  Eye,
  FileText,
  Check,
  MoreVertical,
  Filter,
  Star,
} from "lucide-react";
import type { State } from "@/contexts/automation-context";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface StateNavigatorProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  filterHasImages: boolean | null;
  setFilterHasImages: (v: boolean | null) => void;
  filterHasTransitions: boolean | null;
  setFilterHasTransitions: (v: boolean | null) => void;
  setFilterTags: (tags: string[]) => void;
  filteredStates: State[];
  currentStateId: string | null;
  setCurrentStateId: (id: string) => void;
  selectedStateIds: Set<string>;
  setShowBulkDialog: (v: boolean) => void;
  setShowTemplateDialog: (v: boolean) => void;
  stateComplexity: (state: State) => number;
  stateHasImages: (state: State) => boolean;
  stateHasTransitions: (state: State) => boolean;
  handleToggleStateSelection: (id: string) => void;
  handleDeleteState: (id: string) => void;
  handleCreateState: () => void;
  addState: (state: State) => void;
}

export function StateNavigator({
  searchQuery,
  setSearchQuery,
  filterHasImages,
  setFilterHasImages,
  filterHasTransitions,
  setFilterHasTransitions,
  setFilterTags,
  filteredStates,
  currentStateId,
  setCurrentStateId,
  selectedStateIds,
  setShowBulkDialog,
  setShowTemplateDialog,
  stateComplexity,
  stateHasImages,
  stateHasTransitions,
  handleToggleStateSelection,
  handleDeleteState,
  handleCreateState,
  addState,
}: StateNavigatorProps) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">State Navigator</CardTitle>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowTemplateDialog(true)}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCreateState}>
              <FileText className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3 overflow-hidden">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search states..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <Filter className="h-3 w-3 mr-1" />
                Filters
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={() =>
                  setFilterHasImages(filterHasImages === true ? null : true)
                }
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    filterHasImages === true ? "opacity-100" : "opacity-0"
                  )}
                />
                Has Images
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  setFilterHasTransitions(
                    filterHasTransitions === true ? null : true
                  )
                }
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    filterHasTransitions === true ? "opacity-100" : "opacity-0"
                  )}
                />
                Has Transitions
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setFilterHasImages(null);
                  setFilterHasTransitions(null);
                  setFilterTags([]);
                }}
              >
                Clear Filters
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {selectedStateIds.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowBulkDialog(true)}
            >
              {selectedStateIds.size} selected
            </Button>
          )}
        </div>

        {/* State List */}
        <ScrollArea className="flex-1">
          <div className="space-y-1">
            {filteredStates.map((state) => {
              const isSelected = currentStateId === state.id;
              const isChecked = selectedStateIds.has(state.id);
              const complexity = stateComplexity(state);

              return (
                <div
                  key={state.id}
                  className={cn(
                    "group relative flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors",
                    isSelected
                      ? "bg-primary/10 border-primary"
                      : "border-transparent hover:bg-accent"
                  )}
                  role="button"
                  tabIndex={0}
                  onClick={() => setCurrentStateId(state.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setCurrentStateId(state.id);
                    }
                  }}
                >
                  <Checkbox
                    checked={isChecked}
                    onClick={(e) => e.stopPropagation()}
                    onCheckedChange={() => handleToggleStateSelection(state.id)}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">
                        {state.name}
                      </span>
                      {state.initial && (
                        <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {stateHasImages(state) && (
                        <Badge variant="secondary" className="text-xs">
                          <ImageIcon className="h-3 w-3 mr-1" />
                          {state.stateImages?.length || 0}
                        </Badge>
                      )}
                      {stateHasTransitions(state) && (
                        <Badge variant="secondary" className="text-xs">
                          <ArrowRightLeft className="h-3 w-3" />
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          complexity < 5 && "border-green-500 text-green-500",
                          complexity >= 5 &&
                            complexity < 15 &&
                            "border-yellow-500 text-yellow-500",
                          complexity >= 15 && "border-red-500 text-red-500"
                        )}
                      >
                        {complexity}
                      </Badge>
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      asChild
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => setCurrentStateId(state.id)}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        View
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          const duplicate: State = {
                            ...state,
                            id: `state-${Date.now()}`,
                            name: `${state.name} (Copy)`,
                          };
                          addState(duplicate);
                        }}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <DestructiveButton
                          onClick={() => handleDeleteState(state.id)}
                          className="w-full justify-start text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DestructiveButton>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
