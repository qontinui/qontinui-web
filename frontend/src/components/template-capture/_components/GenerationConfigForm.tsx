import React from "react";
import { AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { GroupingMethod } from "@/services/template-capture-service";
import { GROUPING_METHODS } from "../generate-state-machine-constants";

interface GenerationConfigFormProps {
  approvedTemplateCount: number;
  uniqueStateHints: string[];
  templatesByHint: { byHint: Record<string, number>; noHint: number };

  groupingMethod: GroupingMethod;
  onGroupingMethodChange: (method: GroupingMethod) => void;
  stateMachineName: string;
  onStateMachineNameChange: (name: string) => void;
  includeTransitions: boolean;
  onIncludeTransitionsChange: (include: boolean) => void;
  showAdvanced: boolean;
  onShowAdvancedChange: (show: boolean) => void;

  coOccurrenceThreshold: number;
  onCoOccurrenceThresholdChange: (threshold: number) => void;
  sampleInterval: number;
  onSampleIntervalChange: (interval: number) => void;
  videoPath?: string;

  singleStateName: string;
  onSingleStateNameChange: (name: string) => void;

  error: string | null;
}

export function GenerationConfigForm({
  approvedTemplateCount,
  uniqueStateHints,
  templatesByHint,
  groupingMethod,
  onGroupingMethodChange,
  stateMachineName,
  onStateMachineNameChange,
  includeTransitions,
  onIncludeTransitionsChange,
  showAdvanced,
  onShowAdvancedChange,
  coOccurrenceThreshold,
  onCoOccurrenceThresholdChange,
  sampleInterval,
  onSampleIntervalChange,
  videoPath,
  singleStateName,
  onSingleStateNameChange,
  error,
}: GenerationConfigFormProps) {
  return (
    <div className="space-y-6 py-4">
      {/* Template Summary */}
      <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
        <div>
          <div className="font-medium">
            {approvedTemplateCount} Approved Templates
          </div>
          <div className="text-sm text-muted-foreground">
            {uniqueStateHints.length > 0
              ? `${uniqueStateHints.length} state hints defined`
              : "No state hints defined"}
          </div>
        </div>
        {templatesByHint.noHint > 0 && (
          <Badge variant="secondary" className="text-yellow-600">
            {templatesByHint.noHint} without hints
          </Badge>
        )}
      </div>

      {/* State Machine Name */}
      <div className="space-y-2">
        <Label htmlFor="smName">State Machine Name</Label>
        <Input
          id="smName"
          value={stateMachineName}
          onChange={(e) => onStateMachineNameChange(e.target.value)}
          placeholder="Enter a name for the state machine"
        />
      </div>

      {/* Grouping Method */}
      <div className="space-y-2">
        <Label>Grouping Method</Label>
        <Select
          value={groupingMethod}
          onValueChange={(v) => onGroupingMethodChange(v as GroupingMethod)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUPING_METHODS.map((method) => (
              <SelectItem key={method.value} value={method.value}>
                <div className="flex flex-col">
                  <span>{method.label}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {
            GROUPING_METHODS.find((m) => m.value === groupingMethod)
              ?.description
          }
        </p>
      </div>

      {/* Method-specific Options */}
      {groupingMethod === "state_hints" && uniqueStateHints.length === 0 && (
        <div className="flex items-center gap-2 p-3 bg-yellow-50 text-yellow-700 rounded-lg text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          No state hints have been assigned. Go back to the review panel and
          assign state hints to templates.
        </div>
      )}

      {groupingMethod === "state_hints" && uniqueStateHints.length > 0 && (
        <div className="space-y-2">
          <Label>State Hints Preview</Label>
          <div className="flex flex-wrap gap-2">
            {uniqueStateHints.map((hint) => (
              <Badge key={hint} variant="outline">
                {hint} ({templatesByHint.byHint[hint]})
              </Badge>
            ))}
          </div>
        </div>
      )}

      {groupingMethod === "co_occurrence" && (
        <div className="space-y-4 p-4 border rounded-lg">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Co-Occurrence Threshold</Label>
              <span className="text-sm text-muted-foreground">
                {Math.round(coOccurrenceThreshold * 100)}%
              </span>
            </div>
            <Slider
              value={[coOccurrenceThreshold]}
              min={0.5}
              max={1}
              step={0.05}
              onValueChange={([v]) =>
                v !== undefined && onCoOccurrenceThresholdChange(v)
              }
            />
            <p className="text-xs text-muted-foreground">
              Templates appearing together above this threshold are grouped
            </p>
          </div>

          {!videoPath && (
            <div className="flex items-center gap-2 p-3 bg-yellow-50 text-yellow-700 rounded-lg text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              Co-occurrence analysis requires the original video file
            </div>
          )}

          <div className="space-y-2">
            <Label>Sample Interval (frames)</Label>
            <Input
              type="number"
              value={sampleInterval}
              onChange={(e) =>
                onSampleIntervalChange(parseInt(e.target.value) || 30)
              }
              min={1}
              max={120}
            />
            <p className="text-xs text-muted-foreground">
              Analyze every Nth frame for template presence
            </p>
          </div>
        </div>
      )}

      {groupingMethod === "single_state" && (
        <div className="space-y-2">
          <Label htmlFor="singleStateName">State Name</Label>
          <Input
            id="singleStateName"
            value={singleStateName}
            onChange={(e) => onSingleStateNameChange(e.target.value)}
            placeholder="Main State"
          />
        </div>
      )}

      {/* Advanced Options */}
      <Collapsible open={showAdvanced} onOpenChange={onShowAdvancedChange}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between">
            Advanced Options
            {showAdvanced ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-4">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="includeTransitions"
              checked={includeTransitions}
              onChange={(e) => onIncludeTransitionsChange(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="includeTransitions" className="font-normal">
              Generate transitions between states
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Creates click-based transitions from each template&apos;s source
            state
          </p>
        </CollapsibleContent>
      </Collapsible>

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
