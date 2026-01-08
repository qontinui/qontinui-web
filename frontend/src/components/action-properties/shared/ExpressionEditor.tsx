"use client";

import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface ExpressionEditorProps {
  /** Current expression value */
  value: string;

  /** Called when expression changes */
  onChange: (expression: string) => void;

  /** Optional label text */
  label?: string;

  /** Optional placeholder text with example expressions */
  placeholder?: string;

  /** Optional class name */
  className?: string;

  /** Minimum number of rows */
  minRows?: number;

  /** Whether the field is required */
  required?: boolean;

  /** Optional helper text */
  helperText?: string;
}

/**
 * ExpressionEditor component - provides a code-friendly textarea for JavaScript expressions.
 *
 * Features:
 * - Monospace font for better code readability
 * - Auto-resize based on content
 * - Placeholder with example expressions
 * - Clean, consistent styling
 */
export function ExpressionEditor({
  value,
  onChange,
  label = "Expression",
  placeholder = "e.g., count > 10 || status === 'ready'",
  className,
  minRows = 3,
  required = false,
  helperText,
}: ExpressionEditorProps) {
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <Label className="text-xs text-text-muted">
          {label}
          {required && <span className="text-red-400 ml-1">*</span>}
        </Label>
      )}

      <Textarea
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className="bg-transparent border-border-default font-mono text-sm resize-y"
        style={{
          minHeight: `${minRows * 1.5}rem`,
        }}
      />

      {helperText && <p className="text-xs text-text-muted">{helperText}</p>}

      {!helperText && (
        <p className="text-xs text-text-muted">
          JavaScript expression. You can use variables, operators, and
          functions.
        </p>
      )}
    </div>
  );
}
