"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tag, Plus, X } from "lucide-react";
import type { WorkflowSectionProps } from "./WorkflowPropertiesTypes";

interface TagsSectionProps extends WorkflowSectionProps {
  newTag: string;
  setNewTag: (value: string) => void;
  onAdd: () => void;
  onRemove: (tag: string) => void;
}

export const TagsSection: React.FC<TagsSectionProps> = ({
  workflow,
  newTag,
  setNewTag,
  onAdd,
  onRemove,
}) => {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Tag className="w-4 h-4 text-yellow-400" />
        <h3 className="text-sm font-semibold text-text-secondary">Tags</h3>
      </div>

      <div className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAdd()}
            placeholder="Add tag..."
            className="flex-1 bg-transparent border-border-default text-text-secondary"
          />
          <Button
            size="sm"
            onClick={onAdd}
            disabled={!newTag.trim()}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {workflow.tags && workflow.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {workflow.tags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="bg-surface-raised text-text-secondary pr-1"
              >
                {tag}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onRemove(tag)}
                  className="h-4 w-4 p-0 ml-1 hover:bg-transparent"
                >
                  <X className="w-3 h-3" />
                </Button>
              </Badge>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
