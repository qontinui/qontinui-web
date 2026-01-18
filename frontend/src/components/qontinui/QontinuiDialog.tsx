"use client";

import * as React from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Qontinui-themed dialog components
 * Extends the base Dialog component with dark theme styling
 */

type QontinuiDialogContentProps = React.ComponentProps<typeof DialogContent>;

export function QontinuiDialogContent({
  className,
  ...props
}: QontinuiDialogContentProps) {
  return (
    <DialogContent
      className={cn("bg-surface-raised border border-border-default rounded-lg", className)}
      {...props}
    />
  );
}

export function QontinuiDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogOverlay>) {
  return (
    <DialogOverlay className={cn("bg-black/80", className)} {...props} />
  );
}

export function QontinuiDialogHeader({
  className,
  ...props
}: React.ComponentProps<typeof DialogHeader>) {
  return <DialogHeader className={className} {...props} />;
}

export function QontinuiDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogTitle>) {
  return (
    <DialogTitle className={cn("text-foreground", className)} {...props} />
  );
}

export function QontinuiDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogDescription>) {
  return (
    <DialogDescription
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
}

export function QontinuiDialogFooter({
  className,
  ...props
}: React.ComponentProps<typeof DialogFooter>) {
  return <DialogFooter className={className} {...props} />;
}

// Re-export base components that don't need theming
export { Dialog, DialogTrigger, DialogClose, DialogPortal };
