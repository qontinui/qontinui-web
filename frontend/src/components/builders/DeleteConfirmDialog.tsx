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

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title?: string;
  itemNames?: string[];
  count?: number;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title = "Delete Item",
  itemNames,
  count,
}: DeleteConfirmDialogProps) {
  const total = count ?? itemNames?.length ?? 1;
  const isBatch = total > 1;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-surface-raised border-border-subtle">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-text-primary">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-text-muted">
            {isBatch ? (
              <>
                Are you sure you want to delete{" "}
                <span className="font-semibold text-text-secondary">
                  {total} items
                </span>
                ? This action cannot be undone.
              </>
            ) : (
              <>
                Are you sure you want to delete
                {itemNames?.[0] && (
                  <>
                    {" "}
                    <span className="font-semibold text-text-secondary">
                      {itemNames[0]}
                    </span>
                  </>
                )}
                ? This action cannot be undone.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-border-subtle text-text-secondary">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            Delete{isBatch ? ` (${total})` : ""}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
