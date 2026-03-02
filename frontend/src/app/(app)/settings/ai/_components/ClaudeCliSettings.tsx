import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Terminal } from "lucide-react";
import { EXECUTION_MODES, type ClaudeCliConfig } from "../types";

interface ClaudeCliSettingsProps {
  config: ClaudeCliConfig;
  onChange: (config: ClaudeCliConfig) => void;
}

export function ClaudeCliSettings({
  config,
  onChange,
}: ClaudeCliSettingsProps) {
  return (
    <div className="rounded-lg border border-border">
      <div className="px-4 py-3 border-b border-border bg-muted/50">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Terminal className="size-4" />
          Claude CLI Settings
        </h3>
      </div>
      <div className="p-4 space-y-4">
        <div className="space-y-2">
          <Label>Execution Mode</Label>
          <Select
            value={config.execution_mode}
            onValueChange={(v) => onChange({ ...config, execution_mode: v })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXECUTION_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Custom Executable Path</Label>
          <Input
            placeholder="Leave empty for default"
            value={config.custom_path ?? ""}
            onChange={(e) =>
              onChange({
                ...config,
                custom_path: e.target.value || null,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>Config Directory</Label>
          <Input
            placeholder="Leave empty for default"
            value={config.config_dir ?? ""}
            onChange={(e) =>
              onChange({
                ...config,
                config_dir: e.target.value || null,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>Timeout (seconds)</Label>
          <Input
            type="number"
            min={60}
            max={3600}
            value={config.timeout_seconds}
            onChange={(e) =>
              onChange({
                ...config,
                timeout_seconds: Number(e.target.value),
              })
            }
          />
        </div>
      </div>
    </div>
  );
}
