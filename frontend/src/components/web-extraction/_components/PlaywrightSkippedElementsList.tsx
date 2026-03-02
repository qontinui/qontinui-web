import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import type { SkippedElement } from "../playwright-results-types";
import { getRiskIcon, getRiskBadgeVariant } from "../playwright-results-utils";

export function PlaywrightSkippedElementsList({
  elements,
}: {
  elements: SkippedElement[];
}) {
  const [expandedUrls, setExpandedUrls] = useState<Set<string>>(new Set());

  const groupedByUrl = useMemo(() => {
    const groups: Record<string, SkippedElement[]> = {};
    for (const el of elements) {
      if (!groups[el.url]) {
        groups[el.url] = [];
      }
      groups[el.url]!.push(el);
    }
    return groups;
  }, [elements]);

  const toggleUrl = (url: string) => {
    setExpandedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  return (
    <ScrollArea className="h-[500px]">
      <div className="space-y-2">
        {Object.entries(groupedByUrl).map(([url, urlElements]) => (
          <Collapsible
            key={url}
            open={expandedUrls.has(url)}
            onOpenChange={() => toggleUrl(url)}
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-between font-normal h-auto py-2"
              >
                <div className="flex items-center gap-2 text-left">
                  {expandedUrls.has(url) ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <span className="truncate max-w-[400px]">{url}</span>
                </div>
                <Badge variant="secondary">{urlElements.length}</Badge>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pl-6 space-y-1">
              {urlElements.map((el, i) => (
                <div
                  key={`${el.selector}-${i}`}
                  className="p-2 rounded-md bg-muted/50 text-sm space-y-1"
                >
                  <div className="flex items-center gap-2">
                    {getRiskIcon(el.risk)}
                    <Badge variant={getRiskBadgeVariant(el.risk)}>
                      {el.risk}
                    </Badge>
                    <span className="text-muted-foreground truncate">
                      {el.text || "(no text)"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{el.reason}</p>
                  <p className="text-xs font-mono text-muted-foreground truncate">
                    {el.selector}
                  </p>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    </ScrollArea>
  );
}
