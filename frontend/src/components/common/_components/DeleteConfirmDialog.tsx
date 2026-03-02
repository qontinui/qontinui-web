"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";

export interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
  itemNames?: string[];
  count?: number;
  isDeleting?: boolean;
  confirmLabel?: string;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title = "Delete Item",
  description,
  itemNames,
  count,
  isDeleting = false,
  confirmLabel,
}: DeleteConfirmDialogProps) {
  const total = count ?? itemNames?.length ?? 1;
  const isBatch = total > 1;

  const defaultDescription = isBatch
    ? `Are you sure you want to delete ${total} items? This action cannot be undone.`
    : itemNames?.[0]
      ? `Are you sure you want to delete "${itemNames[0]}"? This action cannot be undone.`
      : "Are you sure? This action cannot be undone.";

  const resolvedDescription = description ?? defaultDescription;
  const resolvedConfirmLabel =
    confirmLabel ?? (isBatch ? `Delete (${total})` : "Delete");

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-surface-raised border-border-subtle">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-text-primary">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-text-muted">
            {resolvedDescription}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {itemNames && itemNames.length > 1 && (
          <ScrollArea className="max-h-[200px] rounded-md border border-border-default p-2">
            <ul className="space-y-1">
              {itemNames.map((name, index) => (
                <li
                  key={index}
                  className="text-sm text-text-secondary truncate"
                  title={name}
                >
                  {name}
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel
            className="border-border-subtle text-text-secondary"
            disabled={isDeleting}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-red-600 hover:bg-red-700 text-white"
            disabled={isDeleting}
          >
            {isDeleting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {resolvedConfirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
