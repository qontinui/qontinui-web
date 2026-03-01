"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface KeyValueEditorProps {
  values: Record<string, unknown>;
  onAdd: (key: string, value: unknown) => void;
  onRemove: (key: string) => void;
  placeholder?: string;
}

export function KeyValueEditor({
  values,
  onAdd,
  onRemove,
  placeholder,
}: KeyValueEditorProps) {
  const [newKey, setNewKey] = React.useState("");
  const [newValue, setNewValue] = React.useState("");

  const handleAdd = () => {
    if (newKey.trim()) {
      try {
        const parsed = JSON.parse(newValue);
        onAdd(newKey.trim(), parsed);
      } catch {
        onAdd(newKey.trim(), newValue);
      }
      setNewKey("");
      setNewValue("");
    }
  };

  return (
    <div className="space-y-2">
      {Object.entries(values).map(([key, value]) => (
        <div key={key} className="flex items-center gap-2">
          <Input value={key} disabled className="flex-1" />
          <Input
            value={
              typeof value === "object" && value !== null
                ? JSON.stringify(value)
                : value !== undefined && value !== null
                  ? String(value)
                  : ""
            }
            disabled
            className="flex-1"
          />
          <Button onClick={() => onRemove(key)} variant="ghost" size="icon">
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder={placeholder || "Key"}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="Value (JSON supported)"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <Button onClick={handleAdd} variant="outline" size="sm">
          <Plus />
        </Button>
      </div>
    </div>
  );
}
