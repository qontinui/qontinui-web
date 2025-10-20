import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { styles } from "@/config/theme";

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

export const QontinuiInput = React.forwardRef<HTMLInputElement, QontinuiInputProps>(
  ({ className, label, error, ...props }, ref) => {
    const inputId = React.useId();

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className={cn(styles.text.primary, "text-sm font-medium")}>
            {label}
          </label>
        )}
        <Input
          ref={ref}
          id={inputId}
          className={cn(styles.input, error && "border-red-500", className)}
          aria-invalid={!!error}
          {...props}
        />
        {error && (
          <span className="text-red-500 text-xs font-medium">{error}</span>
        )}
      </div>
    );
  }
);

QontinuiInput.displayName = "QontinuiInput";

/**
 * Example usage:
 *
 * <QontinuiInput
 *   label="Username"
 *   placeholder="Enter your username"
 *   error={errors.username}
 * />
 */
