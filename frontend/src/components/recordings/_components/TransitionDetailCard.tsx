"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckSquare, Square } from "lucide-react";
import {
  getConfidenceColor,
  getConfidenceLevel,
  type DiscoveredTransition,
} from "@/types/recording";

interface TransitionDetailCardProps {
  transition: DiscoveredTransition;
  isSelected: boolean;
  onToggleSelection: (transitionId: string) => void;
}

export function TransitionDetailCard({
  transition,
  isSelected,
  onToggleSelection,
}: TransitionDetailCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Transition</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggleSelection(transition.id)}
          >
            {isSelected ? (
              <CheckSquare className="h-4 w-4" />
            ) : (
              <Square className="h-4 w-4" />
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {transition.trigger_description && (
          <p className="text-sm text-muted-foreground">
            {transition.trigger_description}
          </p>
        )}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Trigger</span>
            <Badge variant="outline">
              {transition.trigger_type || "Unknown"}
            </Badge>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Confidence</span>
            <Badge
              className={getConfidenceColor(
                getConfidenceLevel(transition.confidence)
              )}
            >
              {Math.round((transition.confidence || 0) * 100)}%
            </Badge>
          </div>
          {transition.latency_ms && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Latency</span>
              <span>{transition.latency_ms}ms</span>
            </div>
          )}
          {transition.workflow_name && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Workflow</span>
              <span>{transition.workflow_name}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
