/**
 * State List Component
 *
 * Displays discovered states from web extraction with:
 * - Visual preview of each state
 * - State metadata (name, type, element count)
 * - Bounding box information
 * - Selection capabilities for import
 */

"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { FileSearch, Component, CheckSquare, Square } from "lucide-react";

interface StateAnnotation {
  id: string;
  name: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  state_type: string;
  element_ids: string[];
}

interface ExtractionAnnotation {
  id: string;
  screenshot_id: string;
  source_url: string;
  viewport_width: number;
  viewport_height: number;
  elements: unknown[];
  states: StateAnnotation[];
}

interface StateListProps {
  annotations: ExtractionAnnotation[];
  selectedStateIds: Set<string>;
  onSelectionChange: (stateIds: Set<string>) => void;
}

export function StateList({
  annotations,
  selectedStateIds,
  onSelectionChange,
}: StateListProps) {
  // Collect all states from all annotations
  const allStates = annotations.flatMap((annotation) =>
    annotation.states.map((state) => ({
      ...state,
      source_url: annotation.source_url,
      viewport: `${annotation.viewport_width}x${annotation.viewport_height}`,
    }))
  );

  const handleToggleState = (stateId: string) => {
    const newSelection = new Set(selectedStateIds);
    if (newSelection.has(stateId)) {
      newSelection.delete(stateId);
    } else {
      newSelection.add(stateId);
    }
    onSelectionChange(newSelection);
  };

  const handleSelectAll = () => {
    const allIds = new Set(allStates.map((state) => state.id));
    onSelectionChange(allIds);
  };

  const handleDeselectAll = () => {
    onSelectionChange(new Set());
  };

  if (allStates.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex flex-col items-center justify-center text-center space-y-3">
            <FileSearch className="h-12 w-12 text-muted-foreground" />
            <div>
              <h3 className="font-semibold">No States Found</h3>
              <p className="text-sm text-muted-foreground">
                No states have been discovered yet. Start an extraction to find
                states.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <FileSearch className="h-5 w-5" />
              Discovered States
            </CardTitle>
            <CardDescription>
              {allStates.length} state{allStates.length !== 1 ? "s" : ""} found
              across {annotations.length} page
              {annotations.length !== 1 ? "s" : ""}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleSelectAll}
              variant="outline"
              size="sm"
              disabled={selectedStateIds.size === allStates.length}
            >
              <CheckSquare className="h-4 w-4 mr-2" />
              Select All
            </Button>
            <Button
              onClick={handleDeselectAll}
              variant="outline"
              size="sm"
              disabled={selectedStateIds.size === 0}
            >
              <Square className="h-4 w-4 mr-2" />
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-4">
          <div className="space-y-3">
            {allStates.map((state) => (
              <div
                key={state.id}
                className={`border rounded-lg p-4 transition-colors cursor-pointer ${
                  selectedStateIds.has(state.id)
                    ? "border-[#00D9FF] bg-accent"
                    : "border-border hover:border-muted-foreground"
                }`}
                onClick={() => handleToggleState(state.id)}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={selectedStateIds.has(state.id)}
                    onCheckedChange={() => handleToggleState(state.id)}
                    className="mt-1"
                    onClick={(e) => e.stopPropagation()}
                  />

                  <div className="flex-1 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-semibold">{state.name}</h4>
                        <p className="text-xs text-muted-foreground truncate max-w-xs">
                          {state.source_url}
                        </p>
                      </div>
                      <Badge variant="outline">{state.state_type}</Badge>
                    </div>

                    {/* Metadata */}
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Component className="h-4 w-4" />
                        <span>
                          {state.element_ids.length} element
                          {state.element_ids.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <span className="text-muted-foreground">
                        {state.viewport}
                      </span>
                    </div>

                    {/* Bounding Box */}
                    <div className="text-xs text-muted-foreground">
                      Position: ({state.bbox.x}, {state.bbox.y}) | Size:{" "}
                      {state.bbox.width}x{state.bbox.height}
                    </div>

                    {/* Element IDs Preview */}
                    {state.element_ids.length > 0 && (
                      <div className="pt-2 border-t">
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            View element IDs ({state.element_ids.length})
                          </summary>
                          <div className="mt-2 space-y-1 pl-4">
                            {state.element_ids.map((elemId) => (
                              <div
                                key={elemId}
                                className="font-mono text-muted-foreground"
                              >
                                {elemId}
                              </div>
                            ))}
                          </div>
                        </details>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {selectedStateIds.size > 0 && (
          <>
            <Separator className="my-4" />
            <div className="text-sm text-center text-muted-foreground">
              {selectedStateIds.size} state
              {selectedStateIds.size !== 1 ? "s" : ""} selected
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
