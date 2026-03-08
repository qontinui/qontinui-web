import React from "react";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";

interface EditActionsProps {
  onSave: () => void;
  onCancel: () => void;
  saveDisabled: boolean;
}

export function EditActions({
  onSave,
  onCancel,
  saveDisabled,
}: EditActionsProps) {
  return (
    <div className="flex gap-2 mt-6">
      <Button
        onClick={onSave}
        disabled={saveDisabled}
        className="flex-1 bg-green-600 hover:bg-green-700 text-white"
      >
        <Check className="w-4 h-4 mr-2" />
        Save
      </Button>
      <Button
        onClick={onCancel}
        variant="outline"
        className="flex-1 border-border-default text-text-muted hover:bg-surface-raised"
      >
        <X className="w-4 h-4 mr-2" />
        Cancel
      </Button>
    </div>
  );
}
