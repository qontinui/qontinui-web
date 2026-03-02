import React, { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { SharedShellConfig, UpdateConfigFn } from "../types";

interface AdvancedShellConfigProps {
  config: SharedShellConfig;
  updateConfig: UpdateConfigFn;
  defaultTimeout?: number;
  stdinPlaceholder?: string;
}

export function AdvancedShellConfig({
  config,
  updateConfig,
  defaultTimeout = 30000,
  stdinPlaceholder = "Input to pass to command...",
}: AdvancedShellConfigProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
      <CollapsibleTrigger className="flex items-center gap-2 text-xs text-text-muted hover:text-text-default">
        {showAdvanced ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        Advanced Configuration
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 mt-3">
        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Working Directory</Label>
          <Input
            type="text"
            value={config.workingDirectory || ""}
            onChange={(e) =>
              updateConfig("workingDirectory", e.target.value || undefined)
            }
            placeholder="/path/to/directory"
            className="bg-transparent border-border-default"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Exit Code Variable</Label>
          <Input
            type="text"
            value={config.exitCodeVariable || ""}
            onChange={(e) =>
              updateConfig("exitCodeVariable", e.target.value || undefined)
            }
            placeholder="exit_code"
            className="bg-transparent border-border-default"
          />
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-xs text-text-muted">Capture Stderr</Label>
          <Switch
            checked={config.captureStderr || false}
            onCheckedChange={(checked) =>
              updateConfig("captureStderr", checked)
            }
          />
        </div>

        {config.captureStderr && (
          <div className="space-y-2">
            <Label className="text-xs text-text-muted">Stderr Variable</Label>
            <Input
              type="text"
              value={config.stderrVariable || ""}
              onChange={(e) =>
                updateConfig("stderrVariable", e.target.value || undefined)
              }
              placeholder="stderr_output"
              className="bg-transparent border-border-default"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Stdin Input</Label>
          <Textarea
            value={config.stdin || ""}
            onChange={(e) => updateConfig("stdin", e.target.value || undefined)}
            placeholder={stdinPlaceholder}
            className="bg-transparent border-border-default min-h-[60px] font-mono text-sm"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Timeout (ms)</Label>
          <Input
            type="number"
            min="1000"
            max="600000"
            value={config.timeout || defaultTimeout}
            onChange={(e) => updateConfig("timeout", Number(e.target.value))}
            className="bg-transparent border-border-default"
          />
          <p className="text-xs text-text-muted">
            Max execution time in milliseconds
          </p>
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-xs text-text-muted">
            Fail on Non-Zero Exit
          </Label>
          <Switch
            checked={config.failOnError !== false}
            onCheckedChange={(checked) => updateConfig("failOnError", checked)}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Description</Label>
          <Textarea
            value={config.description || ""}
            onChange={(e) =>
              updateConfig("description", e.target.value || undefined)
            }
            placeholder="Describe what this command does..."
            className="bg-transparent border-border-default min-h-[60px]"
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
