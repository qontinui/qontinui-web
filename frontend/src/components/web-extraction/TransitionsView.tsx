/**
 * Transitions View Component
 *
 * Displays discovered transitions between states:
 * - List of transitions with from/to states
 * - Trigger type and details
 * - Source/target URLs
 */

"use client";

import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  MousePointer,
  Eye,
  Focus,
  Navigation,
  Keyboard,
  RefreshCw,
  HelpCircle,
  Link,
  GitBranch,
} from "lucide-react";
import type {
  InferredTransition,
  StateMachineState,
  TriggerType,
} from "@/types/extraction";

interface TransitionsViewProps {
  transitions: InferredTransition[];
  states: StateMachineState[];
}

// Get icon for trigger type
function getTriggerIcon(triggerType?: TriggerType | string) {
  switch (triggerType) {
    case "click":
      return <MousePointer className="h-4 w-4" />;
    case "hover":
      return <Eye className="h-4 w-4" />;
    case "focus":
      return <Focus className="h-4 w-4" />;
    case "scroll":
      return <RefreshCw className="h-4 w-4" />;
    case "navigation":
      return <Navigation className="h-4 w-4" />;
    case "keyboard":
      return <Keyboard className="h-4 w-4" />;
    case "state_change":
      return <RefreshCw className="h-4 w-4" />;
    default:
      return <HelpCircle className="h-4 w-4" />;
  }
}

// Get display name for trigger type
function getTriggerLabel(triggerType?: TriggerType | string): string {
  if (!triggerType) return "Unknown";
  return (
    triggerType.charAt(0).toUpperCase() + triggerType.slice(1).replace("_", " ")
  );
}

export function TransitionsView({ transitions, states }: TransitionsViewProps) {
  // Create a map of state IDs to names for quick lookup
  const stateNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const state of states) {
      map.set(state.id, state.name);
    }
    return map;
  }, [states]);

  // Get state name by ID
  const getStateName = (stateId: string): string => {
    return stateNameMap.get(stateId) || stateId;
  };

  if (transitions.length === 0) {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent className="text-center text-muted-foreground py-12">
          <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">No transitions discovered</p>
          <p className="text-sm mt-1">
            Transitions are inferred from navigation patterns during extraction
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          Transitions ({transitions.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 p-0 min-h-0">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-3">
            {transitions.map((transition) => (
              <div
                key={transition.id}
                className="border rounded-lg p-4 bg-card hover:bg-accent/50 transition-colors"
              >
                {/* From -> To states */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {getStateName(transition.from_state_id)}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {transition.source_url || "Unknown source"}
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-brand-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {getStateName(transition.to_state_id)}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {transition.target_url || "Same page"}
                    </div>
                  </div>
                </div>

                {/* Trigger info */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="secondary"
                    className="flex items-center gap-1"
                  >
                    {getTriggerIcon(transition.trigger_type)}
                    {getTriggerLabel(transition.trigger_type)}
                  </Badge>

                  {transition.trigger_text && (
                    <Badge variant="outline" className="text-xs">
                      &quot;{transition.trigger_text}&quot;
                    </Badge>
                  )}

                  {transition.trigger_selector && (
                    <Badge variant="outline" className="text-xs font-mono">
                      {transition.trigger_selector.length > 40
                        ? transition.trigger_selector.slice(0, 40) + "..."
                        : transition.trigger_selector}
                    </Badge>
                  )}

                  {transition.has_image && (
                    <Badge
                      variant="secondary"
                      className="flex items-center gap-1"
                    >
                      <Link className="h-3 w-3" />
                      Image link
                    </Badge>
                  )}

                  {transition.confidence !== undefined && (
                    <Badge
                      variant={
                        transition.confidence > 0.8 ? "default" : "secondary"
                      }
                      className="text-xs"
                    >
                      {Math.round(transition.confidence * 100)}% confidence
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
