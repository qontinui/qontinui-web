/**
 * UI-TARS Configuration Panel
 *
 * Configuration form for UI-TARS extraction settings:
 * - Target type (web URLs or desktop application)
 * - Provider settings (local or cloud)
 * - Model settings (size, quantization)
 * - Exploration settings (goal, steps, timeout)
 */

"use client";

import { Bot, Globe, Monitor, Server, Cloud, Cpu, Zap, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type {
  UITarsExtractionConfig,
  UITarsProvider,
  UITarsModelSize,
  UITarsQuantization,
} from "@/types/extraction-unified";

interface UITarsConfigPanelProps {
  method: "uitars-web" | "uitars-desktop";
  config: UITarsExtractionConfig;
  onConfigChange: (config: UITarsExtractionConfig) => void;
}

const MODEL_INFO: Record<UITarsModelSize, { vram: string; speed: string }> = {
  "2B": { vram: "~4-5GB (int4)", speed: "~2-5s/step" },
  "7B": { vram: "~8-10GB (int4)", speed: "~5-10s/step" },
  "72B": { vram: "~40GB+", speed: "Cloud recommended" },
};

export function UITarsConfigPanel({
  method,
  config,
  onConfigChange,
}: UITarsConfigPanelProps) {
  const isWeb = method === "uitars-web";

  const updateConfig = (updates: Partial<UITarsExtractionConfig>) => {
    onConfigChange({ ...config, ...updates });
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Target Section */}
        <Card className="p-4 bg-surface-raised/60 border-brand-secondary/20">
          <div className="flex items-center gap-2 mb-4">
            {isWeb ? (
              <Globe className="h-5 w-5 text-brand-secondary" />
            ) : (
              <Monitor className="h-5 w-5 text-brand-secondary" />
            )}
            <Label className="text-brand-secondary font-mono uppercase tracking-wider">
              Target
            </Label>
          </div>

          {isWeb ? (
            <div className="space-y-2">
              <Label htmlFor="urls" className="text-sm text-text-muted">
                URLs to explore
              </Label>
              <Textarea
                id="urls"
                data-ui-id="extraction-uitars-urls-input"
                value={config.urls?.join("\n") || ""}
                onChange={(e) =>
                  updateConfig({ urls: e.target.value.split("\n").filter(Boolean) })
                }
                placeholder="https://example.com&#10;https://example.com/login"
                className="font-mono text-sm min-h-[80px]"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="applicationName" className="text-sm text-text-muted">
                Application name or window title
              </Label>
              <Input
                id="applicationName"
                data-ui-id="extraction-uitars-app-name-input"
                value={config.applicationName || ""}
                onChange={(e) => updateConfig({ applicationName: e.target.value })}
                placeholder="e.g., Notepad, Chrome, Calculator"
                className="font-mono"
              />
            </div>
          )}
        </Card>

        {/* Exploration Goal */}
        <Card className="p-4 bg-surface-raised/60 border-brand-secondary/20">
          <div className="flex items-center gap-2 mb-4">
            <Bot className="h-5 w-5 text-brand-secondary" />
            <Label className="text-brand-secondary font-mono uppercase tracking-wider">
              Exploration Goal
            </Label>
            <span className="text-[10px] text-text-muted font-mono">(Optional)</span>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-4 w-4 text-text-muted" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>
                  The default goal discovers clickable elements and states for building
                  automation. Customize to focus on specific areas or workflows.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>

          <Textarea
            data-ui-id="extraction-uitars-goal-input"
            value={config.goal}
            onChange={(e) => updateConfig({ goal: e.target.value })}
            placeholder="Default: Explore and discover all clickable UI elements and states..."
            className="font-mono text-sm min-h-[100px]"
          />

          <p className="text-[10px] text-text-muted mt-2 font-mono">
            The default goal discovers clickable elements to build a state machine.
            Customize to narrow focus (e.g., &quot;Explore only the Settings menu&quot;).
          </p>
        </Card>

        {/* Provider Settings */}
        <Card className="p-4 bg-surface-raised/60 border-brand-secondary/20">
          <div className="flex items-center gap-2 mb-4">
            <Server className="h-5 w-5 text-brand-secondary" />
            <Label className="text-brand-secondary font-mono uppercase tracking-wider">
              Provider Settings
            </Label>
          </div>

          <div className="space-y-4">
            {/* Provider Selection */}
            <div className="space-y-2">
              <Label className="text-sm text-text-muted">Provider</Label>
              <Select
                value={config.provider}
                onValueChange={(value: UITarsProvider) =>
                  updateConfig({ provider: value })
                }
              >
                <SelectTrigger data-ui-id="extraction-uitars-provider-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local_transformers">
                    <div className="flex items-center gap-2">
                      <Cpu className="h-4 w-4" />
                      Local (Transformers)
                    </div>
                  </SelectItem>
                  <SelectItem value="local_vllm">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      Local (vLLM Server)
                    </div>
                  </SelectItem>
                  <SelectItem value="cloud">
                    <div className="flex items-center gap-2">
                      <Cloud className="h-4 w-4" />
                      Cloud (HuggingFace)
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Model Size */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm text-text-muted">Model Size</Label>
                <Select
                  value={config.modelSize}
                  onValueChange={(value: UITarsModelSize) =>
                    updateConfig({ modelSize: value })
                  }
                >
                  <SelectTrigger data-ui-id="extraction-uitars-model-size-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2B">2B (GTX 1080 compatible)</SelectItem>
                    <SelectItem value="7B">7B (RTX 3080+ recommended)</SelectItem>
                    <SelectItem value="72B">72B (Cloud only)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm text-text-muted">Quantization</Label>
                <Select
                  value={config.quantization}
                  onValueChange={(value: UITarsQuantization) =>
                    updateConfig({ quantization: value })
                  }
                  disabled={config.provider === "cloud"}
                >
                  <SelectTrigger data-ui-id="extraction-uitars-quantization-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="int4">int4 (recommended)</SelectItem>
                    <SelectItem value="int8">int8</SelectItem>
                    <SelectItem value="none">none (full precision)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Model Info */}
            <div className="p-3 rounded-lg bg-surface-canvas/50 border border-border-subtle">
              <div className="flex items-center gap-4 text-xs text-text-muted">
                <span>
                  VRAM: <span className="text-brand-secondary">{MODEL_INFO[config.modelSize].vram}</span>
                </span>
                <span>
                  Speed: <span className="text-brand-secondary">{MODEL_INFO[config.modelSize].speed}</span>
                </span>
              </div>
            </div>

            {/* Cloud-specific settings */}
            {config.provider === "cloud" && (
              <div className="space-y-3 p-3 rounded-lg border border-brand-secondary/20 bg-brand-secondary/5">
                <div className="space-y-2">
                  <Label className="text-sm text-text-muted">HuggingFace Endpoint</Label>
                  <Input
                    data-ui-id="extraction-uitars-hf-endpoint-input"
                    value={config.huggingfaceEndpoint || ""}
                    onChange={(e) => updateConfig({ huggingfaceEndpoint: e.target.value })}
                    placeholder="https://xyz.endpoints.huggingface.cloud"
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm text-text-muted">API Token</Label>
                  <Input
                    type="password"
                    data-ui-id="extraction-uitars-hf-token-input"
                    value={config.huggingfaceApiToken || ""}
                    onChange={(e) => updateConfig({ huggingfaceApiToken: e.target.value })}
                    placeholder="hf_xxxxx"
                    className="font-mono text-sm"
                  />
                </div>
              </div>
            )}

            {/* vLLM-specific settings */}
            {config.provider === "local_vllm" && (
              <div className="space-y-2 p-3 rounded-lg border border-brand-secondary/20 bg-brand-secondary/5">
                <Label className="text-sm text-text-muted">vLLM Server URL</Label>
                <Input
                  data-ui-id="extraction-uitars-vllm-url-input"
                  value={config.vllmServerUrl || ""}
                  onChange={(e) => updateConfig({ vllmServerUrl: e.target.value })}
                  placeholder="http://localhost:8000"
                  className="font-mono text-sm"
                />
              </div>
            )}
          </div>
        </Card>

        {/* Exploration Limits */}
        <Card className="p-4 bg-surface-raised/60 border-brand-secondary/20">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-5 w-5 text-brand-secondary" />
            <Label className="text-brand-secondary font-mono uppercase tracking-wider">
              Exploration Limits
            </Label>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm text-text-muted">Max Steps</Label>
                <Input
                  type="number"
                  data-ui-id="extraction-uitars-max-steps-input"
                  value={config.maxSteps}
                  onChange={(e) => updateConfig({ maxSteps: parseInt(e.target.value) || 50 })}
                  min={1}
                  max={200}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-text-muted">Timeout (seconds)</Label>
                <Input
                  type="number"
                  data-ui-id="extraction-uitars-timeout-input"
                  value={config.timeoutSeconds}
                  onChange={(e) =>
                    updateConfig({ timeoutSeconds: parseInt(e.target.value) || 600 })
                  }
                  min={60}
                  max={3600}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm">Save Screenshots</Label>
                <p className="text-xs text-text-muted">
                  Save screenshots during exploration for review
                </p>
              </div>
              <Switch
                data-ui-id="extraction-uitars-save-screenshots-toggle"
                checked={config.saveScreenshots}
                onCheckedChange={(checked) => updateConfig({ saveScreenshots: checked })}
              />
            </div>
          </div>
        </Card>

        {/* Info Alert */}
        <Alert className="bg-brand-secondary/5 border-brand-secondary/20">
          <Info className="h-4 w-4 text-brand-secondary" />
          <AlertDescription className="text-sm text-text-muted">
            UI-TARS uses vision-language models to autonomously explore GUIs.
            {config.provider === "local_transformers" && (
              <span className="block mt-1">
                Local inference requires a CUDA-capable GPU. The 2B model with int4
                quantization works on 8GB GPUs.
              </span>
            )}
          </AlertDescription>
        </Alert>
      </div>
    </TooltipProvider>
  );
}
