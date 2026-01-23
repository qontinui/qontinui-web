/**
 * EdgePropertiesPanel Component
 *
 * Panel for editing edge/connection properties in the graph editor.
 * Allows setting labels, conditions, weights, and descriptions for edges.
 */

import React, { useState, useCallback, useEffect } from "react";
import { X, Zap, Tag, Scale, FileText, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import type {
  Connection,
  EdgeCondition,
} from "@/lib/action-schema/action-types";
import type { EdgeInfo } from "@/components/workflow-canvas";

// ============================================================================
// Types
// ============================================================================

export interface EdgePropertiesPanelProps {
  /** Edge information including connection data */
  edge: EdgeInfo | null;
  /** Callback when edge properties are updated */
  onUpdate: (updatedConnection: Connection) => void;
  /** Callback when panel is closed */
  onClose: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function EdgePropertiesPanel({
  edge,
  onUpdate,
  onClose,
}: EdgePropertiesPanelProps) {
  // Local state for form
  const [label, setLabel] = useState(edge?.connection.label || "");
  const [weight, setWeight] = useState(edge?.connection.weight ?? 100);
  const [description, setDescription] = useState(
    edge?.connection.description || ""
  );
  const [conditionType, setConditionType] = useState<EdgeCondition["type"]>(
    edge?.connection.condition?.type || "always"
  );
  const [conditionExpression, setConditionExpression] = useState(
    edge?.connection.condition?.expression || ""
  );
  const [conditionVariable, setConditionVariable] = useState(
    edge?.connection.condition?.variable || ""
  );
  const [conditionOperator, setConditionOperator] = useState<
    EdgeCondition["operator"]
  >(edge?.connection.condition?.operator || "equals");
  const [conditionValue, setConditionValue] = useState(
    String(edge?.connection.condition?.value ?? "")
  );

  const [conditionOpen, setConditionOpen] = useState(
    !!edge?.connection.condition && edge.connection.condition.type !== "always"
  );

  // Update local state when edge changes
  useEffect(() => {
    if (edge) {
      setLabel(edge.connection.label || "");
      setWeight(edge.connection.weight ?? 100);
      setDescription(edge.connection.description || "");
      setConditionType(edge.connection.condition?.type || "always");
      setConditionExpression(edge.connection.condition?.expression || "");
      setConditionVariable(edge.connection.condition?.variable || "");
      setConditionOperator(edge.connection.condition?.operator || "equals");
      setConditionValue(String(edge.connection.condition?.value ?? ""));
      setConditionOpen(
        !!edge.connection.condition &&
          edge.connection.condition.type !== "always"
      );
    }
  }, [edge]);

  // Build updated connection
  const handleSave = useCallback(() => {
    if (!edge) return;

    const updatedConnection: Connection = {
      ...edge.connection,
      label: label.trim() || undefined,
      weight: weight !== 100 ? weight : undefined,
      description: description.trim() || undefined,
    };

    // Build condition if not "always"
    if (conditionType !== "always") {
      const condition: EdgeCondition = { type: conditionType };

      if (conditionType === "expression" && conditionExpression.trim()) {
        condition.expression = conditionExpression.trim();
      } else if (conditionType === "variable" && conditionVariable.trim()) {
        condition.variable = conditionVariable.trim();
        condition.operator = conditionOperator;
        if (conditionValue.trim()) {
          // Try to parse as number or boolean
          const val = conditionValue.trim();
          if (val === "true") {
            condition.value = true;
          } else if (val === "false") {
            condition.value = false;
          } else if (!isNaN(Number(val))) {
            condition.value = Number(val);
          } else {
            condition.value = val;
          }
        }
      }

      updatedConnection.condition = condition;
    } else {
      updatedConnection.condition = undefined;
    }

    onUpdate(updatedConnection);
  }, [
    edge,
    label,
    weight,
    description,
    conditionType,
    conditionExpression,
    conditionVariable,
    conditionOperator,
    conditionValue,
    onUpdate,
  ]);

  if (!edge) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted p-8 text-center">
        <div>
          <Zap className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-sm">Select an edge to edit its properties</p>
        </div>
      </div>
    );
  }

  const connectionTypeColors = {
    main: "bg-blue-500",
    error: "bg-red-500",
    success: "bg-green-500",
    parallel: "bg-purple-500",
  };

  return (
    <div className="h-full flex flex-col bg-surface-canvas border-l border-border-subtle">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-brand-primary" />
          <h3 className="font-semibold text-white">Edge Properties</h3>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8 text-text-muted hover:text-white"
          data-ui-id="automation-edge-close-btn"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Edge Info */}
      <div className="p-4 border-b border-border-subtle bg-surface-canvas/50">
        <div className="text-xs text-text-muted mb-2">Connection</div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-white font-medium truncate max-w-[100px]">
            {edge.sourceName}
          </span>
          <span className="text-text-muted">→</span>
          <span className="text-white font-medium truncate max-w-[100px]">
            {edge.targetName}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium text-white ${connectionTypeColors[edge.outputType]}`}
          >
            {edge.outputType}
          </span>
          {edge.outputIndex > 0 && (
            <span className="text-xs text-text-muted">
              Output #{edge.outputIndex}
            </span>
          )}
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Label */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-text-muted">
            <Tag className="w-4 h-4" />
            Label
          </Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g., Success, Login Failed, Retry"
            className="bg-surface-canvas border-border-default text-white placeholder:text-text-muted"
            data-ui-id="automation-edge-label-input"
          />
          <p className="text-xs text-text-muted">
            Human-readable name displayed on the edge
          </p>
        </div>

        {/* Weight */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-text-muted">
            <Scale className="w-4 h-4" />
            Weight
            <span className="ml-auto text-brand-primary font-mono">
              {weight}%
            </span>
          </Label>
          <Slider
            value={[weight]}
            onValueChange={([val]) => setWeight(val ?? 100)}
            min={0}
            max={100}
            step={5}
            className="py-2"
          />
          <p className="text-xs text-text-muted">
            Priority/probability (higher = more likely to be taken)
          </p>
        </div>

        {/* Condition */}
        <Collapsible open={conditionOpen} onOpenChange={setConditionOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between text-text-muted hover:text-white hover:bg-surface-raised"
            >
              <span className="flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Condition
                {conditionType !== "always" && (
                  <span className="px-2 py-0.5 rounded bg-brand-primary/20 text-brand-primary text-xs">
                    Active
                  </span>
                )}
              </span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${conditionOpen ? "rotate-180" : ""}`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label className="text-text-muted text-xs">Condition Type</Label>
              <Select
                value={conditionType}
                onValueChange={(val) =>
                  setConditionType(val as EdgeCondition["type"])
                }
              >
                <SelectTrigger className="bg-surface-canvas border-border-default text-white" data-ui-id="automation-edge-conditiontype-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="always">Always (no condition)</SelectItem>
                  <SelectItem value="expression">Expression</SelectItem>
                  <SelectItem value="variable">Variable Check</SelectItem>
                  <SelectItem value="timeout">On Timeout</SelectItem>
                  <SelectItem value="retry-exhausted">
                    Retries Exhausted
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {conditionType === "expression" && (
              <div className="space-y-2">
                <Label className="text-text-muted text-xs">
                  JavaScript Expression
                </Label>
                <Textarea
                  value={conditionExpression}
                  onChange={(e) => setConditionExpression(e.target.value)}
                  placeholder="e.g., result.success === true"
                  className="bg-surface-canvas border-border-default text-white placeholder:text-text-muted font-mono text-sm"
                  rows={3}
                  data-ui-id="automation-edge-expression-input"
                />
                <p className="text-xs text-text-muted">
                  Expression evaluated at runtime. Access previous action result
                  via `result`.
                </p>
              </div>
            )}

            {conditionType === "variable" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-text-muted text-xs">
                    Variable Name
                  </Label>
                  <Input
                    value={conditionVariable}
                    onChange={(e) => setConditionVariable(e.target.value)}
                    placeholder="e.g., loginStatus, itemCount"
                    className="bg-surface-canvas border-border-default text-white placeholder:text-text-muted"
                    data-ui-id="automation-edge-variable-input"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label className="text-text-muted text-xs">Operator</Label>
                    <Select
                      value={conditionOperator}
                      onValueChange={(val) =>
                        setConditionOperator(val as EdgeCondition["operator"])
                      }
                    >
                      <SelectTrigger className="bg-surface-canvas border-border-default text-white" data-ui-id="automation-edge-operator-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="equals">Equals</SelectItem>
                        <SelectItem value="not-equals">Not Equals</SelectItem>
                        <SelectItem value="greater">Greater Than</SelectItem>
                        <SelectItem value="less">Less Than</SelectItem>
                        <SelectItem value="contains">Contains</SelectItem>
                        <SelectItem value="exists">Exists</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-text-muted text-xs">Value</Label>
                    <Input
                      value={conditionValue}
                      onChange={(e) => setConditionValue(e.target.value)}
                      placeholder="true, 0, 'success'"
                      className="bg-surface-canvas border-border-default text-white placeholder:text-text-muted"
                      disabled={conditionOperator === "exists"}
                      data-ui-id="automation-edge-value-input"
                    />
                  </div>
                </div>
              </div>
            )}

            {(conditionType === "timeout" ||
              conditionType === "retry-exhausted") && (
              <p className="text-xs text-text-muted p-2 bg-surface-raised rounded">
                This edge will be followed when the source action{" "}
                {conditionType === "timeout"
                  ? "times out"
                  : "exhausts all retries"}
                .
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Description */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-text-muted">
            <FileText className="w-4 h-4" />
            Description
          </Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional notes about this connection..."
            className="bg-surface-canvas border-border-default text-white placeholder:text-text-muted"
            rows={2}
            data-ui-id="automation-edge-description-input"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border-subtle flex gap-2">
        <Button
          variant="outline"
          onClick={onClose}
          className="flex-1 border-border-default text-text-muted hover:bg-surface-raised"
          data-ui-id="automation-edge-cancel-btn"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          className="flex-1 bg-brand-primary text-black hover:bg-brand-primary/90"
          data-ui-id="automation-edge-save-btn"
        >
          Save Changes
        </Button>
      </div>
    </div>
  );
}

export default EdgePropertiesPanel;
