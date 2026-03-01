"use client";

import React from "react";
import { DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Save, X } from "lucide-react";

interface MaskEditorHeaderProps {
  imageName: string;
  cropToMask: boolean;
  onCropToMaskChange: (value: boolean) => void;
  onSave: () => void;
  onClose: () => void;
}

export const MaskEditorHeader: React.FC<MaskEditorHeaderProps> = ({
  imageName,
  cropToMask,
  onCropToMaskChange,
  onSave,
  onClose,
}) => {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-border-subtle shrink-0">
      <DialogTitle className="text-lg font-semibold">
        Mask Editor - {imageName}
      </DialogTitle>
      <DialogDescription className="sr-only">
        Edit mask by painting transparent areas with brush and revealing areas
        with eraser
      </DialogDescription>
      <div className="flex items-center gap-3 mr-8">
        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={cropToMask}
            onChange={(e) => onCropToMaskChange(e.target.checked)}
            className="w-4 h-4 rounded border-border-default bg-surface-raised text-brand-secondary focus:ring-brand-secondary focus:ring-offset-0"
          />
          <span>Crop to mask</span>
        </label>
        <Button
          onClick={onSave}
          size="sm"
          className="bg-brand-secondary hover:bg-brand-secondary/80 text-white"
        >
          <Save className="w-4 h-4 mr-2" />
          Save
        </Button>
        <Button
          onClick={onClose}
          size="sm"
          variant="outline"
          className="border-border-default hover:border-border-subtle"
        >
          <X className="w-4 h-4 mr-2" />
          Cancel
        </Button>
      </div>
    </div>
  );
};
