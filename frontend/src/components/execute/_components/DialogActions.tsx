"use client";

import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";

interface DialogActionsProps {
  isEditing: boolean;
  isSaving: boolean;
  canSave: boolean;
  onCancel: () => void;
  onSave: () => void;
}

export function DialogActions({
  isEditing,
  isSaving,
  canSave,
  onCancel,
  onSave,
}: DialogActionsProps) {
  return (
    <div className="flex gap-2 justify-end pt-2 border-t border-border-subtle/30">
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
