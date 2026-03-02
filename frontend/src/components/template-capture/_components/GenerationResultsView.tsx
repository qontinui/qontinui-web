import React from "react";
import { Check, AlertCircle, Layers } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { GenerateStateMachineResponse } from "@/services/template-capture-service";

interface GenerationResultsViewProps {
  result: GenerateStateMachineResponse;
  importSuccess: boolean;
  error: string | null;
}

export function GenerationResultsView({
  result,
  importSuccess,
  error,
}: GenerationResultsViewProps) {
  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center gap-2 text-green-600">
        <Check className="h-5 w-5" />
        <span className="font-medium">State machine generated</span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 bg-muted rounded-lg text-center">
          <div className="text-2xl font-bold">
            {result.grouping_result.state_count}
          </div>
          <div className="text-sm text-muted-foreground">States</div>
        </div>
        <div className="p-4 bg-muted rounded-lg text-center">
          <div className="text-2xl font-bold">
            {result.grouping_result.total_state_images}
          </div>
          <div className="text-sm text-muted-foreground">State Images</div>
        </div>
        <div className="p-4 bg-muted rounded-lg text-center">
          <div className="text-2xl font-bold">
            {result.config.transitions.length}
          </div>
          <div className="text-sm text-muted-foreground">Transitions</div>
        </div>
      </div>

      {result.grouping_result.ungrouped_count > 0 && (
        <div className="flex items-center gap-2 text-yellow-600 text-sm">
          <AlertCircle className="h-4 w-4" />
          {result.grouping_result.ungrouped_count} templates were not assigned
          to any state
        </div>
      )}

      <Separator />

      {/* State Summary */}
      <div className="space-y-2">
        <Label>States</Label>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {result.config.states.map((state) => (
            <div
              key={state.id}
              className="flex items-center justify-between p-2 bg-muted/50 rounded"
            >
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{state.name}</span>
                {state.is_initial && (
                  <Badge variant="secondary" className="text-xs">
                    Initial
                  </Badge>
                )}
              </div>
              <Badge variant="outline">
                {state.state_images.length} images
              </Badge>
            </div>
          ))}
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Processing time: {result.grouping_result.processing_time_ms.toFixed(1)}
        ms
      </div>

      {/* Import Success Message */}
      {importSuccess && (
        <div className="flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-lg text-sm">
          <Check className="h-4 w-4 flex-shrink-0" />
          Configuration imported to project successfully. The states and
          transitions have been merged with your existing project configuration.
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
