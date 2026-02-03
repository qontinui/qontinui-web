import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Qontinui-themed input component
 * Extends the base Input component with dark theme styling
 */

export interface QontinuiInputProps extends React.ComponentProps<typeof Input> {
  /**
   * Optional label for the input
   */
  label?: string;
  /**
   * Optional error message
   */
  error?: string;
}

export const QontinuiInput = React.forwardRef<
  HTMLInputElement,
  QontinuiInputProps
>(({ className, label, error, ...props }, ref) => {
  const inputId = React.useId();

  return (
    <div className="form-group">
      {label && (
        <label htmlFor={inputId} className="form-label">
          {label}
        </label>
      )}
      <Input
        ref={ref}
        id={inputId}
        className={cn("input", error && "border-error", className)}
        aria-invalid={!!error}
        {...props}
      />
      {error && <span className="form-error">{error}</span>}
    </div>
  );
});

QontinuiInput.displayName = "QontinuiInput";
