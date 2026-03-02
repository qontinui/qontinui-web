"use client";

import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ReadmeTabProps {
  readme: string;
  onReadmeChange: (value: string) => void;
}

export function ReadmeTab({ readme, onReadmeChange }: ReadmeTabProps) {
  return (
    <Card className="bg-muted/50 border-border">
      <CardHeader>
        <CardTitle>README (Markdown)</CardTitle>
        <CardDescription>
          Provide documentation for your package (supports Markdown)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          placeholder="# My Package&#10;&#10;## Installation&#10;&#10;## Usage&#10;&#10;## Examples"
          value={readme}
          onChange={(e) => onReadmeChange(e.target.value)}
          rows={15}
          className="bg-muted border-border font-mono text-sm"
        />
        {readme && (
          <div className="p-4 bg-background border border-border rounded-lg">
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {readme}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
