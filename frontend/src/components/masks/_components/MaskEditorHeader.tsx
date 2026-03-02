import React from "react";
import { Button } from "../../ui/button";
import { Save } from "lucide-react";

interface MaskEditorHeaderProps {
  onSave: () => void;
  onCancel?: () => void;
}

export const MaskEditorHeader: React.FC<MaskEditorHeaderProps> = ({
  onSave,
  onCancel,
}) => {
  return (
    <div className="flex justify-between items-center mb-4">
      <h2 className="text-lg font-semibold">Mask Editor</h2>
      <div className="flex gap-2">
        <Button onClick={onSave} size="sm" variant="default">
          <Save className="w-4 h-4 mr-1" />
          Save
        </Button>
        {onCancel && (
          <Button onClick={onCancel} size="sm" variant="outline">
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
};
