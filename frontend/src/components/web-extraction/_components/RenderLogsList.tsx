import { useExpandableSet } from "@/hooks/useExpandableSet";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import type { UIBridgeRenderLog } from "@/hooks/useUIBridgeExploration";

export function RenderLogsList({ logs }: { logs: UIBridgeRenderLog[] }) {
  const { expanded: expandedLogs, toggle: toggleLog } = useExpandableSet();

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-2">
        {logs.map((log, idx) => (
          <Collapsible
            key={log.id}
            open={expandedLogs.has(log.id)}
            onOpenChange={() => toggleLog(log.id)}
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-between font-normal h-auto py-2"
              >
                <div className="flex items-center gap-2 text-left">
                  {expandedLogs.has(log.id) ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <span className="font-mono text-sm">#{idx + 1}</span>
                  <span className="truncate max-w-[300px]">{log.url}</span>
                </div>
                <Badge variant="secondary">{log.elements_count} elements</Badge>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pl-6 space-y-1">
              <div className="p-2 rounded-md bg-muted/50 text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">ID:</span>
                  <span className="font-mono text-xs">{log.id}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Timestamp:</span>
                  <span className="text-xs">{log.timestamp}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Elements:</span>
                  <span className="text-xs">{log.elements_count}</span>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    </ScrollArea>
  );
}
