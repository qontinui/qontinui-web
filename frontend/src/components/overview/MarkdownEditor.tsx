"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownView } from "./MarkdownView";

type MarkdownEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  canEdit?: boolean;
  bridge?: string;
};

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Write in Markdown…",
  canEdit = true,
  bridge = "overview.markdown-editor",
}: MarkdownEditorProps) {
  const [preview, setPreview] = useState(false);
  const renderedValue = useMemo(() => value.trim(), [value]);

  if (!canEdit) {
    return (
      <div data-ui-bridge-id={`${bridge}.readonly`}>
        <MarkdownView content={renderedValue} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-ui-bridge-id={bridge}>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant={preview ? "outline" : "secondary"}
          onClick={() => setPreview(false)}
          data-ui-bridge-id={`${bridge}.write`}
        >
          Write
        </Button>
        <Button
          type="button"
          size="sm"
          variant={preview ? "secondary" : "outline"}
          onClick={() => setPreview(true)}
          data-ui-bridge-id={`${bridge}.preview`}
        >
          Preview
        </Button>
      </div>
      {preview ? (
        <div className="min-h-48 rounded-md border border-border bg-card p-4">
          <MarkdownView content={renderedValue || "Nothing written yet."} />
        </div>
      ) : (
        <Textarea
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={placeholder}
          className="min-h-48 font-mono text-sm"
          data-ui-bridge-id={`${bridge}.input`}
        />
      )}
    </div>
  );
}
