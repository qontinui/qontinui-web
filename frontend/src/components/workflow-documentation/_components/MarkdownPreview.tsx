"use client";

import React from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface MarkdownPreviewProps {
  content: string;
}

function MarkdownRenderer({ content }: { content: string }) {
  const elements = content.split("\n").map((line, idx) => {
    // Headers
    if (line.startsWith("### ")) {
      return (
        <h3 key={idx} className="text-lg font-semibold mt-4 mb-2">
          {line.slice(4)}
        </h3>
      );
    }
    if (line.startsWith("## ")) {
      return (
        <h2 key={idx} className="text-xl font-semibold mt-6 mb-3">
          {line.slice(3)}
        </h2>
      );
    }
    if (line.startsWith("# ")) {
      return (
        <h1 key={idx} className="text-2xl font-bold mt-8 mb-4">
          {line.slice(2)}
        </h1>
      );
    }

    // Lists
    if (line.startsWith("- ")) {
      return (
        <li key={idx} className="ml-4 list-disc">
          {line.slice(2)}
        </li>
      );
    }

    // Code blocks
    if (line.startsWith("```")) {
      return (
        <div key={idx} className="bg-muted p-2 rounded my-2 font-mono text-sm">
          {line}
        </div>
      );
    }

    // Regular paragraph
    if (line.trim()) {
      return (
        <p key={idx} className="mb-2">
          {line}
        </p>
      );
    }

    return <br key={idx} />;
  });
  return <>{elements}</>;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <>
      <Separator orientation="vertical" />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-3 border-b bg-muted/20">
          <h3 className="font-semibold text-sm">Preview</h3>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4 prose prose-sm dark:prose-invert max-w-none">
            <MarkdownRenderer content={content} />
          </div>
        </ScrollArea>
      </div>
    </>
  );
}
