"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  CHECK_TYPES,
  CHECK_TYPE_BADGE_COLORS,
  getToolsForCheckType,
  getCheckDefaults,
  getCheckTypeInfo,
} from "../constants";

export interface CheckCreationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateCheck: (checkType: string, tool: string) => void;
}

export function CheckCreationDialog({ open, onOpenChange, onCreateCheck }: CheckCreationDialogProps) {
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const handleTypeSelect = (type: string) => {
    setSelectedType(type);
  };

  const handleToolSelect = (tool: string) => {
    if (!selectedType) return;
    onCreateCheck(selectedType, tool);
    setSelectedType(null);
    onOpenChange(false);
  };

  const handleBack = () => {
    setSelectedType(null);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setSelectedType(null);
    }
    onOpenChange(newOpen);
  };

  const tools = selectedType ? getToolsForCheckType(selectedType) : [];
  const typeInfo = selectedType ? getCheckTypeInfo(selectedType) : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {selectedType ? `Select Tool - ${typeInfo?.label}` : "New Check"}
          </DialogTitle>
          <DialogDescription>
            {selectedType
              ? "Choose a tool to get sensible defaults for your check."
              : "Select a check type to get started."}
          </DialogDescription>
        </DialogHeader>

        {!selectedType ? (
          /* Step 1: Select check type */
          <div className="grid grid-cols-2 gap-2 mt-2">
            {CHECK_TYPES.map((type) => {
              const colors = CHECK_TYPE_BADGE_COLORS[type.value];
              return (
                <button
                  key={type.value}
                  onClick={() => handleTypeSelect(type.value)}
                  className={`flex flex-col items-start gap-1.5 p-3 rounded-lg border transition-colors
                    border-border hover:border-text-muted bg-muted/50 hover:bg-muted
                    text-left`}
                >
                  <Badge
                    variant="secondary"
                    className={`text-[10px] px-1.5 ${colors?.bg ?? ""} ${colors?.text ?? ""} ${colors?.border ?? ""}`}
                  >
                    {type.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {type.tools.filter((t) => t !== "custom").join(", ") || "Custom command"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          /* Step 2: Select tool */
          <div className="space-y-2 mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground mb-1"
              onClick={handleBack}
            >
              &larr; Back to types
            </Button>
            <div className="grid gap-2">
              {tools.map((tool) => {
                const defaults = getCheckDefaults(selectedType, tool);
                return (
                  <button
                    key={tool}
                    onClick={() => handleToolSelect(tool)}
                    className="flex flex-col items-start gap-1 p-3 rounded-lg border transition-colors
                      border-border hover:border-text-muted bg-muted/50 hover:bg-muted
                      text-left"
                  >
                    <span className="text-sm font-medium text-foreground">{defaults.name}</span>
                    {defaults.command && (
                      <code className="text-[11px] text-muted-foreground font-mono truncate max-w-full">
                        {defaults.command}
                      </code>
                    )}
                    {defaults.description && (
                      <span className="text-xs text-muted-foreground">{defaults.description}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
