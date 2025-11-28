import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { styles } from "@/config/theme";

/**
 * Qontinui-themed textarea component
 * Extends the base Textarea component with dark theme styling
 */

export interface QontinuiTextareaProps
  extends React.ComponentProps<typeof Textarea> {
  /**
   * Optional label for the textarea
   */
  label?: string;
  /**
   * Optional error message
   */
  error?: string;
}

export const QontinuiTextarea = React.forwardRef<
  HTMLTextAreaElement,
  QontinuiTextareaProps
>(({ className, label, error, ...props }, ref) => {
  const textareaId = React.useId();

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={textareaId}
          className={cn(styles.text.primary, "text-sm font-medium")}
        >
          {label}
        </label>
      )}
      <Textarea
        ref={ref}
        id={textareaId}
        className={cn(styles.input, error && "border-red-500", className)}
        aria-invalid={!!error}
        {...props}
      />
      {error && (
        <span className="text-red-500 text-xs font-medium">{error}</span>
      )}
    </div>
  );
});

QontinuiTextarea.displayName = "QontinuiTextarea";

/**
 * Example usage:
 *
 * <QontinuiTextarea
 *   label="Description"
 *   placeholder="Enter description..."
 *   rows={4}
 *   error={errors.description}
 * />
 */
