/**
 * TagFilterPanel Component
 *
 * Checkbox list for filtering workflows by tags with AND/OR toggle.
 */

import React from "react";
import { Tag } from "lucide-react";
import { Button } from "../../ui/button";
import { Label } from "../../ui/label";
import { Checkbox } from "../../ui/checkbox";

export interface TagFilterPanelProps {
  availableTags: string[];
  selectedTags: string[];
  setSelectedTags: (tags: string[]) => void;
  tagOperator: string;
  onTagOperatorChange: (op: string) => void;
}

export function TagFilterPanel({
  availableTags,
  selectedTags,
  setSelectedTags,
  tagOperator,
  onTagOperatorChange,
}: TagFilterPanelProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" />
          <Label>Tags</Label>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={tagOperator === "AND" ? "default" : "outline"}
            size="sm"
            onClick={() => onTagOperatorChange("AND")}
            className="h-7 px-2 text-xs"
          >
            AND
          </Button>
          <Button
            variant={tagOperator === "OR" ? "default" : "outline"}
            size="sm"
            onClick={() => onTagOperatorChange("OR")}
            className="h-7 px-2 text-xs"
          >
            OR
          </Button>
        </div>
      </div>
      <div className="space-y-1 max-h-32 overflow-y-auto border rounded-md p-2">
        {availableTags.map((tag) => (
          <div
            key={tag}
            className="flex items-center gap-2 py-1 px-2 hover:bg-accent rounded cursor-pointer"
          >
            <Checkbox
              checked={selectedTags.includes(tag)}
              onCheckedChange={(checked) => {
                if (checked) {
                  setSelectedTags([...selectedTags, tag]);
                } else {
                  setSelectedTags(selectedTags.filter((t) => t !== tag));
                }
              }}
            />
            <span className="text-sm">{tag}</span>
          </div>
        ))}
        {availableTags.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-2">
            No tags available
          </div>
        )}
      </div>
    </div>
  );
}
