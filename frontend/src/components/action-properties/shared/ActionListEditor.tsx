"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, X, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface ActionListEditorProps {
  /** Current list of action IDs */
  actionIds: string[];

  /** Called when the action list changes */
  onChange: (actionIds: string[]) => void;

  /** Optional label text */
  label?: string;

  /** Optional placeholder for empty list */
  emptyText?: string;

  /** Optional class name */
  className?: string;

  /** Whether the list is required */
  required?: boolean;

  /** Minimum number of actions allowed */
  minActions?: number;

  /** Maximum number of actions allowed */
  maxActions?: number;
}

interface SortableActionItemProps {
  actionId: string;
  index: number;
  canRemove: boolean;
  onUpdate: (value: string) => void;
  onRemove: () => void;
}

/**
 * Individual sortable action item component.
 */
function SortableActionItem({
  actionId,
  index,
  canRemove,
  onUpdate,
  onRemove,
}: SortableActionItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `action-${index}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 p-2 bg-surface-raised/50 border border-border-default rounded-md group hover:border-border-subtle transition-colors",
        isDragging && "opacity-50 cursor-grabbing"
      )}
    >
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-text-muted group-hover:text-text-muted touch-none"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </div>

      {/* Action ID Input */}
      <Input
        type="text"
        value={actionId}
        onChange={(e) => onUpdate(e.target.value)}
        placeholder="action-id"
        className="flex-1 bg-transparent border-0 focus-visible:ring-0 font-mono text-sm"
      />

      {/* Remove Button */}
      {canRemove && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-text-muted hover:text-red-400 hover:bg-red-400/10"
          onClick={onRemove}
          title="Remove action"
        >
          <X className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}

/**
 * ActionListEditor component - provides UI for editing lists of action IDs.
 *
 * Features:
 * - Add/remove action IDs
 * - Drag-and-drop reordering with accessibility support
 * - Validation for required lists
 * - Visual feedback during drag operations
 * - Clean, consistent styling
 */
export function ActionListEditor({
  actionIds,
  onChange,
  label,
  emptyText = "No actions added",
  className,
  required = false,
  minActions,
  maxActions,
}: ActionListEditorProps) {
  const [newActionId, setNewActionId] = React.useState("");
  const [activeId, setActiveId] = React.useState<string | null>(null);

  // Configure sensors for drag-and-drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleAdd = () => {
    if (!newActionId.trim()) return;
    onChange([...actionIds, newActionId.trim()]);
    setNewActionId("");
  };

  const handleRemove = (index: number) => {
    const updated = actionIds.filter((_, i) => i !== index);
    onChange(updated);
  };

  const handleUpdate = (index: number, value: string) => {
    const updated = [...actionIds];
    updated[index] = value;
    onChange(updated);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = parseInt(active.id.toString().replace("action-", ""));
      const newIndex = parseInt(over.id.toString().replace("action-", ""));

      const reordered = arrayMove(actionIds, oldIndex, newIndex);
      onChange(reordered);
    }

    setActiveId(null);
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  const canAdd = !maxActions || actionIds.length < maxActions;
  const canRemove = !minActions || actionIds.length > minActions;

  // Get the active item for the drag overlay
  const activeIndex = activeId ? parseInt(activeId.replace("action-", "")) : -1;
  const activeItem = activeIndex >= 0 ? actionIds[activeIndex] : null;

  return (
    <div className={cn("space-y-3", className)}>
      {label && (
        <Label className="text-xs text-text-muted">
          {label}
          {required && <span className="text-red-400 ml-1">*</span>}
        </Label>
      )}

      {/* Action List with Drag and Drop */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="space-y-2">
          {actionIds.length === 0 ? (
            <div className="p-4 border border-dashed border-border-subtle rounded-md text-center">
              <p className="text-sm text-text-muted">{emptyText}</p>
            </div>
          ) : (
            <SortableContext
              items={actionIds.map((_, index) => `action-${index}`)}
              strategy={verticalListSortingStrategy}
            >
              {actionIds.map((actionId, index) => (
                <SortableActionItem
                  key={`action-${index}`}
                  actionId={actionId}
                  index={index}
                  canRemove={canRemove}
                  onUpdate={(value) => handleUpdate(index, value)}
                  onRemove={() => handleRemove(index)}
                />
              ))}
            </SortableContext>
          )}
        </div>

        {/* Drag Overlay - shows a copy of the item being dragged */}
        <DragOverlay>
          {activeItem ? (
            <div className="flex items-center gap-2 p-2 bg-surface-raised border border-brand-primary rounded-md shadow-lg shadow-brand-primary/20">
              <div className="text-brand-primary">
                <GripVertical className="w-4 h-4" />
              </div>
              <div className="flex-1 font-mono text-sm text-text-default">
                {activeItem}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Add Action Input */}
      {canAdd && (
        <div className="flex gap-2">
          <Input
            type="text"
            value={newActionId}
            onChange={(e) => setNewActionId(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Enter action ID to add"
            className="flex-1 bg-transparent border-border-default font-mono text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleAdd}
            disabled={!newActionId.trim()}
            className="border-border-default hover:bg-brand-primary/10 hover:text-brand-primary hover:border-brand-primary"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add
          </Button>
        </div>
      )}

      {/* Validation Messages */}
      {minActions && actionIds.length < minActions && (
        <p className="text-xs text-yellow-400">
          Minimum {minActions} action{minActions > 1 ? "s" : ""} required
        </p>
      )}
      {maxActions && actionIds.length >= maxActions && (
        <p className="text-xs text-text-muted">
          Maximum {maxActions} action{maxActions > 1 ? "s" : ""} reached
        </p>
      )}
    </div>
  );
}
