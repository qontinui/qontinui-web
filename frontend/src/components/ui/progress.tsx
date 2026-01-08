"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const progressVariants = cva("h-full transition-all duration-300 ease-in-out", {
  variants: {
    variant: {
      default: "bg-primary",
      success: "bg-success",
      warning: "bg-warning",
      error: "bg-error",
      info: "bg-info",
      "brand-primary": "bg-brand-primary",
      "brand-secondary": "bg-brand-secondary",
      "brand-success": "bg-brand-success",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

interface ProgressProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof progressVariants> {
  value?: number;
  max?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, max = 100, variant, ...props }, ref) => {
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

    return (
      <div
        ref={ref}
        className={cn(
          "relative h-4 w-full overflow-hidden rounded-full bg-muted",
          className
        )}
        {...props}
      >
        <div
          className={cn(progressVariants({ variant }))}
          style={{ width: `${percentage}%` }}
        />
      </div>
    );
  }
);
Progress.displayName = "Progress";

export { Progress, progressVariants };
