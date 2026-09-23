"use client";

import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";

interface DialogActionsProps {
  isEditing: boolean;
  isSaving: boolean;
  canSave: boolean;
  /** Why saving is refused (coord's outcome), shown beside the actions. */
  refusal?: string | null;
  onCancel: () => void;
  onSave: () => void;
}

export function DialogActions({
  isEditing,
  isSaving,
  canSave,
  refusal = null,
  onCancel,
  onSave,
}: DialogActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 justify-end pt-2 border-t border-border-subtle/30">
      {refusal && (
        <p
          className="mr-auto text-xs text-text-muted"
          data-testid="schedule-save-refusal"
        >
          {refusal}
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={onCancel}
        disabled={isSaving}
      >
        Cancel
      </Button>
      <Button
        variant="brand-primary"
        size="sm"
        onClick={onSave}
        disabled={isSaving || !canSave}
      >
        {isSaving ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <Save className="size-4" />
            {isEditing ? "Update" : "Create"} Schedule
          </>
        )}
      </Button>
    </div>
  );
}
