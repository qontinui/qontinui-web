import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Qontinui-themed textarea component
 * Extends the base Textarea component with dark theme styling
 */

export interface QontinuiTextareaProps extends React.ComponentProps<
  typeof Textarea
> {
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
    <div className="form-group">
      {label && (
        <label htmlFor={textareaId} className="form-label">
          {label}
        </label>
      )}
      <Textarea
        ref={ref}
        id={textareaId}
        className={cn("input", error && "border-error", className)}
        aria-invalid={!!error}
        {...props}
      />
      {error && <span className="form-error">{error}</span>}
    </div>
  );
});

QontinuiTextarea.displayName = "QontinuiTextarea";
