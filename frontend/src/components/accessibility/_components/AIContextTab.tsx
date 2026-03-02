"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AIContextTabProps {
  aiContext: string | null;
  onCopyContext: () => void;
}

export function AIContextTab({ aiContext, onCopyContext }: AIContextTabProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs">AI-Friendly Context</Label>
        <Button
          variant="outline"
          size="sm"
          onClick={onCopyContext}
          disabled={!aiContext}
          className="h-7 gap-1"
        >
          <Copy className="h-3 w-3" />
          Copy
        </Button>
      </div>
      <ScrollArea className="h-[400px] rounded border border-border-default">
        <pre className="p-3 text-xs font-mono whitespace-pre-wrap">
          {aiContext || "Capture an accessibility tree to generate AI context."}
        </pre>
      </ScrollArea>
      <p className="text-xs text-muted-foreground">
        This context can be included in AI prompts for ref-based automation. The
        AI can then use commands like &quot;click @e3&quot; or &quot;type
        &apos;hello&apos; into @e5&quot;.
      </p>
    </div>
  );
}
