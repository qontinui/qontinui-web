import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ArrowRight } from "lucide-react";
import { formatTimestamp, formatDuration } from "../utils";
import type { DiscoveredState } from "../types";

interface StateDetailPanelProps {
  selectedState: DiscoveredState | null;
}

export function StateDetailPanel({ selectedState }: StateDetailPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">State Details</CardTitle>
      </CardHeader>
      <CardContent>
        {selectedState ? (
          <ScrollArea className="h-[600px]">
            <div className="space-y-4">
              {/* Basic Info */}
              <div className="space-y-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    State ID
                  </p>
                  <p className="text-sm font-mono">{selectedState.state_id}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    First Seen
                  </p>
                  <p className="text-sm">
                    {formatTimestamp(selectedState.timestamp_first_seen)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Last Seen
                  </p>
                  <p className="text-sm">
                    {formatTimestamp(selectedState.timestamp_last_seen)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Duration
                  </p>
                  <p className="text-sm">
                    {formatDuration(selectedState.metadata.duration_seconds)}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Screenshots */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Screenshots ({selectedState.screenshot_ids.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {selectedState.screenshot_ids.map((id) => (
                    <Badge key={id} variant="secondary" className="text-xs">
                      #{id}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Representative: #{selectedState.representative_screenshot_id}
                </p>
              </div>

              <Separator />

              {/* Input Events */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Input Events ({selectedState.input_events.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {selectedState.input_events.map((id) => (
                    <Badge key={id} variant="outline" className="text-xs">
                      #{id}
                    </Badge>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Transitions */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Outgoing Transitions (
                  {selectedState.outgoing_transitions.length})
                </p>
                <div className="space-y-2">
                  {selectedState.outgoing_transitions.map((transition, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded-md border bg-accent/50 space-y-1"
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">
                          {transition.from_state_id}
                        </span>
                        <ArrowRight className="h-3 w-3" />
                        <span className="font-medium">
                          {transition.to_state_id}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Event: {transition.event_type} (#
                        {transition.trigger_event_id})
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Confidence: {(transition.confidence * 100).toFixed(0)}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatTimestamp(transition.timestamp)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        ) : (
          <div className="flex items-center justify-center h-[600px] text-muted-foreground">
            Select a state to view details
          </div>
        )}
      </CardContent>
    </Card>
  );
}
