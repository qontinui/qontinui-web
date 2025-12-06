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
import { styles } from "@/config/theme";

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
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={selectId}
          className={cn(styles.text.primary, "text-sm font-medium")}
        >
          {label}
        </label>
      )}
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          id={selectId}
          className={cn(styles.select, error && "border-red-500")}
          aria-invalid={!!error}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="bg-[#27272A] border border-gray-700">
          <SelectGroup>
            {options.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="text-gray-300 focus:bg-[#0A0A0B] focus:text-white"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {error && (
        <span className="text-red-500 text-xs font-medium">{error}</span>
      )}
    </div>
  );
}

/**
 * Example usage:
 *
 * <QontinuiSelect
 *   label="Select State"
 *   placeholder="Choose a state..."
 *   options={[
 *     { value: "login", label: "Login State" },
 *     { value: "dashboard", label: "Dashboard State" },
 *   ]}
 *   value={selectedState}
 *   onValueChange={setSelectedState}
 *   error={errors.state}
 * />
 */
