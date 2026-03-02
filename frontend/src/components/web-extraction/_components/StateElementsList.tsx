"use client";

import { Badge } from "@/components/ui/badge";
import { Component } from "lucide-react";
import type { ElementAnnotation } from "../state-image-modal-types";

interface StateElementsListProps {
  elements: ElementAnnotation[];
  selectedElementId: string | null;
  onElementClick: (element: ElementAnnotation) => void;
}

export function StateElementsList({
  elements,
  selectedElementId,
  onElementClick,
}: StateElementsListProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium flex items-center gap-1.5">
        <Component className="h-3.5 w-3.5" />
        Elements ({elements.length})
      </h4>
      {elements.length > 0 ? (
        <div className="space-y-1 max-h-[200px] overflow-y-auto">
          {elements.map((element) => {
            const displayName = element.name || element.id;
            const truncatedName =
              displayName.length > 25
                ? `${displayName.substring(0, 25)}...`
                : displayName;

            return (
              <button
                key={element.id}
                type="button"
                onClick={() => onElementClick(element)}
                className={`w-full text-left text-xs rounded px-2 py-1.5 transition-colors ${
                  selectedElementId === element.id
                    ? "bg-brand-primary/20 border border-brand-primary text-foreground"
                    : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                }`}
                title={`${displayName}\nType: ${element.element_type}\n${element.text || ""}`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate">{truncatedName}</span>
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1 py-0 h-4 shrink-0"
                  >
                    {element.element_type}
                  </Badge>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No elements in this state
        </p>
      )}
    </div>
  );
}
