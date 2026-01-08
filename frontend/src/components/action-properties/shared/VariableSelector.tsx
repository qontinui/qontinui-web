"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface VariableSelectorProps {
  /** Current variable name value */
  value: string;

  /** Called when variable name changes */
  onChange: (name: string) => void;

  /** Optional list of existing variables for autocomplete */
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

/**
 * VariableSelector component - provides a validated text input for variable names.
 *
 * Features:
 * - Validates variable names (alphanumeric and underscore only, must start with letter or underscore)
 * - Optional autocomplete suggestions from existing variables
 * - Clean, consistent styling with the rest of the app
 */
export function VariableSelector({
  value,
  onChange,
  existingVariables = [],
  label,
  placeholder = "variableName",
  className,
  required = false,
}: VariableSelectorProps) {
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [isInvalid, setIsInvalid] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Validate variable name (must start with letter or underscore, then alphanumeric or underscore)
  const validateVariableName = (name: string): boolean => {
    if (!name) return true; // Empty is valid (unless required)
    const variableNamePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    return variableNamePattern.test(name);
  };

  // Filter suggestions based on current input
  const filteredSuggestions = React.useMemo(() => {
    if (!value || !existingVariables.length) return [];
    const lowerValue = value.toLowerCase();
    return existingVariables
      .filter((v) => v.toLowerCase().includes(lowerValue) && v !== value)
      .slice(0, 5); // Limit to 5 suggestions
  }, [value, existingVariables]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    const valid = validateVariableName(newValue);
    setIsInvalid(!valid);
    onChange(newValue);

    // Show suggestions if we have matches
    if (newValue && filteredSuggestions.length > 0) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    onChange(suggestion);
    setShowSuggestions(false);
    setIsInvalid(false);
  };

  const handleBlur = () => {
    // Delay hiding suggestions to allow click events to fire
    setTimeout(() => setShowSuggestions(false), 200);
  };

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <Label className="text-xs text-text-muted">
          {label}
          {required && <span className="text-red-400 ml-1">*</span>}
        </Label>
      )}

      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onFocus={() => {
            if (value && filteredSuggestions.length > 0) {
              setShowSuggestions(true);
            }
          }}
          onBlur={handleBlur}
          placeholder={placeholder}
          className={cn(
            "bg-transparent border-border-default font-mono text-sm",
            isInvalid &&
              "border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/50"
          )}
          aria-invalid={isInvalid}
        />

        {isInvalid && value && (
          <p className="text-xs text-red-400 mt-1">
            Variable name must start with a letter or underscore, followed by
            letters, numbers, or underscores
          </p>
        )}

        {/* Autocomplete suggestions */}
        {showSuggestions && filteredSuggestions.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-surface-raised border border-border-default rounded-md shadow-lg max-h-40 overflow-auto">
            {filteredSuggestions.map((suggestion, index) => (
              <button
                key={index}
                type="button"
                onClick={() => handleSuggestionClick(suggestion)}
                className="w-full text-left px-3 py-2 text-sm font-mono hover:bg-surface-raised focus:bg-surface-raised focus:outline-none text-text-default first:rounded-t-md last:rounded-b-md"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
