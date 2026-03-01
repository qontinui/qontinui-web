/**
 * Color Picker Component
 *
 * Grid of predefined colors for folder customization.
 */

import React from "react";
import { X } from "lucide-react";
import { Button } from "../../ui/button";
import { FOLDER_COLORS } from "../folder-tree-utils";
import { cn } from "../../../lib/utils";

export interface ColorPickerProps {
  currentColor?: string;
  onColorSelect: (color: string) => void;
  onClose: () => void;
}

export function ColorPicker({
  currentColor,
  onColorSelect,
  onClose,
}: ColorPickerProps) {
  return (
    <div className="p-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">Choose Color</span>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {FOLDER_COLORS.map((color) => (
          <button
            key={color}
            className={cn(
              "w-8 h-8 rounded-md border-2 transition-all hover:scale-110",
              currentColor === color
                ? "border-foreground"
                : "border-transparent"
            )}
            style={{ backgroundColor: color }}
            onClick={() => {
              onColorSelect(color);
              onClose();
            }}
            aria-label={`Select color ${color}`}
          />
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full mt-2"
        onClick={() => {
          onColorSelect("");
          onClose();
        }}
      >
        Reset to Default
      </Button>
    </div>
  );
}
