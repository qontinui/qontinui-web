"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";

interface ConnectionSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cdpHost: string;
  cdpPort: number;
  onHostChange: (host: string) => void;
  onPortChange: (port: number) => void;
}

export function ConnectionSettings({
  open,
  onOpenChange,
  cdpHost,
  cdpPort,
  onHostChange,
  onPortChange,
}: ConnectionSettingsProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleContent>
        <div className="p-3 border-b border-border-default bg-surface-canvas/50 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">CDP Host</Label>
              <Input
                value={cdpHost}
                onChange={(e) => onHostChange(e.target.value)}
                placeholder="localhost"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CDP Port</Label>
              <Input
                type="number"
                value={cdpPort}
                onChange={(e) => onPortChange(parseInt(e.target.value) || 9222)}
                placeholder="9222"
                className="h-8 text-sm"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Start Chrome with: chrome --remote-debugging-port={cdpPort}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
