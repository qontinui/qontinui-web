"use client";

import React, { RefObject } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface TOCItem {
  level: number;
  text: string;
  id: string;
}

interface TableOfContentsProps {
  items: TOCItem[];
  content: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export function extractTOC(content: string): TOCItem[] {
  const lines = content.split("\n");
  const headers: TOCItem[] = [];

  lines.forEach((line, idx) => {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1]!.length;
      const text = match[2]!.trim();
      const id = `heading-${idx}`;
      headers.push({ level, text, id });
    }
  });

  return headers;
}

export function TableOfContents({
  items,
  content,
  textareaRef,
}: TableOfContentsProps) {
  if (items.length === 0) return null;

  return (
    <div className="w-48 border-r bg-muted/20">
      <div className="p-3 border-b">
        <h3 className="font-semibold text-sm">Contents</h3>
      </div>
      <ScrollArea className="h-full">
        <div className="p-2 space-y-1">
          {items.map((item, idx) => (
            <button
              key={idx}
              className={cn(
                "w-full text-left text-sm px-2 py-1 rounded hover:bg-accent transition-colors",
                item.level === 1 && "font-semibold",
                item.level === 2 && "pl-4",
                item.level === 3 && "pl-6 text-muted-foreground",
                item.level > 3 && "pl-8 text-muted-foreground text-xs"
              )}
              onClick={() => {
                const textarea = textareaRef.current;
                if (textarea) {
                  const index = content.indexOf(item.text);
                  if (index !== -1) {
                    textarea.focus();
                    textarea.setSelectionRange(index, index);
                  }
                }
              }}
            >
              {item.text}
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
