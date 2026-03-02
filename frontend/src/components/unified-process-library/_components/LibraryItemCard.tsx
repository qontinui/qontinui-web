"use client";

import { DragEvent } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Trash2,
  List,
  Workflow as WorkflowIcon,
  ArrowRightLeft,
} from "lucide-react";
import type { LibraryItem } from "../types";
import { getItemName, getItemActionCount, isLinearWorkflow } from "../utils";

interface LibraryItemCardProps {
  item: LibraryItem;
  isSelected: boolean;
  isDraggedItem: boolean;
  isSelectionMode: boolean;
  isChecked: boolean;
  onSelect: (item: LibraryItem) => void;
  onToggleSelection: (itemId: string) => void;
  onDelete: (item: LibraryItem) => void;
  onConvertItem?: (item: LibraryItem) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, item: LibraryItem) => void;
  onDragEnd: () => void;
}

export function LibraryItemCard({
  item,
  isSelected,
  isDraggedItem,
  isSelectionMode,
  isChecked,
  onSelect,
  onToggleSelection,
  onDelete,
  onConvertItem,
  onDragStart,
  onDragEnd,
}: LibraryItemCardProps) {
  const isLinear = isLinearWorkflow(item);
  const isDraggable = !isSelectionMode;

  return (
    <Card
      key={item.id}
      draggable={isDraggable}
      onDragStart={(e) => onDragStart(e, item)}
      onDragEnd={onDragEnd}
      className={`cursor-pointer transition-all hover:border-brand-primary/50 !py-0 !gap-0 ${
        isSelectionMode && isChecked
          ? "border-red-500 bg-red-500/10"
          : isSelected
            ? isLinear
              ? "border-brand-primary bg-brand-primary/10"
              : "border-brand-success bg-brand-success/10"
            : "border-border-default bg-surface-raised"
      } ${isDraggedItem ? "opacity-50" : ""}`}
      onClick={() => {
        if (isSelectionMode) {
          onToggleSelection(item.id);
        } else {
          onSelect(item);
        }
      }}
    >
      <CardContent className="py-1 px-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {isSelectionMode && (
              <Checkbox
                checked={isChecked}
                onCheckedChange={() => onToggleSelection(item.id)}
                onClick={(e) => e.stopPropagation()}
                className="h-3.5 w-3.5 flex-shrink-0 border-border-default data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
              />
            )}
            {isLinear ? (
              <List className="w-3 h-3 text-brand-primary flex-shrink-0" />
            ) : (
              <WorkflowIcon className="w-3 h-3 text-brand-success flex-shrink-0" />
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <h4 className="font-medium text-xs truncate">
                  {getItemName(item)}
                </h4>
              </TooltipTrigger>
              <TooltipContent>
                <p>{getItemName(item)}</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-1 ml-2">
            <Badge
              variant="secondary"
              className={`text-[10px] h-4 px-1 ${
                !isLinear ? "bg-brand-success/20 text-brand-success" : ""
              }`}
            >
              {getItemActionCount(item)}
            </Badge>
            {!isSelectionMode && onConvertItem && (
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 text-text-muted hover:text-brand-success"
                onClick={(e) => {
                  e.stopPropagation();
                  onConvertItem(item);
                }}
                title={!isLinear ? "View as sequential" : "View as graph"}
              >
                <ArrowRightLeft className="w-2.5 h-2.5" />
              </Button>
            )}
            {!isSelectionMode && (
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 text-text-muted hover:text-red-400"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(item);
                }}
              >
                <Trash2 className="w-2.5 h-2.5" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
