"use client";

import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  FindingCategoryConfig,
  FindingCategoryActionType,
} from "@/lib/api-client";
import {
  ICON_OPTIONS,
  COLOR_OPTIONS,
  ACTION_TYPE_OPTIONS,
  getColorClasses,
} from "../finding-rules-utils";
import { CategoryIcon } from "./CategoryIcon";

interface CategoryEditRowProps {
  cat: FindingCategoryConfig;
  editName: string;
  editDescription: string;
  editIcon: string;
  editColor: string;
  editActionType: FindingCategoryActionType;
  onEditNameChange: (value: string) => void;
  onEditDescriptionChange: (value: string) => void;
  onEditIconChange: (value: string) => void;
  onEditColorChange: (value: string) => void;
  onEditActionTypeChange: (value: FindingCategoryActionType) => void;
  onCancel: () => void;
  onSave: (cat: FindingCategoryConfig) => void;
}

export function CategoryEditRow({
  cat,
  editName,
  editDescription,
  editIcon,
  editColor,
  editActionType,
  onEditNameChange,
  onEditDescriptionChange,
  onEditIconChange,
  onEditColorChange,
  onEditActionTypeChange,
  onCancel,
  onSave,
}: CategoryEditRowProps) {
  return (
    <div className="p-4 rounded-lg border border-primary/30 bg-background/30 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input
          value={editName}
          onChange={(e) => onEditNameChange(e.target.value)}
          placeholder="Category name"
          className="bg-muted border-border text-white"
        />
        <Input
          value={editDescription}
          onChange={(e) => onEditDescriptionChange(e.target.value)}
          placeholder="Description"
          className="bg-muted border-border text-white"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Select value={editIcon} onValueChange={onEditIconChange}>
          <SelectTrigger className="bg-muted border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-muted border-border">
            {ICON_OPTIONS.map((icon) => (
              <SelectItem key={icon} value={icon}>
                <div className="flex items-center gap-2">
                  <CategoryIcon name={icon} className="w-4 h-4" />
                  {icon}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={editColor} onValueChange={onEditColorChange}>
          <SelectTrigger className="bg-muted border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-muted border-border">
            {COLOR_OPTIONS.map((color) => {
              const colCc = getColorClasses(color);
              return (
                <SelectItem key={color} value={color}>
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${colCc.bg} ${colCc.border} border`}
                    />
                    {color.charAt(0).toUpperCase() + color.slice(1)}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <Select
          value={editActionType}
          onValueChange={(v) =>
            onEditActionTypeChange(v as FindingCategoryActionType)
          }
        >
          <SelectTrigger className="bg-muted border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-muted border-border">
            {ACTION_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <div>
                  <span>{opt.label}</span>
                  <span className="text-muted-foreground text-[11px] ml-2">
                    {opt.description}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="text-muted-foreground hover:text-white"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => onSave(cat)}
          className="bg-primary hover:bg-primary/90 text-black"
        >
          <Save className="w-3.5 h-3.5 mr-1.5" />
          Save
        </Button>
      </div>
    </div>
  );
}
