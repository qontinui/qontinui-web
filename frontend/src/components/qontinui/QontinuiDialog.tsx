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
import { styles } from "@/config/theme";

/**
 * Qontinui-themed dialog components
 * Extends the base Dialog component with dark theme styling
 */

interface QontinuiDialogContentProps extends React.ComponentProps<
  typeof DialogContent
> {}

export function QontinuiDialogContent({
  className,
  ...props
}: QontinuiDialogContentProps) {
  return <DialogContent className={cn(styles.dialog, className)} {...props} />;
}

export function QontinuiDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogOverlay>) {
  return (
    <DialogOverlay className={cn(styles.dialogOverlay, className)} {...props} />
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
    <DialogTitle className={cn(styles.text.primary, className)} {...props} />
  );
}

export function QontinuiDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogDescription>) {
  return (
    <DialogDescription
      className={cn(styles.text.secondary, className)}
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

// Re-export base components that don&apos;t need theming
export { Dialog, DialogTrigger, DialogClose, DialogPortal };

/**
 * Example usage:
 *
 * <Dialog>
 *   <DialogTrigger asChild>
 *     <Button>Open Dialog</Button>
 *   </DialogTrigger>
 *   <QontinuiDialogContent>
 *     <QontinuiDialogHeader>
 *       <QontinuiDialogTitle>Dialog Title</QontinuiDialogTitle>
 *       <QontinuiDialogDescription>
 *         Dialog description goes here
 *       </QontinuiDialogDescription>
 *     </QontinuiDialogHeader>
 *     <div className="py-4">
 *       Dialog content
 *     </div>
 *     <QontinuiDialogFooter>
 *       <DialogClose asChild>
 *         <GhostButton>Cancel</GhostButton>
 *       </DialogClose>
 *       <CreateButton>Confirm</CreateButton>
 *     </QontinuiDialogFooter>
 *   </QontinuiDialogContent>
 * </Dialog>
 */
