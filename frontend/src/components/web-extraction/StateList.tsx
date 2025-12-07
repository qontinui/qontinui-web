"use client";

import { useExtractionStore } from "@/stores/extraction-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Edit2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface StateListProps {
  expanded?: boolean;
}

export function StateList({ expanded = false }: StateListProps) {
  const states = useExtractionStore((state) => state.states);
  const selectedStateId = useExtractionStore((state) => state.selectedStateId);
  const selectState = useExtractionStore((state) => state.selectState);
  const deleteState = useExtractionStore((state) => state.deleteState);
  const screenshots = useExtractionStore((state) => state.screenshots);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Detected States</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "space-y-2",
            expanded && "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
          )}
        >
          {states.map((state) => {
            const screenshot = screenshots.get(state.screenshotId);
            return (
              <div
                key={state.id}
                className={cn(
                  "p-3 rounded-lg border cursor-pointer transition-colors",
                  selectedStateId === state.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                )}
                onClick={() => selectState(state.id)}
              >
                {expanded && screenshot && (
                  <div className="aspect-video bg-muted rounded mb-2 overflow-hidden">
                    <img
                      src={`data:image/png;base64,${screenshot.thumbnail}`}
                      alt={state.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{state.name}</p>
                    <div className="flex gap-1 mt-1">
                      <Badge variant="outline" className="text-xs">
                        {state.stateType}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {state.elementIds.length} elements
                      </Badge>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteState(state.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
          {states.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No states detected yet
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
