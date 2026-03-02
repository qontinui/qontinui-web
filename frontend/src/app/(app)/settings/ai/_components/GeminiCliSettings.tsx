import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles } from "lucide-react";
import { EXECUTION_MODES, GEMINI_MODELS, type GeminiCliConfig } from "../types";

interface GeminiCliSettingsProps {
  config: GeminiCliConfig;
  onChange: (config: GeminiCliConfig) => void;
}

export function GeminiCliSettings({
  config,
  onChange,
}: GeminiCliSettingsProps) {
  return (
    <div className="rounded-lg border border-border">
      <div className="px-4 py-3 border-b border-border bg-muted/50">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Sparkles className="size-4" />
          Gemini CLI Settings
        </h3>
      </div>
      <div className="p-4 space-y-4">
        <div className="space-y-2">
          <Label>Auth Method</Label>
          <div className="flex gap-3">
            {(["oauth", "api_key"] as const).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => onChange({ ...config, auth_method: method })}
                className={`flex-1 rounded-lg border p-2.5 text-sm text-center transition-colors ${
                  config.auth_method === method
                    ? "border-primary bg-primary/5 ring-1 ring-primary font-medium"
                    : "border-border hover:border-border/80 hover:bg-accent/50"
                }`}
              >
                {method === "oauth" ? "OAuth" : "API Key"}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Model</Label>
          <Select
            value={config.model}
            onValueChange={(v) => onChange({ ...config, model: v })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GEMINI_MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
