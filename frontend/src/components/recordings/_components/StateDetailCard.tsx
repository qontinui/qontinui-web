"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckSquare, Square } from "lucide-react";
import {
  getConfidenceColor,
  getConfidenceLevel,
  type DiscoveredState,
} from "@/types/recording";

interface StateDetailCardProps {
  state: DiscoveredState;
  isSelected: boolean;
  onToggleSelection: (stateId: string) => void;
}

export function StateDetailCard({
  state,
  isSelected,
  onToggleSelection,
}: StateDetailCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>State: {state.name}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggleSelection(state.id)}
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
        {state.description && (
          <p className="text-sm text-muted-foreground">{state.description}</p>
        )}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Confidence</span>
            <Badge
              className={getConfidenceColor(
                getConfidenceLevel(state.confidence)
              )}
            >
              {Math.round((state.confidence || 0) * 100)}%
            </Badge>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Frames</span>
            <span>{state.frame_count}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Images</span>
            <span>{state.state_images.length}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Regions</span>
            <span>{state.regions.length}</span>
          </div>
        </div>
        {state.is_initial && <Badge variant="outline">Initial State</Badge>}
        {state.is_error_state && (
          <Badge variant="outline" className="text-red-600">
            Error State
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
