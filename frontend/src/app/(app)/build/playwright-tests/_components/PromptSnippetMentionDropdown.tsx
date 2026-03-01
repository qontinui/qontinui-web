"use client";

import type { PromptSnippet } from "@/lib/runner/types/library";

interface PromptSnippetMentionProps {
  snippets: PromptSnippet[];
  query: string;
  onSelect: (snippet: PromptSnippet) => void;
  onClose: () => void;
}

export function PromptSnippetMentionDropdown({
  snippets,
  query,
  onSelect,
  onClose,
}: PromptSnippetMentionProps) {
  const filtered = snippets.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase())
  );

  if (filtered.length === 0) {
    return (
      <div className="absolute z-50 mt-1 w-64 bg-muted border border-border rounded-lg shadow-lg p-2">
        <p className="text-xs text-muted-foreground px-2 py-1">No prompt snippets found</p>
        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-muted-foreground px-2 py-1"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="absolute z-50 mt-1 w-64 max-h-48 overflow-y-auto bg-muted border border-border rounded-lg shadow-lg">
      {filtered.map((s) => (
        <button
          key={s.id}
          onClick={() => onSelect(s)}
          className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors first:rounded-t-lg last:rounded-b-lg"
        >
          <div className="font-medium truncate">{s.name}</div>
          {s.category && (
            <div className="text-xs text-muted-foreground">{s.category}</div>
          )}
        </button>
      ))}
    </div>
  );
}
