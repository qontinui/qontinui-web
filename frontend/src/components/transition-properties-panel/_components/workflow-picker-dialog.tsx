"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Workflow } from "@/lib/action-schema/action-types";

interface WorkflowPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryFilter: string;
  onCategoryFilterChange: (value: string) => void;
  categories: string[];
  availableWorkflows: Workflow[];
  onAddWorkflow: (workflowId: string) => void;
}

export function WorkflowPickerDialog({
  open,
  onOpenChange,
  categoryFilter,
  onCategoryFilterChange,
  categories,
  availableWorkflows,
  onAddWorkflow,
}: WorkflowPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-text-muted hover:text-text-secondary"
          onClick={() => onOpenChange(true)}
        >
          <Plus className="w-3 h-3" />
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-surface-raised border-border-default max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-brand-primary">
            Add Workflow to Execute
          </DialogTitle>
          <DialogDescription className="text-text-muted text-sm">
            Select workflows to execute when this transition occurs
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Filter by Category</Label>
          <Select value={categoryFilter} onValueChange={onCategoryFilterChange}>
            <SelectTrigger className="bg-transparent border-border-default">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-surface-raised border-border-default">
              <SelectItem value="All">All Categories</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 max-h-96 overflow-y-auto">
          {availableWorkflows.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-4">
              {categoryFilter === "Transitions"
                ? "No workflows in Transitions category. Try 'All Categories' to see all workflows."
                : "No available workflows"}
            </p>
          ) : (
            availableWorkflows.map((workflow) => (
              <Button
                key={workflow.id}
                variant="outline"
                className="w-full justify-start bg-transparent border-border-default hover:border-brand-primary hover:text-brand-primary"
                onClick={() => onAddWorkflow(workflow.id)}
              >
                <div className="flex flex-col items-start gap-1 w-full">
                  <div className="flex items-center gap-2">
                    <span>{workflow.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {workflow.category || "Main"}
                    </Badge>
                  </div>
                  {workflow.description && (
                    <span className="text-xs text-text-muted">
                      {workflow.description}
                    </span>
                  )}
                </div>
              </Button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
