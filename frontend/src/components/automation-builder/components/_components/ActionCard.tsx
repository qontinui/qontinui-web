/**
 * ActionCard - Individual action card in the timeline
 *
 * Renders a draggable card for a single action with its type badge,
 * summary text, and duplicate/delete action buttons.
 */

"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GripVertical, Trash2, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ACTION_TYPES, getActionSummary } from "../sequential-editor-utils";
import type { Action } from "@/lib/action-schema/action-types";
import type {
  StateType,
  WorkflowType,
  ImageType,
} from "../sequential-editor-types";

interface ActionCardProps {
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

export function ActionCard({
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
}: ActionCardProps) {
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
      <CardContent className="p-2 px-3">
        <div className="flex items-center gap-2">
          {/* Drag Handle & Number */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <GripVertical className="w-3.5 h-3.5 text-text-muted cursor-grab active:cursor-grabbing" />
            <Badge
              className={`${actionType?.color ?? "bg-surface-raised"} text-white text-xs px-1.5 py-0 h-5 min-w-[1.5rem] flex items-center justify-center`}
            >
              {index + 1}
            </Badge>
          </div>

          {/* Action Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-sm truncate">
                {actionType?.label ?? action.type}
              </span>
              {action.type !== "GO_TO_STATE" &&
                action.type !== "RUN_WORKFLOW" && (
                  <Badge variant="outline" className="text-xs px-1 py-0 h-4">
                    {action.type}
                  </Badge>
                )}
            </div>
            <div className="text-xs text-text-muted truncate">
              {getActionSummary(action, states, workflows, images)}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-text-muted hover:text-brand-primary hover:bg-brand-primary/10"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate(action);
              }}
              data-ui-id={`automation-sequential-action-${action.id}-duplicate-btn`}
            >
              <Copy className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-text-muted hover:text-red-400 hover:bg-red-400/10"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(action.id);
              }}
              data-ui-id={`automation-sequential-action-${action.id}-delete-btn`}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
