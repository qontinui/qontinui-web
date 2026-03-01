"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ArrayEditorProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

export function ArrayEditor({
  values,
  onChange,
  placeholder,
}: ArrayEditorProps) {
  const [newValue, setNewValue] = React.useState("");

  const handleAdd = () => {
    if (newValue.trim() && !values.includes(newValue.trim())) {
      onChange([...values, newValue.trim()]);
      setNewValue("");
    }
  };

  const handleRemove = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {values.map((value, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input value={value} disabled className="flex-1" />
          <Button
            onClick={() => handleRemove(index)}
            variant="ghost"
            size="icon"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder={placeholder || "Add value..."}
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
