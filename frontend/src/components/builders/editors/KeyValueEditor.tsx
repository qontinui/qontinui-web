"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";

interface KeyValueEditorProps {
  entries: Record<string, string>;
  onChange: (entries: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  disabled?: boolean;
}

export function KeyValueEditor({
  entries,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  disabled = false,
}: KeyValueEditorProps) {
  const pairs = Object.entries(entries);

  const updateKey = (oldKey: string, newKey: string) => {
    const updated: Record<string, string> = {};
    for (const [k, v] of Object.entries(entries)) {
      updated[k === oldKey ? newKey : k] = v;
    }
    onChange(updated);
  };

  const updateValue = (key: string, value: string) => {
    onChange({ ...entries, [key]: value });
  };

  const addPair = () => {
    let key = "";
    let i = 1;
    while (key in entries || key === "") {
      key = `header-${i++}`;
    }
    onChange({ ...entries, [key]: "" });
  };

  const removePair = (key: string) => {
    const updated = { ...entries };
    delete updated[key];
    onChange(updated);
  };

  return (
    <div className="space-y-1.5">
      {pairs.map(([key, value], idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <Input
            value={key}
            onChange={(e) => updateKey(key, e.target.value)}
            placeholder={keyPlaceholder}
            className="h-8 text-xs flex-1 bg-surface-canvas/50 border-border-subtle"
            disabled={disabled}
          />
          <Input
            value={value}
            onChange={(e) => updateValue(key, e.target.value)}
            placeholder={valuePlaceholder}
            className="h-8 text-xs flex-[2] bg-surface-canvas/50 border-border-subtle"
            disabled={disabled}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
            onClick={() => removePair(key)}
            disabled={disabled}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-text-muted hover:text-text-secondary gap-1"
        onClick={addPair}
        disabled={disabled}
      >
        <Plus className="size-3" />
        Add {keyPlaceholder}
      </Button>
    </div>
  );
}
