"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function TagInput({
  tags,
  onChange,
  placeholder = "Add tag...",
  disabled = false,
}: TagInputProps) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const tag = input.trim();
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setInput("");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className={`gap-1 text-xs ${disabled ? "opacity-50" : "cursor-pointer hover:bg-surface-hover"}`}
            onClick={() => !disabled && onChange(tags.filter((t) => t !== tag))}
          >
            {tag}
            {!disabled && <X className="size-3" />}
          </Badge>
        ))}
      </div>
      {!disabled && (
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          onBlur={addTag}
          placeholder={placeholder}
          className="bg-surface-raised/50 border-border-subtle h-8 text-sm"
        />
      )}
    </div>
  );
}
