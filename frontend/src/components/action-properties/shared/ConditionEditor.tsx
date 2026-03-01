"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { VariableSelector } from "./VariableSelector";
import { ExpressionEditor } from "./ExpressionEditor";
import { ConditionConfig } from "@/lib/action-schema";

export interface ConditionEditorProps {
  /** Current condition configuration */
  condition: ConditionConfig | undefined;

  /** Called when condition changes */
  onChange: (condition: ConditionConfig | undefined) => void;

  /** Optional label text */
  label?: string;

  /** Optional class name */
  className?: string;

  /** List of existing variables for autocomplete */
  existingVariables?: string[];

  /** Whether to allow undefined/empty condition */
  allowEmpty?: boolean;

  /** Available images for image_exists/image_vanished conditions */
  images?: Array<{ id: string; name: string }>;
}

const DEFAULT_EXISTING_VARIABLES: string[] = [];
const DEFAULT_IMAGES: Array<{ id: string; name: string }> = [];

/**
 * ConditionEditor component - provides UI for editing condition configurations.
 *
 * Supports:
 * - Variable conditions (compare variable to expected value)
 * - Expression conditions (JavaScript expressions)
 *
 * Simplified version for Phase 1 - focuses on variable and expression types.
 */
export function ConditionEditor({
  condition,
  onChange,
  label = "Condition",
  className,
  existingVariables = DEFAULT_EXISTING_VARIABLES,
  allowEmpty = true,
  images = DEFAULT_IMAGES,
}: ConditionEditorProps) {
  const [localCondition, setLocalCondition] = React.useState<ConditionConfig>(
    condition || {
      type: "variable",
      variableName: "",
      operator: "==",
      expectedValue: "",
    }
  );

  // Update local state when condition prop changes
  React.useEffect(() => {
    if (condition) {
      setLocalCondition(condition);
    }
  }, [condition]);

  const updateCondition = (updates: Partial<ConditionConfig>) => {
    const newCondition = { ...localCondition, ...updates };
    setLocalCondition(newCondition);
    onChange(newCondition);
  };

  const handleTypeChange = (type: ConditionConfig["type"]) => {
    const baseCondition: ConditionConfig = {
      type,
      operator: "==",
    };

    if (type === "variable") {
      baseCondition.variableName = "";
      baseCondition.expectedValue = "";
    } else if (type === "expression") {
      baseCondition.expression = "";
    } else if (type === "image_exists" || type === "image_vanished") {
      baseCondition.imageId = "";
    } else if (type === "text_exists") {
      baseCondition.text = "";
    }

    setLocalCondition(baseCondition);
    onChange(baseCondition);
  };

  const handleClear = () => {
    if (allowEmpty) {
      onChange(undefined);
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        {label && <Label className="text-xs text-text-muted">{label}</Label>}
        {allowEmpty && condition && (
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-text-muted hover:text-red-400 transition-colors"
          >
            Clear condition
          </button>
        )}
      </div>

      {/* Condition Type Selector */}
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Condition Type</Label>
        <Select
          value={localCondition.type}
          onValueChange={(value) =>
            handleTypeChange(value as ConditionConfig["type"])
          }
        >
          <SelectTrigger className="bg-transparent border-border-default">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="variable">Variable Comparison</SelectItem>
            <SelectItem value="expression">JavaScript Expression</SelectItem>
            <SelectItem value="image_exists">Image Exists</SelectItem>
            <SelectItem value="image_vanished">Image Vanished</SelectItem>
            <SelectItem value="text_exists">Text Exists</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Variable Condition Fields */}
      {localCondition.type === "variable" && (
        <>
          <VariableSelector
            label="Variable Name"
            value={localCondition.variableName || ""}
            onChange={(name) => updateCondition({ variableName: name })}
            existingVariables={existingVariables}
            placeholder="myVariable"
            required
          />

          <div className="space-y-2">
            <Label className="text-xs text-text-muted">Operator</Label>
            <Select
              value={localCondition.operator || "=="}
              onValueChange={(value) =>
                updateCondition({
                  operator: value as ConditionConfig["operator"],
                })
              }
            >
              <SelectTrigger className="bg-transparent border-border-default">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="==">Equals (==)</SelectItem>
                <SelectItem value="!=">Not Equals (!=)</SelectItem>
                <SelectItem value=">">Greater Than (&gt;)</SelectItem>
                <SelectItem value="<">Less Than (&lt;)</SelectItem>
                <SelectItem value=">=">Greater or Equal (&gt;=)</SelectItem>
                <SelectItem value="<=">Less or Equal (&lt;=)</SelectItem>
                <SelectItem value="contains">Contains</SelectItem>
                <SelectItem value="matches">Matches (regex)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-text-muted">Expected Value</Label>
            <Input
              type="text"
              value={localCondition.expectedValue?.toString() || ""}
              onChange={(e) =>
                updateCondition({ expectedValue: e.target.value })
              }
              placeholder="value"
              className="bg-transparent border-border-default font-mono text-sm"
            />
            <p className="text-xs text-text-muted">
              Enter the value to compare against. Numbers and booleans will be
              automatically converted.
            </p>
          </div>
        </>
      )}

      {/* Expression Condition Fields */}
      {localCondition.type === "expression" && (
        <ExpressionEditor
          label="Expression"
          value={localCondition.expression || ""}
          onChange={(expr) => updateCondition({ expression: expr })}
          placeholder="e.g., count > 10 && status === 'ready'"
          helperText="Expression should evaluate to true or false"
          required
        />
      )}

      {/* Image Exists / Image Vanished Condition Fields */}
      {(localCondition.type === "image_exists" ||
        localCondition.type === "image_vanished") && (
        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Image</Label>
          <Select
            value={localCondition.imageId || ""}
            onValueChange={(value) => updateCondition({ imageId: value })}
          >
            <SelectTrigger className="bg-transparent border-border-default">
              <SelectValue placeholder="Select an image" />
            </SelectTrigger>
            <SelectContent>
              {images.length === 0 ? (
                <SelectItem value="" disabled>
                  No images available
                </SelectItem>
              ) : (
                images.map((image) => (
                  <SelectItem key={image.id} value={image.id}>
                    {image.name || image.id}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <p className="text-xs text-text-muted">
            {localCondition.type === "image_exists"
              ? "Condition is true when the image is found on screen"
              : "Condition is true when the image is no longer visible on screen"}
          </p>
        </div>
      )}

      {/* Text Exists Condition Fields */}
      {localCondition.type === "text_exists" && (
        <>
          <div className="space-y-2">
            <Label className="text-xs text-text-muted">Text to Find</Label>
            <Input
              type="text"
              value={localCondition.text || ""}
              onChange={(e) => updateCondition({ text: e.target.value })}
              placeholder="Enter text to search for"
              className="bg-transparent border-border-default font-mono text-sm"
            />
            <p className="text-xs text-text-muted">
              Condition is true when this text is found on screen
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-text-muted">
              Operator (Optional)
            </Label>
            <Select
              value={localCondition.operator || "contains"}
              onValueChange={(value) =>
                updateCondition({
                  operator: value as ConditionConfig["operator"],
                })
              }
            >
              <SelectTrigger className="bg-transparent border-border-default">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contains">Contains</SelectItem>
                <SelectItem value="==">Exact Match (==)</SelectItem>
                <SelectItem value="matches">Matches (regex)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}
    </div>
  );
}
