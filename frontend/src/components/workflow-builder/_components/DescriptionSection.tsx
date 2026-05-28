"use client";

import React from "react";
import { Layers, Loader2, Save, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  GENERATION_TEMPLATES,
  type WorkflowGenerationTemplate,
} from "@/lib/workflow-generation-templates";
import { TEMPLATE_ICONS } from "../ai-generate-types";

interface DescriptionSectionProps {
  description: string;
  setDescription: (value: string) => void;
  hasSpecs: boolean;

  // Template state
  showTemplates: boolean;
  setShowTemplates: (value: boolean) => void;
  isSavingTemplate: boolean;
  generationPrompts: Array<{
    id: string;
    name: string;
    content: string;
    category?: string;
  }>;
  onApplyTemplate: (template: WorkflowGenerationTemplate) => void;
  onSaveAsTemplate: () => void;
  onDeleteTemplate: (id: string, e: React.MouseEvent) => void;
}

export function DescriptionSection({
  description,
  setDescription,
  hasSpecs,
  showTemplates,
  setShowTemplates,
  isSavingTemplate,
  generationPrompts,
  onApplyTemplate,
  onSaveAsTemplate,
  onDeleteTemplate,
}: DescriptionSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm text-zinc-300">
          What should the workflow do?
        </Label>
        <Popover open={showTemplates} onOpenChange={setShowTemplates}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 text-xs">
              <Layers className="w-3 h-3 mr-1" />
              Templates
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end">
            <div className="max-h-[400px] overflow-y-auto">
              {/* Built-in templates */}
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-zinc-900/50 border-b border-border">
                Built-in
              </div>
              {GENERATION_TEMPLATES.map((template) => {
                const IconComponent = TEMPLATE_ICONS[template.icon] || Layers;
                return (
                  <button
                    key={template.id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b border-border last:border-0"
                    onClick={() => onApplyTemplate(template)}
                  >
                    <div className="flex items-center gap-1.5 font-medium text-xs">
                      <IconComponent className="w-3 h-3 text-zinc-400 shrink-0" />
                      {template.name}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {template.description}
                    </div>
                  </button>
                );
              })}

              {/* Saved templates */}
              {generationPrompts.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-zinc-900/50 border-b border-border">
                    My Templates ({generationPrompts.length})
                  </div>
                  {generationPrompts.map((prompt) => (
                    <button
                      key={prompt.id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b border-border last:border-0 group"
                      onClick={() => {
                        setDescription(prompt.content);
                        setShowTemplates(false);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-xs truncate min-w-0">
                          {prompt.name}
                        </div>
                        <DestructiveButton
                          size="icon"
                          className="shrink-0 p-0.5 rounded hover:bg-destructive/20 text-zinc-500 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => onDeleteTemplate(prompt.id, e)}
                          title="Delete template"
                        >
                          <X className="w-3 h-3" />
                        </DestructiveButton>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {prompt.content.substring(0, 120)}
                        {prompt.content.length > 120 && "..."}
                      </div>
                    </button>
                  ))}
                </>
              )}

              {/* Save current as template */}
              <div className="border-t border-border">
                <button
                  className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200"
                  disabled={!description.trim() || isSavingTemplate}
                  onClick={onSaveAsTemplate}
                >
                  {isSavingTemplate ? (
                    <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                  ) : (
                    <Save className="w-3 h-3 shrink-0" />
                  )}
                  Save Current as Template
                </button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <Textarea
        className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm min-h-[120px]"
        placeholder={
          hasSpecs
            ? "Optional: add additional instructions for the AI..."
            : "e.g., Run TypeScript type checking on the web frontend and fix any errors\ne.g., Check the runner API health, then verify UI Bridge elements are registered\ne.g., Run pytest with coverage and fix failing tests"
        }
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
    </div>
  );
}
