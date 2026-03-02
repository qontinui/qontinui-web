"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sparkles,
  Save,
  X,
  Download,
  Eye,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { AutoSaveStatus } from "../_hooks/useDocumentationEditor";

interface EditorHeaderProps {
  workflowName: string;
  autoSaveStatus: AutoSaveStatus;
  showPreview: boolean;
  selectedTemplate: string;
  templates: Array<{ name: string }>;
  onTogglePreview: () => void;
  onApplyTemplate: (templateName: string) => void;
  onExport: (format: "markdown" | "html") => void;
  onGenerateAuto: () => void;
  onCancel: () => void;
  onSave: () => void;
}

export function EditorHeader({
  workflowName,
  autoSaveStatus,
  showPreview,
  selectedTemplate,
  templates,
  onTogglePreview,
  onApplyTemplate,
  onExport,
  onGenerateAuto,
  onCancel,
  onSave,
}: EditorHeaderProps) {
  return (
    <div className="flex items-center justify-between p-4 border-b">
      <div className="flex items-center gap-4 flex-1">
        <div>
          <h2 className="text-lg font-semibold">Edit Documentation</h2>
          <p className="text-sm text-muted-foreground">{workflowName}</p>
        </div>

        {/* Template Selector */}
        <Select value={selectedTemplate} onValueChange={onApplyTemplate}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Apply template..." />
          </SelectTrigger>
          <SelectContent>
            {templates.map((template) => (
              <SelectItem key={template.name} value={template.name}>
                {template.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Auto-save indicator */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {autoSaveStatus === "saved" && (
            <>
              <CheckCircle2 className="size-4 text-green-500" />
              <span>Saved</span>
            </>
          )}
          {autoSaveStatus === "saving" && (
            <>
              <Clock className="size-4 animate-spin" />
              <span>Saving...</span>
            </>
          )}
          {autoSaveStatus === "unsaved" && (
            <>
              <Clock className="size-4" />
              <span>Unsaved changes</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onGenerateAuto}>
          <Sparkles className="size-4" />
          Auto-generate
        </Button>

        <Button variant="ghost" size="sm" onClick={onTogglePreview}>
          <Eye className="size-4" />
          {showPreview ? "Hide" : "Show"} Preview
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Download className="size-4" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => onExport("markdown")}>
              Export as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("html")}>
              Export as HTML
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-6" />

        <Button variant="outline" size="sm" onClick={onCancel}>
          <X className="size-4" />
          Cancel
        </Button>
        <Button size="sm" onClick={onSave}>
          <Save className="size-4" />
          Save
        </Button>
      </div>
    </div>
  );
}
