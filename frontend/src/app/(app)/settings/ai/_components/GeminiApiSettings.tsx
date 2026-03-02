import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Zap } from "lucide-react";
import { GEMINI_MODELS, type GeminiApiConfig } from "../types";
import { ApiKeyField } from "./ApiKeyField";

interface GeminiApiSettingsProps {
  config: GeminiApiConfig;
  onChange: (config: GeminiApiConfig) => void;
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

export function GeminiApiSettings({
  config,
  onChange,
  apiKeyConfigured,
  setApiKeyConfigured,
  apiKeyInput,
  setApiKeyInput,
  onSaveApiKey,
  onDeleteApiKey,
}: GeminiApiSettingsProps) {
  return (
    <div className="rounded-lg border border-border">
      <div className="px-4 py-3 border-b border-border bg-muted/50">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Zap className="size-4" />
          Gemini API Settings
        </h3>
      </div>
      <div className="p-4 space-y-4">
        <ApiKeyField
          providerKey="gemini_api"
          placeholder="AIza..."
          statusLabel="gemini api key status"
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
              {GEMINI_MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Max Output Tokens</Label>
          <Input
            type="number"
            min={256}
            max={32768}
            value={config.max_output_tokens}
            onChange={(e) =>
              onChange({
                ...config,
                max_output_tokens: Number(e.target.value),
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>Temperature</Label>
          <Input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={config.temperature}
            onChange={(e) =>
              onChange({
                ...config,
                temperature: Number(e.target.value),
              })
            }
          />
        </div>
      </div>
    </div>
  );
}
