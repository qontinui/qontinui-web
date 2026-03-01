"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { CONTEXT_CATEGORIES, countAutoIncludeRules } from "../context-utils";
import type { ContextFormData } from "../context-utils";

export interface ContextFormDialogProps {
  isEdit: boolean;
  formData: ContextFormData;
  setFormData: (data: ContextFormData) => void;
  showAutoIncludeSection: boolean;
  setShowAutoIncludeSection: (show: boolean) => void;
  onSave: () => void;
  onClose: () => void;
}

export function ContextFormDialog({
  isEdit,
  formData,
  setFormData,
  showAutoIncludeSection,
  setShowAutoIncludeSection,
  onSave,
  onClose,
}: ContextFormDialogProps) {
  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          {isEdit ? "Edit Context" : "Create New Context"}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Modify the context details and auto-include rules."
            : "Add a new context that can be injected into AI prompts."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            placeholder="e.g., Error Handling Guidelines"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="bg-transparent border-border-default focus:border-brand-primary"
          />
        </div>

        {/* Category */}
        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Select
            value={formData.category}
            onValueChange={(value) =>
              setFormData({
                ...formData,
                category: value === "none" ? "" : value,
              })
            }
          >
            <SelectTrigger className="bg-transparent border-border-default focus:border-brand-primary">
              <SelectValue placeholder="Select a category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No category</SelectItem>
              {CONTEXT_CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tags */}
        <div className="space-y-2">
          <Label htmlFor="tags">Tags (comma-separated)</Label>
          <Input
            id="tags"
            placeholder="e.g., react, typescript, best-practices"
            value={formData.tags}
            onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
            className="bg-transparent border-border-default focus:border-brand-primary"
          />
        </div>

        {/* Content */}
        <div className="space-y-2">
          <Label htmlFor="content">Content (Markdown)</Label>
          <Textarea
            id="content"
            placeholder="Enter the context content in Markdown format..."
            value={formData.content}
            onChange={(e) =>
              setFormData({ ...formData, content: e.target.value })
            }
            className="bg-transparent border-border-default focus:border-brand-primary min-h-[200px] font-mono text-sm"
          />
        </div>

        {/* Auto-Include Rules */}
        <Collapsible
          open={showAutoIncludeSection}
          onOpenChange={setShowAutoIncludeSection}
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="flex items-center gap-2 p-0 h-auto"
            >
              {showAutoIncludeSection ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              <Sparkles className="w-4 h-4 text-brand-primary" />
              <span>Auto-Include Rules</span>
              {!showAutoIncludeSection &&
                countAutoIncludeRules({
                  taskMentions: formData.taskMentions
                    .split(",")
                    .filter(Boolean) as string[],
                  actionTypes: formData.actionTypes
                    .split(",")
                    .filter(Boolean) as string[],
                  errorPatterns: formData.errorPatterns
                    .split(",")
                    .filter(Boolean) as string[],
                  filePatterns: formData.filePatterns
                    .split(",")
                    .filter(Boolean) as string[],
                }) > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {countAutoIncludeRules({
                      taskMentions: formData.taskMentions
                        .split(",")
                        .filter(Boolean) as string[],
                      actionTypes: formData.actionTypes
                        .split(",")
                        .filter(Boolean) as string[],
                      errorPatterns: formData.errorPatterns
                        .split(",")
                        .filter(Boolean) as string[],
                      filePatterns: formData.filePatterns
                        .split(",")
                        .filter(Boolean) as string[],
                    })}{" "}
                    rules
                  </Badge>
                )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            <p className="text-sm text-text-muted">
              Define rules for automatically including this context in AI
              prompts.
            </p>

            {/* Task Mentions */}
            <div className="space-y-2">
              <Label htmlFor="taskMentions" className="text-sm">
                Task Mentions (comma-separated keywords)
              </Label>
              <Input
                id="taskMentions"
                placeholder="e.g., error, debug, fix, troubleshoot"
                value={formData.taskMentions}
                onChange={(e) =>
                  setFormData({ ...formData, taskMentions: e.target.value })
                }
                className="bg-transparent border-border-default focus:border-brand-primary"
              />
              <p className="text-xs text-text-muted">
                Include when task prompt contains these keywords
                (case-insensitive)
              </p>
            </div>

            {/* Action Types */}
            <div className="space-y-2">
              <Label htmlFor="actionTypes" className="text-sm">
                Action Types (comma-separated)
              </Label>
              <Input
                id="actionTypes"
                placeholder="e.g., CLICK, FIND, TYPE"
                value={formData.actionTypes}
                onChange={(e) =>
                  setFormData({ ...formData, actionTypes: e.target.value })
                }
                className="bg-transparent border-border-default focus:border-brand-primary"
              />
              <p className="text-xs text-text-muted">
                Include when loaded config contains these action types
              </p>
            </div>

            {/* Error Patterns */}
            <div className="space-y-2">
              <Label htmlFor="errorPatterns" className="text-sm">
                Error Patterns (comma-separated regex)
              </Label>
              <Input
                id="errorPatterns"
                placeholder="e.g., TypeError, NullPointerException"
                value={formData.errorPatterns}
                onChange={(e) =>
                  setFormData({ ...formData, errorPatterns: e.target.value })
                }
                className="bg-transparent border-border-default focus:border-brand-primary"
              />
              <p className="text-xs text-text-muted">
                Include when recent logs match these patterns
              </p>
            </div>

            {/* File Patterns */}
            <div className="space-y-2">
              <Label htmlFor="filePatterns" className="text-sm">
                File Patterns (comma-separated globs)
              </Label>
              <Input
                id="filePatterns"
                placeholder="e.g., *.rs, src/api/**, tests/**"
                value={formData.filePatterns}
                onChange={(e) =>
                  setFormData({ ...formData, filePatterns: e.target.value })
                }
                className="bg-transparent border-border-default focus:border-brand-primary"
              />
              <p className="text-xs text-text-muted">
                Include when working on files matching these patterns
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={onClose}
          className="border-border-default"
        >
          Cancel
        </Button>
        <Button
          onClick={onSave}
          className="bg-brand-success hover:bg-brand-success/80 text-black"
        >
          {isEdit ? "Save Changes" : "Create Context"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
