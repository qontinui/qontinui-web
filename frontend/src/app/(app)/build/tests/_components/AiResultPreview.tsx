"use client";

import { Badge } from "@/components/ui/badge";
import { TEST_TYPE_MAP } from "../test-config";

interface AiResultPreviewProps {
  aiResult: Record<string, unknown>;
}

export function AiResultPreview({ aiResult }: AiResultPreviewProps) {
  return (
    <div className="space-y-3 text-sm">
      {typeof aiResult.name === "string" && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Name</div>
          <div className="text-foreground">{aiResult.name}</div>
        </div>
      )}
      {typeof aiResult.description === "string" && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Description</div>
          <div className="text-muted-foreground">{aiResult.description}</div>
        </div>
      )}
      {typeof aiResult.test_type === "string" && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Test Type</div>
          <Badge variant="outline" className="text-xs">
            {TEST_TYPE_MAP[aiResult.test_type]?.label || aiResult.test_type}
          </Badge>
        </div>
      )}
      {typeof aiResult.url === "string" && aiResult.url && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">URL</div>
          <div className="text-muted-foreground text-xs font-mono">{aiResult.url}</div>
        </div>
      )}
      {typeof aiResult.code === "string" && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Code Preview</div>
          <pre className="text-xs text-muted-foreground bg-background p-3 rounded overflow-x-auto max-h-48 overflow-y-auto font-mono border border-border">
            {aiResult.code.slice(0, 800)}
            {aiResult.code.length > 800 && "\n..."}
          </pre>
        </div>
      )}
      {Array.isArray(aiResult.tags) && aiResult.tags.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Tags</div>
          <div className="flex flex-wrap gap-1">
            {aiResult.tags.map((tag, i) => (
              <Badge key={i} variant="secondary" className="text-xs">
                {String(tag)}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
