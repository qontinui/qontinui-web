"use client";

import type {
  DiscoveredState,
  StateImage,
  StateTransition,
} from "@/types/state-machine";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowRight, Image as ImageIcon } from "lucide-react";

interface StateDetailsProps {
  state: DiscoveredState;
  imageMap: Map<string, StateImage>;
  transitions: StateTransition[];
  stateMap: Map<string, DiscoveredState>;
  onImageClick?: (image: StateImage) => void;
  onTransitionClick?: (transition: StateTransition) => void;
}

export function StateDetails({
  state,
  imageMap,
  transitions,
  stateMap,
  onImageClick,
  onTransitionClick,
}: StateDetailsProps) {
  const images = state.imageIds
    .map((id) => imageMap.get(id))
    .filter((img): img is StateImage => img !== undefined);

  return (
    <ScrollArea className="h-[350px]">
      <div className="space-y-4">
        <div>
          <h4 className="font-medium text-lg">{state.name}</h4>
          {state.description && (
            <p className="text-sm text-text-muted mt-1">{state.description}</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="p-2 rounded bg-surface-default/50">
            <div className="text-text-muted text-xs">Images</div>
            <div className="font-medium">{images.length}</div>
          </div>
          <div className="p-2 rounded bg-surface-default/50">
            <div className="text-text-muted text-xs">Elements</div>
            <div className="font-medium">{state.elementIds.length}</div>
          </div>
          <div className="p-2 rounded bg-surface-default/50">
            <div className="text-text-muted text-xs">Confidence</div>
            <div className="font-medium">
              {Math.round(state.confidence * 100)}%
            </div>
          </div>
        </div>

        {images.length > 0 && (
          <div>
            <h5 className="text-sm font-medium mb-2">Images</h5>
            <div className="grid grid-cols-4 gap-2">
              {images.map((img) => (
                <button
                  type="button"
                  key={img.id}
                  className="aspect-square rounded bg-surface-default border border-border-subtle flex flex-col items-center justify-center cursor-pointer hover:border-brand-primary p-2"
                  onClick={() => onImageClick?.(img)}
                >
                  <ImageIcon className="h-6 w-6 text-text-muted mb-1" />
                  <span className="text-[10px] text-text-muted truncate w-full text-center">
                    {img.label || img.elementType || img.id}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {transitions.length > 0 && (
          <div>
            <h5 className="text-sm font-medium mb-2">Transitions</h5>
            <div className="space-y-1">
              {transitions.map((t) => {
                const fromState = stateMap.get(t.fromStateId);
                const toState = stateMap.get(t.toStateId);
                const isOutgoing = t.fromStateId === state.id;
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 text-sm p-2 rounded bg-surface-default/50 cursor-pointer hover:bg-surface-default"
                    role="button"
                    tabIndex={0}
                    onClick={() => onTransitionClick?.(t)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onTransitionClick?.(t);
                      }
                    }}
                  >
                    <span
                      className={
                        isOutgoing ? "text-brand-primary" : "text-text-muted"
                      }
                    >
                      {fromState?.name || t.fromStateId}
                    </span>
                    <ArrowRight className="h-3 w-3 text-text-muted" />
                    <span
                      className={
                        !isOutgoing ? "text-brand-primary" : "text-text-muted"
                      }
                    >
                      {toState?.name || t.toStateId}
                    </span>
                    {t.trigger && (
                      <Badge variant="outline" className="text-xs ml-auto">
                        {t.trigger.type}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {state.elementIds.length > 0 && (
          <div>
            <h5 className="text-sm font-medium mb-2">Element IDs</h5>
            <div className="flex flex-wrap gap-1">
              {state.elementIds.slice(0, 10).map((id) => (
                <Badge key={id} variant="outline" className="text-xs font-mono">
                  {id}
                </Badge>
              ))}
              {state.elementIds.length > 10 && (
                <Badge variant="outline" className="text-xs">
                  +{state.elementIds.length - 10} more
                </Badge>
              )}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
