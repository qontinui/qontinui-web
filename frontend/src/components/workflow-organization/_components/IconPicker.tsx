/**
 * Icon Picker Component
 *
 * Grid of predefined icons for folder customization.
 */

import React from "react";
import { Folder, X } from "lucide-react";
import { Button } from "../../ui/button";
import { FOLDER_ICONS } from "../folder-tree-utils";
import { cn } from "../../../lib/utils";

export interface IconPickerProps {
  currentIcon?: string;
  onIconSelect: (icon: string) => void;
  onClose: () => void;
}

export function IconPicker({
  currentIcon,
  onIconSelect,
  onClose,
}: IconPickerProps) {
  // Simplified icon picker - in a real app, you'd import all the icons
  const icons = FOLDER_ICONS;

  return (
    <div className="p-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">Choose Icon</span>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-5 gap-2 max-h-48 overflow-y-auto">
        {icons.map((icon) => (
          <button
            key={icon}
            className={cn(
              "w-8 h-8 rounded-md border-2 flex items-center justify-center transition-all hover:bg-accent",
              currentIcon === icon ? "border-foreground" : "border-transparent"
            )}
            onClick={() => {
              onIconSelect(icon);
              onClose();
            }}
            aria-label={`Select icon ${icon}`}
          >
            <Folder className="h-4 w-4" />
          </button>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full mt-2"
        onClick={() => {
          onIconSelect("");
          onClose();
        }}
      >
        Reset to Default
      </Button>
    </div>
  );
}
