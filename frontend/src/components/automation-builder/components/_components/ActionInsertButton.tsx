/**
 * ActionInsertButton - Inline insert button between actions
 *
 * Shows a subtle "+" button on hover between action cards, with a divider line.
 * Clicking opens the AddActionDropdown to insert an action at that position.
 */

"use client";

import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { AddActionDropdown } from "./AddActionDropdown";
import type { Action } from "@/lib/action-schema/action-types";

interface ActionInsertButtonProps {
  /** Index to insert after */
  insertAfterIndex: number;
  /** Whether this insert button's dropdown is currently open */
  isOpen: boolean;
  /** Called when the dropdown open state changes */
  onOpenChange: (open: boolean) => void;
  /** Called when an action type is selected */
  onAddAction: (
    type: Action["type"],
    insertAfterIndex?: number,
    preset?: string
  ) => void;
}

export function ActionInsertButton({
  insertAfterIndex,
  isOpen,
  onOpenChange,
  onAddAction,
}: ActionInsertButtonProps) {
  return (
    <div className="relative h-4 group">
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        <AddActionDropdown
          open={isOpen}
          onOpenChange={onOpenChange}
          insertAfterIndex={insertAfterIndex}
          onAddAction={onAddAction}
          trigger={
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-8 p-0 text-text-muted hover:text-brand-secondary hover:bg-brand-secondary/10 rounded"
              onClick={(e) => e.stopPropagation()}
            >
              <Plus className="w-3 h-3" />
            </Button>
          }
        />
      </div>
      <div className="absolute inset-0 flex items-center pointer-events-none">
        <div className="w-full border-t border-border-subtle" />
      </div>
    </div>
  );
}
