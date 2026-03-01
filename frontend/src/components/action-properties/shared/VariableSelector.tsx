"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Pencil, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VariableSelectorProps {
  /** Current variable name value */
  value: string;

  /** Called when variable name changes */
  onChange: (name: string) => void;

  /** Optional list of existing variables for dropdown */
  existingVariables?: string[];

  /** Optional label text */
  label?: string;

  /** Optional placeholder text */
  placeholder?: string;

  /** Optional class name */
  className?: string;

  /** Whether the field is required */
  required?: boolean;
}

const CUSTOM_VALUE = "__custom__";
const DEFAULT_EXISTING_VARIABLES: string[] = [];

/**
 * VariableSelector component - provides a dropdown for selecting existing variables
 * or entering a custom variable name.
 *
 * Features:
 * - Dropdown with all existing variables when available
 * - Option to enter a custom variable name
 * - Validates variable names (alphanumeric and underscore only)
 * - Shows dropdown by default, with "Enter custom name" option
 */
export function VariableSelector({
  value,
  onChange,
  existingVariables = DEFAULT_EXISTING_VARIABLES,
  label,
  placeholder = "variableName",
  className,
  required = false,
}: VariableSelectorProps) {
  // Track if user wants to enter a custom value
  const [isCustomMode, setIsCustomMode] = React.useState(false);
  const [isInvalid, setIsInvalid] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Check if current value is custom (not in the list and not empty)
  const isValueInList = existingVariables.includes(value);
  const isCurrentValueCustom = value && !isValueInList;

  // Show text input only if:
  // 1. User explicitly clicked "Enter custom name" (isCustomMode), OR
  // 2. Current value is custom AND not empty (user typed something not in list)
  // Always start with dropdown, even if no variables exist yet
  const showCustomInput =
    isCustomMode || (isCurrentValueCustom && value !== "");

  // Reset custom mode when switching to a value in the list
  React.useEffect(() => {
    if (isValueInList && isCustomMode) {
      setIsCustomMode(false);
    }
  }, [isValueInList, isCustomMode]);

  // Validate variable name
  const validateVariableName = (name: string): boolean => {
    if (!name) return true;
    const variableNamePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    return variableNamePattern.test(name);
  };

  const handleSelectChange = (selectedValue: string) => {
    if (selectedValue === CUSTOM_VALUE) {
      setIsCustomMode(true);
      onChange("");
      // Focus the input after React re-renders
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setIsCustomMode(false);
      setIsInvalid(false);
      onChange(selectedValue);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    const valid = validateVariableName(newValue);
    setIsInvalid(!valid);
    onChange(newValue);
  };

  const handleSwitchToDropdown = () => {
    setIsCustomMode(false);
    setIsInvalid(false);
    // If current value exists in the list, keep it; otherwise clear
    if (!existingVariables.includes(value)) {
      onChange("");
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <Label className="text-xs text-text-muted">
          {label}
          {required && <span className="text-red-400 ml-1">*</span>}
        </Label>
      )}

      {showCustomInput ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              type="text"
              value={value}
              onChange={handleInputChange}
              placeholder={placeholder}
              className={cn(
                "flex-1 bg-transparent border-border-default font-mono text-sm",
                isInvalid &&
                  "border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/50"
              )}
              aria-invalid={isInvalid}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleSwitchToDropdown}
              title="Select from existing variables"
              className="shrink-0 border-border-default"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>

          {isInvalid && value && (
            <p className="text-xs text-red-400">
              Variable name must start with a letter or underscore, followed by
              letters, numbers, or underscores
            </p>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <Select value={value || ""} onValueChange={handleSelectChange}>
            <SelectTrigger className="flex-1 bg-transparent border-border-default font-mono">
              <SelectValue placeholder="Select a variable" />
            </SelectTrigger>
            <SelectContent>
              {existingVariables.length === 0 ? (
                <div className="px-3 py-2 text-sm text-text-muted italic">
                  No variables defined yet
                </div>
              ) : (
                existingVariables.map((varName) => (
                  <SelectItem
                    key={varName}
                    value={varName}
                    className="font-mono"
                  >
                    {varName}
                  </SelectItem>
                ))
              )}
              <SelectItem
                value={CUSTOM_VALUE}
                className="text-text-muted border-t border-border-default mt-1 pt-1"
              >
                <span className="flex items-center gap-2">
                  <Pencil className="h-3 w-3" />
                  Enter custom name...
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
