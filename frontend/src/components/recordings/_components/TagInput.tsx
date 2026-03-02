"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

interface TagInputProps {
  tags: string[];
  tagInput: string;
  disabled: boolean;
  onTagInputChange: (value: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
}

export function TagInput({
  tags,
  tagInput,
  disabled,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
}: TagInputProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="tags">Tags</Label>
      <div className="flex space-x-2">
        <Input
          id="tags"
          value={tagInput}
          onChange={(e) => onTagInputChange(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAddTag();
            }
          }}
          placeholder="Add tags..."
          disabled={disabled}
        />
        <Button
          variant="outline"
          onClick={onAddTag}
          disabled={!tagInput.trim() || disabled}
        >
          Add
        </Button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="flex items-center gap-1"
            >
              {tag}
              {!disabled && (
                <X
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => onRemoveTag(tag)}
                />
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
