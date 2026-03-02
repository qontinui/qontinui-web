"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { EditorSection } from "@/components/builders/editors";
import { COMMAND_CATEGORIES } from "../constants";
import type { CommandTemplate } from "../shell-command-utils";

interface CommandTemplatesProps {
  onSelectTemplate: (template: CommandTemplate, categoryValue: string) => void;
}

export function CommandTemplates({ onSelectTemplate }: CommandTemplatesProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const categoriesWithTemplates = COMMAND_CATEGORIES.filter((c) => c.commands.length > 0);

  return (
    <EditorSection title="Quick Start Templates" icon={Sparkles} defaultOpen={true}>
      <p className="text-xs text-muted-foreground mb-3">
        Select a template to pre-fill the command fields, or start from scratch below.
      </p>
      <div className="space-y-1">
        {categoriesWithTemplates.map((category) => {
          const isExpanded = expandedCategory === category.value;
          const CategoryIcon = category.icon;

          return (
            <div key={category.value}>
              <button
                type="button"
                onClick={() => setExpandedCategory(isExpanded ? null : category.value)}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-muted transition-colors text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="size-3 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="size-3 text-muted-foreground shrink-0" />
                )}
                <CategoryIcon className={`size-4 shrink-0 ${category.color}`} />
                <span className="text-sm font-medium text-muted-foreground">{category.label}</span>
                <span className="text-xs text-muted-foreground ml-auto">{category.commands.length} templates</span>
              </button>
              {isExpanded && (
                <div className="ml-5 pl-4 border-l border-border space-y-0.5 mt-1 mb-2">
                  {category.commands.map((template) => (
                    <button
                      key={template.name}
                      type="button"
                      onClick={() => onSelectTemplate(template, category.value)}
                      className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-muted/70 transition-colors group"
                    >
                      <div className="text-sm text-muted-foreground group-hover:text-foreground">
                        {template.name}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono truncate">
                        {template.command}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </EditorSection>
  );
}
