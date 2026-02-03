"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Qontinui-themed select component
 * Extends the base Select component with dark theme styling
 */

export interface QontinuiSelectProps {
  /**
   * Optional label for the select
   */
  label?: string;
  /**
   * Optional error message
   */
  error?: string;
  /**
   * Placeholder text
   */
  placeholder?: string;
  /**
   * Select options
   */
  options: Array<{
    value: string;
    label: string;
  }>;
  /**
   * Current value
   */
  value?: string;
  /**
   * Change handler
   */
  onValueChange?: (value: string) => void;
  /**
   * Whether the select is disabled
   */
  disabled?: boolean;
}

export function QontinuiSelect({
  label,
  error,
  placeholder = "Select an option...",
  options,
  value,
  onValueChange,
  disabled,
}: QontinuiSelectProps) {
  const selectId = React.useId();

  return (
    <div className="form-group">
      {label && (
        <label htmlFor={selectId} className="form-label">
          {label}
        </label>
      )}
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          id={selectId}
          className={cn("select", error && "border-error")}
          aria-invalid={!!error}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="bg-surface-raised border border-border-default">
          <SelectGroup>
            {options.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="text-muted-foreground focus:bg-surface-canvas focus:text-foreground"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}
