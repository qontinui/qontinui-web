/**
 * Quick Edit Popover Component
 *
 * Provides inline quick editing of most important properties:
 * - Opens on node double-click
 * - Shows key properties for each action type
 * - Save on Enter, cancel on Escape
 * - Auto-closes on blur
 */

"use client";

import React, { useEffect, useRef } from "react";
import { usePropertyAdapter } from "./property-adapter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Check, X } from "lucide-react";

export interface QuickEditPopoverProps {
  actionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: React.ReactNode;
  position?: { x: number; y: number };
}

export const QuickEditPopover: React.FC<QuickEditPopoverProps> = ({
  actionId,
  open,
  onOpenChange,
  trigger,
  position,
}) => {
  const {
    action,
    updateConfig,
    saveChanges,
    discardChanges,
    hasUnsavedChanges,
  } = usePropertyAdapter(actionId);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      // Focus first input when opened
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSave = () => {
    saveChanges();
    onOpenChange(false);
  };

  const handleCancel = () => {
    discardChanges();
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  if (!action) return null;

  // Render appropriate quick edit fields based on action type
  const renderQuickEditFields = () => {
    switch (action.type as string) {
      case "CLICK":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Target</Label>
              <Input
                ref={inputRef}
                value={
                  (action.config as Record<string, string | number>).target ||
                  ""
                }
                onChange={(e) => updateConfig("target", e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 text-sm"
                placeholder="Click target..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Number of Clicks</Label>
              <Input
                type="number"
                value={
                  (action.config as Record<string, string | number>)
                    .numberOfClicks || 1
                }
                onChange={(e) =>
                  updateConfig("numberOfClicks", Number(e.target.value))
                }
                onKeyDown={handleKeyDown}
                className="h-8 text-sm"
                min="1"
              />
            </div>
          </div>
        );

      case "TYPE":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Text to Type</Label>
              <Input
                ref={inputRef}
                value={
                  (action.config as Record<string, string | number>).text || ""
                }
                onChange={(e) => updateConfig("text", e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 text-sm"
                placeholder="Enter text..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Delay (ms)</Label>
              <Input
                type="number"
                value={
                  (action.config as Record<string, string | number>).delay || 0
                }
                onChange={(e) => updateConfig("delay", Number(e.target.value))}
                onKeyDown={handleKeyDown}
                className="h-8 text-sm"
                min="0"
              />
            </div>
          </div>
        );

      case "IF":
        return (
          <div className="space-y-1.5">
            <Label className="text-xs">Condition</Label>
            <Input
              ref={inputRef}
              value={
                (action.config as Record<string, string | number>).condition ||
                ""
              }
              onChange={(e) => updateConfig("condition", e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 text-sm"
              placeholder="Enter condition..."
            />
          </div>
        );

      case "SET_VARIABLE":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Variable Name</Label>
              <Input
                ref={inputRef}
                value={
                  (action.config as Record<string, string | number>)
                    .variableName || ""
                }
                onChange={(e) => updateConfig("variableName", e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 text-sm font-mono"
                placeholder="variableName"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Value</Label>
              <Input
                value={
                  (action.config as Record<string, string | number>).value || ""
                }
                onChange={(e) => updateConfig("value", e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 text-sm"
                placeholder="Value..."
              />
            </div>
          </div>
        );

      case "LOOP":
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Loop Type</Label>
              <Input
                ref={inputRef}
                value={
                  (action.config as Record<string, string | number>).loopType ||
                  "count"
                }
                onChange={(e) => updateConfig("loopType", e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 text-sm"
              />
            </div>
            {(action.config as Record<string, string | number>).loopType ===
              "count" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Count</Label>
                <Input
                  type="number"
                  value={
                    (action.config as Record<string, string | number>).count ||
                    1
                  }
                  onChange={(e) =>
                    updateConfig("count", Number(e.target.value))
                  }
                  onKeyDown={handleKeyDown}
                  className="h-8 text-sm"
                  min="1"
                />
              </div>
            )}
          </div>
        );

      default:
        return (
          <div className="text-xs text-text-muted">
            Quick edit not available for {action.type}. Use the full properties
            panel.
          </div>
        );
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {trigger && <PopoverTrigger asChild>{trigger}</PopoverTrigger>}
      <PopoverContent
        className="w-80 bg-surface-canvas border-border-default"
        side="right"
        align="start"
        {...(position && {
          style: {
            position: "fixed",
            top: position.y,
            left: position.x,
          } as React.CSSProperties,
        })}
      >
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-text-secondary">
                Quick Edit
              </h4>
              <Badge variant="secondary" className="text-xs mt-1">
                {action.type}
              </Badge>
            </div>
            {hasUnsavedChanges && (
              <div
                className="w-2 h-2 rounded-full bg-yellow-400"
                title="Unsaved changes"
              />
            )}
          </div>

          {/* Quick edit fields */}
          <div className="py-2">{renderQuickEditFields()}</div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border-default">
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancel}
              className="h-7 text-xs"
            >
              <X className="w-3 h-3 mr-1" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
            >
              <Check className="w-3 h-3 mr-1" />
              Save
            </Button>
          </div>

          {/* Keyboard shortcuts hint */}
          <div className="text-xs text-text-muted text-center pt-1 border-t border-border-subtle">
            Press{" "}
            <kbd className="px-1 py-0.5 bg-surface-raised rounded">Enter</kbd>{" "}
            to save,{" "}
            <kbd className="px-1 py-0.5 bg-surface-raised rounded">Esc</kbd> to
            cancel
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
