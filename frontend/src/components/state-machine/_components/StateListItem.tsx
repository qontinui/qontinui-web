"use client";

import type {
  DiscoveredState,
  StateImage,
  StateTransition,
} from "@/types/state-machine";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, ChevronDown, Image as ImageIcon } from "lucide-react";

interface StateListItemProps {
  state: DiscoveredState;
  imageMap: Map<string, StateImage>;
  isSelected: boolean;
  isExpanded: boolean;
  outgoingTransitions: StateTransition[];
  incomingTransitions: StateTransition[];
  stateMap: Map<string, DiscoveredState>;
  onClick: () => void;
  onToggleExpand: () => void;
  onImageClick?: (image: StateImage) => void;
}

export function StateListItem({
  state,
  imageMap,
  isSelected,
  isExpanded,
  outgoingTransitions,
  incomingTransitions: _incomingTransitions,
  stateMap: _stateMap,
  onClick,
  onToggleExpand,
  onImageClick,
}: StateListItemProps) {
  const images = state.imageIds
    .map((id) => imageMap.get(id))
    .filter((img): img is StateImage => img !== undefined);

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
      <div
        className={`rounded-lg border transition-colors ${
          isSelected
            ? "border-brand-primary bg-brand-primary/10"
            : "border-border-subtle bg-surface-default/50 hover:bg-surface-default"
        }`}
      >
        <div
          className="flex items-center gap-2 p-3 cursor-pointer"
          role="button"
          tabIndex={0}
          onClick={onClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClick();
            }
          }}
        >
          <CollapsibleTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{state.name}</div>
            <div className="text-xs text-text-muted flex items-center gap-2">
              <span>{images.length} images</span>
              <span>|</span>
              <span>{state.elementIds.length} elements</span>
              {outgoingTransitions.length > 0 && (
                <>
                  <span>|</span>
                  <span>{outgoingTransitions.length} outgoing</span>
                </>
              )}
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            {Math.round(state.confidence * 100)}%
          </Badge>
        </div>

        <CollapsibleContent>
          <div className="px-3 pb-3 border-t border-border-subtle pt-2 mt-1">
            {state.description && (
              <p className="text-sm text-text-muted mb-2">
                {state.description}
              </p>
            )}
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {images.slice(0, 6).map((img) => (
                  <button
                    type="button"
                    key={img.id}
                    className="w-12 h-12 rounded bg-surface-default border border-border-subtle flex items-center justify-center cursor-pointer hover:border-brand-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onImageClick?.(img);
                    }}
                    title={img.label || img.id}
                  >
                    <ImageIcon className="h-5 w-5 text-text-muted" />
                  </button>
                ))}
                {images.length > 6 && (
                  <div className="w-12 h-12 rounded bg-surface-default border border-border-subtle flex items-center justify-center text-xs text-text-muted">
                    +{images.length - 6}
                  </div>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
