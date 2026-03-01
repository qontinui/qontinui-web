"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Plus } from "lucide-react";
import type { Action } from "../action-editor-types";
import { ACTION_GROUPS } from "../action-editor-utils";

interface AddActionMenuProps {
  onAddAction: (type: Action["type"]) => void;
}

export function AddActionMenu({ onAddAction }: AddActionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="bg-brand-secondary hover:bg-brand-secondary/80 text-white">
          <Plus className="w-4 h-4 mr-2" />
          Add Action
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-surface-raised border-border-default">
        {Object.entries(ACTION_GROUPS).map(([groupName, actions]) => (
          <DropdownMenuSub key={groupName}>
            <DropdownMenuSubTrigger className="hover:bg-surface-raised-hover focus:bg-surface-raised-hover">
              {groupName}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="bg-surface-raised border-border-default">
              {actions.map(({ type, label }) => (
                <DropdownMenuItem
                  key={type}
                  onClick={() => onAddAction(type)}
                  className="hover:bg-surface-raised-hover focus:bg-surface-raised-hover"
                >
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
