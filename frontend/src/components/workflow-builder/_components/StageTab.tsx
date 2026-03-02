"use client";

import React, { useState } from "react";
import { ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface StageTabProps {
  name: string;
  index: number;
  isActive: boolean;
  stepCount: number;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

// ---------------------------------------------------------------------------
// StageTab
// ---------------------------------------------------------------------------

export function StageTab({
  name,
  index,
  isActive,
  stepCount,
  onSelect,
  onRename,
  onRemove,
  onMoveUp,
  onMoveDown,
}: StageTabProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`
            flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium
            transition-colors shrink-0
            ${
              isActive
                ? "bg-zinc-700 text-zinc-100 ring-1 ring-zinc-600"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
            }
          `}
          onClick={onSelect}
        >
          <span className="text-[10px] text-zinc-500">{index + 1}.</span>
          <span className="max-w-[120px] truncate">{name}</span>
          <Badge
            variant="secondary"
            className="h-4 px-1 text-[9px] bg-zinc-600/50"
          >
            {stepCount}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-48 p-1.5 bg-zinc-900 border-zinc-700"
        side="bottom"
        align="start"
      >
        <StageTabMenu
          name={name}
          onRename={onRename}
          onRemove={onRemove}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
        />
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// StageTabMenu (internal to StageTab)
// ---------------------------------------------------------------------------

function StageTabMenu({
  name,
  onRename,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  name: string;
  onRename: (name: string) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const [editName, setEditName] = useState(name);

  return (
    <div className="space-y-1">
      <Input
        value={editName}
        onChange={(e) => setEditName(e.target.value)}
        onBlur={() => {
          if (editName.trim() && editName !== name) onRename(editName.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && editName.trim()) {
            onRename(editName.trim());
          }
        }}
        className="h-7 text-xs bg-zinc-800 border-zinc-700"
        placeholder="Stage name"
      />
      <div className="flex gap-1">
        {onMoveUp && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs flex-1"
            onClick={onMoveUp}
          >
            <ChevronUp className="size-3" />
          </Button>
        )}
        {onMoveDown && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs flex-1"
            onClick={onMoveDown}
          >
            <ChevronDown className="size-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs text-red-400 hover:text-red-300 flex-1"
          onClick={onRemove}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </div>
  );
}
