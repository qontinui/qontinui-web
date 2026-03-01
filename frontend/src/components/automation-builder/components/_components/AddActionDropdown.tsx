/**
 * AddActionDropdown - Grouped dropdown menu for adding actions
 *
 * Renders the hierarchical dropdown (group > action type) used in both
 * the header "Add Action" button and the inline insert buttons.
 */

"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { ACTION_GROUPS } from "../sequential-editor-utils";
import type { Action } from "@/lib/action-schema/action-types";

interface AddActionDropdownProps {
  /** The trigger element rendered inside DropdownMenuTrigger */
  trigger: React.ReactNode;
  /** Called when an action type is selected */
  onAddAction: (
    type: Action["type"],
    insertAfterIndex?: number,
    preset?: string
  ) => void;
  /** Optional index to insert after (for inline insert buttons) */
  insertAfterIndex?: number;
  /** Controlled open state */
  open?: boolean;
  /** Called when open state changes */
  onOpenChange?: (open: boolean) => void;
}

export function AddActionDropdown({
  trigger,
  onAddAction,
  insertAfterIndex,
  open,
  onOpenChange,
}: AddActionDropdownProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent className="bg-surface-raised border-border-default">
        {Object.entries(ACTION_GROUPS).map(([groupName, groupActions]) => (
          <DropdownMenuSub key={groupName}>
            <DropdownMenuSubTrigger className="hover:bg-surface-raised focus:bg-surface-raised">
              {groupName}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="bg-surface-raised border-border-default">
              {groupActions.map((actionTemplate) => (
                <DropdownMenuItem
                  key={`${actionTemplate.type}-${"preset" in actionTemplate ? actionTemplate.preset : "default"}`}
                  onClick={() =>
                    onAddAction(
                      actionTemplate.type as Action["type"],
                      insertAfterIndex,
                      "preset" in actionTemplate
                        ? actionTemplate.preset
                        : undefined
                    )
                  }
                  className="hover:bg-surface-raised focus:bg-surface-raised"
                >
                  {actionTemplate.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
