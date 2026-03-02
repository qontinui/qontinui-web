import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bot } from "lucide-react";
import { CLAUDE_MODELS, type ClaudeApiConfig } from "../types";
import { ApiKeyField } from "./ApiKeyField";

interface ClaudeApiSettingsProps {
  config: ClaudeApiConfig;
  onChange: (config: ClaudeApiConfig) => void;
  apiKeyConfigured: boolean;
  setApiKeyConfigured: (v: boolean) => void;
  apiKeyInput: string;
  setApiKeyInput: (v: string) => void;
  onSaveApiKey: (
    providerKey: string,
    key: string,
    setConfigured: (v: boolean) => void,
    setInput: (v: string) => void
  ) => void;
  onDeleteApiKey: (
    providerKey: string,
    setConfigured: (v: boolean) => void
  ) => void;
}

export function ClaudeApiSettings({
  config,
  onChange,
  apiKeyConfigured,
  setApiKeyConfigured,
  apiKeyInput,
  setApiKeyInput,
  onSaveApiKey,
  onDeleteApiKey,
}: ClaudeApiSettingsProps) {
  return (
    <div className="rounded-lg border border-border">
      <div className="px-4 py-3 border-b border-border bg-muted/50">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Bot className="size-4" />
          Claude API Settings
        </h3>
      </div>
      <div className="p-4 space-y-4">
        <ApiKeyField
          providerKey="claude_api"
          placeholder="sk-ant-..."
          statusLabel="claude api key status"
          isConfigured={apiKeyConfigured}
          keyInput={apiKeyInput}
          onKeyInputChange={setApiKeyInput}
          onSave={onSaveApiKey}
          onDelete={onDeleteApiKey}
          setConfigured={setApiKeyConfigured}
          setKeyInput={setApiKeyInput}
        />

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
              {CLAUDE_MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Max Tokens</Label>
          <Input
            type="number"
            min={256}
            max={32768}
            value={config.max_tokens}
            onChange={(e) =>
              onChange({
                ...config,
                max_tokens: Number(e.target.value),
              })
            }
          />
        </div>
      </div>
    </div>
  );
}
