"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GripVertical, Trash2, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type {
  Action,
  StateType,
  WorkflowType,
  ImageType,
} from "../action-editor-types";
import { ACTION_TYPES } from "../action-editor-utils";
import { ActionSummary } from "./action-summary";

interface ActionListItemProps {
  action: Action;
  index: number;
  isSelected: boolean;
  isDragged: boolean;
  states: StateType[];
  workflows: WorkflowType[];
  images: ImageType[];
  onSelect: (action: Action) => void;
  onDuplicate: (action: Action) => void;
  onDelete: (actionId: string) => void;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
}

export function ActionListItem({
  action,
  index,
  isSelected,
  isDragged,
  states,
  workflows,
  images,
  onSelect,
  onDuplicate,
  onDelete,
  onDragStart,
  onDragOver,
  onDragEnd,
}: ActionListItemProps) {
  const actionType = ACTION_TYPES.find((t) => t.type === action.type);

  return (
    <Card
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={onDragEnd}
      className={`cursor-move transition-all hover:border-brand-secondary/50 ${
        isSelected
          ? "border-brand-secondary bg-brand-secondary/10"
          : "border-border-default bg-surface-raised"
      } ${isDragged ? "opacity-50" : ""}`}
      onClick={() => onSelect(action)}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <GripVertical className="w-4 h-4 text-text-muted cursor-grab active:cursor-grabbing" />
            <Badge className={`${actionType?.color} text-white text-xs`}>
              {index + 1}
            </Badge>
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{actionType?.label}</span>
              {action.type !== "GO_TO_STATE" &&
                action.type !== "RUN_WORKFLOW" && (
                  <Badge variant="outline" className="text-xs">
                    {action.type}
                  </Badge>
                )}
            </div>
            <ActionSummary
              action={action}
              states={states}
              workflows={workflows}
              images={images}
            />
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-text-muted hover:text-brand-primary"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate(action);
              }}
            >
              <Copy className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-text-muted hover:text-red-400"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(action.id);
              }}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
