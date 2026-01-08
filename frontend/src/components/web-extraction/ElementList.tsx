/**
 * Element List Component
 *
 * Displays a scrollable list of elements belonging to the selected state.
 * Clicking an element shows its details in the right panel.
 */

"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Component } from "lucide-react";

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ElementAnnotation {
  id: string;
  name?: string | null;
  element_type: string;
  bbox: BoundingBox;
  text?: string | null;
  selector?: string | null;
  confidence?: number;
}

interface ElementListProps {
  elements: ElementAnnotation[];
  selectedElementId: string | null;
  onSelectElement: (elementId: string) => void;
  stateName: string;
}

export function ElementList({
  elements,
  selectedElementId,
  onSelectElement,
  stateName,
}: ElementListProps) {
  // Get display name: prefer text content, then name, then truncated id
  const getDisplayName = (element: ElementAnnotation) => {
    if (element.text && element.text.trim()) {
      return element.text.trim();
    }
    if (element.name && element.name.trim()) {
      return element.name.trim();
    }
    return element.id;
  };

  if (elements.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-3 border-b shrink-0 bg-muted/20">
          <p className="text-sm font-medium truncate">{stateName}</p>
          <p className="text-xs text-muted-foreground">No elements</p>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-muted-foreground">
            <Component className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No elements in this state</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b shrink-0 bg-muted/20">
        <p className="text-sm font-medium truncate">{stateName}</p>
        <p className="text-xs text-muted-foreground">
          {elements.length} element{elements.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Element List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {elements.map((element) => {
            const isSelected = selectedElementId === element.id;
            const displayName = getDisplayName(element);

            return (
              <button
                key={element.id}
                type="button"
                onClick={() => onSelectElement(element.id)}
                className={`w-full text-left p-2 rounded-md transition-colors ${
                  isSelected
                    ? "bg-brand-primary/20 ring-1 ring-brand-primary"
                    : "hover:bg-muted"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate flex-1">
                    {displayName}
                  </span>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {element.element_type}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {element.bbox.width}×{element.bbox.height} at (
                  {element.bbox.x}, {element.bbox.y})
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
