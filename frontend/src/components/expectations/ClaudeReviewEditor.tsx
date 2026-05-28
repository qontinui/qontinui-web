"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Eye } from "lucide-react";

export interface ClaudeReviewEditorProps {
  notes: string[];
  onChange: (notes: string[]) => void;
}

/**
 * Editor for Claude review notes
 *
 * Allows adding/editing/removing notes that describe what Claude should
 * visually verify in screenshots at this checkpoint.
 *
 * Examples:
 * - "Check that runner names are unique"
 * - "Verify no error banners visible"
 * - "Confirm all buttons are properly labeled"
 */
export function ClaudeReviewEditor({
  notes,
  onChange,
}: ClaudeReviewEditorProps) {
  const addNote = () => {
    onChange([...notes, ""]);
  };

  const updateNote = (index: number, value: string) => {
    const updated = [...notes];
    updated[index] = value;
    onChange(updated);
  };

  const deleteNote = (index: number) => {
    const updated = notes.filter((_, i) => i !== index);
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-brand-secondary" />
          <Label className="text-sm text-text-secondary">
            Claude Review Notes
          </Label>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={addNote}
          className="h-7 text-xs text-brand-primary hover:text-brand-primary/80 hover:bg-brand-primary/10"
        >
          <Plus className="w-3 h-3 mr-1" />
          Add Note
        </Button>
      </div>

      {notes.length === 0 ? (
        <div className="p-4 bg-surface-raised/30 border border-border-default rounded-md">
          <p className="text-sm text-text-muted text-center">
            No Claude review notes defined
          </p>
          <p className="text-xs text-text-muted text-center mt-1">
            Add notes describing what Claude should visually verify
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((note, index) => (
            <div key={index} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-text-muted">
                  Note {index + 1}
                </Label>
                <DestructiveButton
                  size="sm"
                  onClick={() => deleteNote(index)}
                  className="h-6 w-6 p-0 text-text-muted hover:text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="w-3 h-3" />
                </DestructiveButton>
              </div>
              <Textarea
                value={note}
                onChange={(e) => updateNote(index, e.target.value)}
                placeholder="Describe what Claude should look for..."
                className="bg-transparent border-border-default min-h-[80px] resize-none"
                rows={3}
              />
            </div>
          ))}
        </div>
      )}

      {/* Helper Text */}
      <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-md">
        <p className="text-xs text-purple-300 font-medium mb-1">
          Claude Review Guidelines:
        </p>
        <ul className="text-xs text-purple-400/70 space-y-1 list-disc list-inside">
          <li>Be specific about what to verify</li>
          <li>Mention expected UI elements or states</li>
          <li>Note any elements that should NOT be present</li>
          <li>Include layout or positioning requirements if relevant</li>
        </ul>
      </div>

      {/* Example Notes */}
      {notes.length === 0 && (
        <div className="p-3 bg-surface-raised/30 border border-border-default rounded-md">
          <p className="text-xs text-text-muted font-medium mb-2">
            Example notes:
          </p>
          <ul className="text-xs text-text-muted space-y-1">
            <li className="pl-2 border-l-2 border-border-default">
              Check that runner names are unique
            </li>
            <li className="pl-2 border-l-2 border-border-default">
              Verify no error banners visible
            </li>
            <li className="pl-2 border-l-2 border-border-default">
              Confirm all buttons are properly labeled
            </li>
            <li className="pl-2 border-l-2 border-border-default">
              Ensure navigation menu is displayed correctly
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
