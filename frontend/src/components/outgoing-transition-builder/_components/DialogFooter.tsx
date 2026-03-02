"use client";

import { Button } from "@/components/ui/button";

interface DialogFooterProps {
  onCancel: () => void;
  onCreate: () => void;
}

export function DialogFooter({ onCancel, onCreate }: DialogFooterProps) {
  return (
    <div className="flex justify-end gap-3 pt-4 border-t border-border-default mt-4">
      <Button
        variant="outline"
        onClick={onCancel}
        className="px-8 border-border-subtle"
      >
        Cancel
      </Button>
      <Button
        onClick={onCreate}
        className="px-8 bg-brand-success hover:bg-brand-success/80 text-black"
      >
        Create Outgoing Transition
      </Button>
    </div>
  );
}
