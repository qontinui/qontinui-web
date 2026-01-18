import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Qontinui-themed button variants
 * Extends the base Button component with gaming-aesthetic accent colors
 */

interface QontinuiButtonProps extends React.ComponentProps<typeof Button> {
  /**
   * Qontinui button variant
   * - cyan: Primary actions, upload buttons, highlights
   * - green: Success actions, create buttons
   * - purple: Develop actions, state management
   * - ghost: Secondary actions, cancel buttons
   */
  qontinuiVariant?: "cyan" | "green" | "purple" | "ghost";
}

const variantClasses = {
  cyan: "btn-primary",
  green: "btn-success",
  purple: "btn-secondary",
  ghost: "btn-ghost",
};

export function QontinuiButton({
  qontinuiVariant = "cyan",
  className,
  ...props
}: QontinuiButtonProps) {
  return (
    <Button
      className={cn(variantClasses[qontinuiVariant], className)}
      {...props}
    />
  );
}

/**
 * Pre-configured button variants for common use cases
 */

export function UploadButton(
  props: Omit<QontinuiButtonProps, "qontinuiVariant">
) {
  return <QontinuiButton qontinuiVariant="cyan" {...props} />;
}

export function CreateButton(
  props: Omit<QontinuiButtonProps, "qontinuiVariant">
) {
  return <QontinuiButton qontinuiVariant="green" {...props} />;
}

export function DevelopButton(
  props: Omit<QontinuiButtonProps, "qontinuiVariant">
) {
  return <QontinuiButton qontinuiVariant="purple" {...props} />;
}

export function GhostButton(
  props: Omit<QontinuiButtonProps, "qontinuiVariant">
) {
  return <QontinuiButton qontinuiVariant="ghost" {...props} />;
}
