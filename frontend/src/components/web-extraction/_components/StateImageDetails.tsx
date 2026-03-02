"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Component, MapPin, Ruler } from "lucide-react";
import type {
  BoundingBox,
  ElementAnnotation,
  StateAnnotation,
  ViewMode,
} from "../state-image-modal-types";

interface StateImageDetailsProps {
  state: StateAnnotation;
  elements: ElementAnnotation[];
  stateElements: ElementAnnotation[];
  viewMode: ViewMode;
  selectedElement: ElementAnnotation | null;
  currentBbox: BoundingBox;
  viewportWidth: number;
  viewportHeight: number;
  onElementClick: (element: ElementAnnotation) => void;
}

export function StateImageDetails({
  state,
  stateElements,
  viewMode,
  selectedElement,
  currentBbox,
  viewportWidth,
  viewportHeight,
  onElementClick,
}: StateImageDetailsProps) {
  return (
    <div className="w-64 flex-shrink-0 min-h-0 flex flex-col">
      <ScrollArea className="flex-1">
        <div className="space-y-4 pr-2">
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Position
            </h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-muted rounded px-2 py-1">
                <span className="text-muted-foreground">X:</span>{" "}
                {currentBbox.x}
              </div>
              <div className="bg-muted rounded px-2 py-1">
                <span className="text-muted-foreground">Y:</span>{" "}
                {currentBbox.y}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Ruler className="h-4 w-4" />
              Dimensions
            </h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-muted rounded px-2 py-1">
                <span className="text-muted-foreground">W:</span>{" "}
                {currentBbox.width}px
              </div>
              <div className="bg-muted rounded px-2 py-1">
                <span className="text-muted-foreground">H:</span>{" "}
                {currentBbox.height}px
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Component className="h-4 w-4" />
              Elements ({stateElements.length})
            </h4>
            {stateElements.length > 0 ? (
              <div className="space-y-1">
                {stateElements.map((element) => {
                  const displayName = element.name || element.id;
                  const truncatedName =
                    displayName.length > 20
                      ? `${displayName.substring(0, 20)}...`
                      : displayName;

                  return (
                    <button
                      key={element.id}
                      type="button"
                      onClick={() => onElementClick(element)}
                      className={`w-full text-left text-xs rounded px-2 py-1.5 transition-colors ${
                        selectedElement?.id === element.id
                          ? "bg-brand-primary/20 border border-brand-primary text-foreground"
                          : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                      }`}
                      title={`${displayName}\nType: ${element.element_type}\n${element.text || ""}`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate">{truncatedName}</span>
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1 py-0 h-4"
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

          <Separator />

          <div className="space-y-2">
            <h4 className="text-sm font-medium">Metadata</h4>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {viewMode === "element" ? "Element ID:" : "State ID:"}
                </span>
                <span
                  className="font-mono truncate max-w-[120px]"
                  title={
                    viewMode === "element" && selectedElement
                      ? selectedElement.id
                      : state.id
                  }
                >
                  {(viewMode === "element" && selectedElement
                    ? selectedElement.id
                    : state.id
                  ).substring(0, 8)}
                  ...
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Viewport:</span>
                <span>
                  {viewportWidth}×{viewportHeight}
                </span>
              </div>
              {viewMode === "element" && selectedElement?.text && (
                <div className="mt-2">
                  <span className="text-muted-foreground">Text:</span>
                  <p className="mt-1 bg-muted rounded px-2 py-1 break-words">
                    {selectedElement.text}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
