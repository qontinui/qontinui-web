"use client";

import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface EditableProjectNameProps {
  name: string;
  onSave: (newName: string) => Promise<void>;
  isSelected?: boolean;
  className?: string;
}

export function EditableProjectName({
  name,
  onSave,
  isSelected = false,
  className,
}: EditableProjectNameProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(name);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const [prevName, setPrevName] = useState(name);
  if (name !== prevName) {
    setPrevName(name);
    setEditedName(name);
  }

  const handleStartEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditedName(name);
    setIsEditing(false);
  };

  const handleSave = async (e: React.MouseEvent | React.FormEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const trimmedName = editedName.trim();
    if (!trimmedName) {
      setEditedName(name);
      setIsEditing(false);
      return;
    }

    if (trimmedName === name) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(trimmedName);
      setIsEditing(false);
    } catch {
      // Revert on error
      setEditedName(name);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave(e);
    } else if (e.key === "Escape") {
      setEditedName(name);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div
        className="flex items-center gap-1"
        role="group"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
      >
        <Input
          ref={inputRef}
          value={editedName}
          onChange={(e) => setEditedName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Small delay to allow button clicks to register
            setTimeout(() => {
              if (isEditing && !isSaving) {
                setEditedName(name);
                setIsEditing(false);
              }
            }, 150);
          }}
          className="h-7 py-0 px-2 text-lg font-semibold bg-surface-canvas border-brand-primary text-white"
          maxLength={255}
          disabled={isSaving}
          data-awas-action="update_project"
          data-awas-param-name={editedName}
        />
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="p-1 rounded hover:bg-green-500/20 text-green-400 transition-colors"
          title="Save"
          data-awas-action="update_project"
          data-awas-trigger="click"
        >
          <Check className="w-4 h-4" />
        </button>
        <button
          onClick={handleCancel}
          disabled={isSaving}
          className="p-1 rounded hover:bg-red-500/20 text-red-400 transition-colors"
          title="Cancel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 group/name min-w-0">
      <h4
        className={cn(
          "font-semibold text-lg transition-colors line-clamp-1",
          isSelected ? "text-brand-primary" : "group-hover:text-brand-primary",
          className
        )}
      >
        {name}
      </h4>
      <button
        onClick={handleStartEditing}
        className="p-1 rounded opacity-0 group-hover/name:opacity-100 hover:bg-surface-raised/50 text-text-muted hover:text-brand-primary transition-all"
        title="Edit name"
        data-awas-trigger="click"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
