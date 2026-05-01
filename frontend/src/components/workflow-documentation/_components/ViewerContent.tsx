"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Section } from "../types";

interface ViewerContentProps {
  sections: Section[];
  searchQuery: string;
  collapsedSections: Set<string>;
  onCopyLink: (id: string) => void;
}

function SectionHeading({ level, title }: { level: number; title: string }) {
  const Tag = `h${level}` as keyof Pick<
    React.JSX.IntrinsicElements,
    "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
  >;
  return <Tag className="flex-1">{title}</Tag>;
}

function renderContentLine(line: string, idx: number): React.ReactNode {
  if (line.startsWith("```")) {
    const language = line.slice(3).trim();
    return (
      <div
        key={idx}
        className="bg-muted p-4 rounded-lg my-4 font-mono text-sm overflow-x-auto"
      >
        <div className="text-xs text-muted-foreground mb-2">
          {language || "code"}
        </div>
        <pre>{line}</pre>
      </div>
    );
  }

  if (line.includes("|")) {
    return (
      <div key={idx} className="overflow-x-auto my-4">
        <table className="min-w-full border-collapse border border-border">
          <tbody>
            <tr>
              {line
                .split("|")
                .filter(Boolean)
                .map((cell, cellIdx) => (
                  <td key={cellIdx} className="border border-border px-4 py-2">
                    {cell.trim()}
                  </td>
                ))}
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  if (line.match(/^\d+\.\s/)) {
    return (
      <li key={idx} className="ml-6 mb-2 list-decimal">
        {line.replace(/^\d+\.\s/, "")}
      </li>
    );
  }

  if (line.startsWith("- ")) {
    return (
      <li key={idx} className="ml-6 mb-2 list-disc">
        {line.slice(2)}
      </li>
    );
  }

  if (line.trim()) {
    // Parse inline markdown (bold + code) into React elements instead of HTML
    const parts: React.ReactNode[] = [];
    const pattern = /(\*\*(.+?)\*\*|`(.+?)`)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let partKey = 0;

    while ((match = pattern.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }
      if (match[2]) {
        parts.push(<strong key={partKey++}>{match[2]}</strong>);
      } else if (match[3]) {
        parts.push(
          <code
            key={partKey++}
            className="bg-muted px-1.5 py-0.5 rounded text-sm"
          >
            {match[3]}
          </code>
        );
      }
      lastIndex = pattern.lastIndex;
    }
    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }

    return (
      <p key={idx} className="mb-4 leading-7">
        {parts}
      </p>
    );
  }

  return <br key={idx} />;
}

function ContentRenderer({ content }: { content: string }) {
  return (
    <>{content.split("\n").map((line, idx) => renderContentLine(line, idx))}</>
  );
}

export function ViewerContent({
  sections,
  searchQuery,
  collapsedSections,
  onCopyLink,
}: ViewerContentProps) {
  return (
    <ScrollArea className="flex-1">
      <div className="max-w-4xl mx-auto p-8 prose prose-sm md:prose-base lg:prose-lg dark:prose-invert">
        {sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className="mb-8 scroll-mt-4"
          >
            <div className="flex items-center justify-between group">
              <SectionHeading level={section.level} title={section.title} />

              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 transition-opacity size-8"
                onClick={() => onCopyLink(section.id)}
              >
                <Share2 className="size-4" />
              </Button>
            </div>

            <div className={cn(collapsedSections.has(section.id) && "hidden")}>
              <ContentRenderer content={section.content} />
            </div>
          </section>
        ))}

        {sections.length === 0 && searchQuery && (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="size-12 mx-auto mb-4 opacity-50" />
            <p>No results found for &quot;{searchQuery}&quot;</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
