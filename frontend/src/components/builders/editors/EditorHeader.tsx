"use client";

import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Save, Trash2, Copy, Loader2 } from "lucide-react";

interface EditorHeaderProps {
  name: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  isSaving?: boolean;
  isDirty?: boolean;
  isNew?: boolean;
  nameplaceholder?: string;
  children?: React.ReactNode;
}

export function EditorHeader({
  name,
  onNameChange,
  onSave,
  onDelete,
  onDuplicate,
  isSaving = false,
  isDirty = false,
  isNew = false,
  nameplaceholder = "Item name...",
  children,
}: EditorHeaderProps) {
  return (
    <div className="flex items-center gap-3 p-4 border-b border-border-subtle/50 bg-surface-raised/30">
      <Input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={nameplaceholder}
        className="flex-1 h-9 text-sm font-medium bg-transparent border-border-subtle"
      />

      {isDirty && (
        <Badge
          variant="outline"
          className="text-[10px] text-amber-400 border-amber-400/30"
        >
          Unsaved
        </Badge>
      )}

      {isNew && (
        <Badge
          variant="outline"
          className="text-[10px] text-emerald-400 border-emerald-400/30"
        >
          New
        </Badge>
      )}

      {children}

      {onDuplicate && !isNew && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-text-muted hover:text-text-secondary"
          onClick={onDuplicate}
          title="Duplicate"
        >
          <Copy className="size-3.5" />
        </Button>
      )}

      {onDelete && !isNew && (
        <DestructiveButton
          size="sm"
          className="h-8 px-2 text-red-400 hover:text-red-300"
          onClick={onDelete}
          title="Delete"
        >
          <Trash2 className="size-3.5" />
        </DestructiveButton>
      )}

      <Button
        size="sm"
        className="h-8 gap-1.5"
        onClick={onSave}
        disabled={isSaving || !name.trim()}
      >
        {isSaving ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Save className="size-3.5" />
        )}
        {isNew ? "Create" : "Save"}
      </Button>
    </div>
  );
}
