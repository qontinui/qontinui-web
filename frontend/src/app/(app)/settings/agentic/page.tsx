"use client";

import { useState, useEffect, useCallback } from "react";
import { useRunnerHealth, runnerApi } from "@/lib/runner-api";
import type { AgenticSettings } from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Brain,
  RefreshCw,
  Route,
  ChevronDown,
  ChevronRight,
  Loader2,
  Info,
  RotateCcw,
} from "lucide-react";

const ROUTING_MODELS = [
  { value: "claude-3-5-haiku", label: "Claude 3.5 Haiku" },
  { value: "claude-sonnet-4", label: "Claude Sonnet 4" },
  { value: "claude-opus-4", label: "Claude Opus 4" },
  { value: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
  { value: "claude-3-opus", label: "Claude 3 Opus" },
];

export default function AgenticSettingsPage() {
  const { isLoading: healthLoading, isOffline } = useRunnerHealth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Section collapse state
  const [compressionOpen, setCompressionOpen] = useState(true);
  const [retryOpen, setRetryOpen] = useState(false);
  const [routingOpen, setRoutingOpen] = useState(false);

  // Compression settings
  const [compression, setCompression] = useState({
    enabled: true,
    threshold_tokens: 80000,
    target_tokens: 60000,
    keep_recent_items: 5,
    summarize_batch_size: 10,
  });

  // Retry settings
  const [retry, setRetry] = useState({
    enabled: true,
    max_retries: 3,
    base_delay_ms: 1000,
    max_delay_ms: 30000,
    exponential_base: 2.0,
    jitter: true,
    feedback_injection: true,
  });

  // Routing settings
  const [routing, setRouting] = useState({
    enabled: false,
    simple_model: "claude-3-5-haiku",
    medium_model: "claude-sonnet-4",
    complex_model: "claude-opus-4",
    file_threshold_simple: 3,
    file_threshold_medium: 10,
  });

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const settings = await runnerApi.getAgenticSettings();
      setCompression(settings.compression);
      setRetry(settings.retry);
      setRouting(settings.routing);
    } catch {
      toast.error("Failed to load agentic settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOffline) {
      loadSettings();
    }
  }, [isOffline, loadSettings]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const settings: AgenticSettings = {
        compression,
        retry,
        routing,
      };
      await runnerApi.saveAgenticSettings(settings);
      toast.success("Agentic settings saved");
    } catch {
      toast.error("Failed to save agentic settings");
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    setCompression({
      enabled: true,
      threshold_tokens: 80000,
      target_tokens: 60000,
      keep_recent_items: 5,
      summarize_batch_size: 10,
    });
    setRetry({
      enabled: true,
      max_retries: 3,
      base_delay_ms: 1000,
      max_delay_ms: 30000,
      exponential_base: 2.0,
      jitter: true,
      feedback_injection: true,
    });
    setRouting({
      enabled: false,
      simple_model: "claude-3-5-haiku",
      medium_model: "claude-sonnet-4",
      complex_model: "claude-opus-4",
      file_threshold_simple: 3,
      file_threshold_medium: 10,
    });
    toast.info("Settings reset to defaults (not saved yet)");
  };

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  if (healthLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">
          Advanced AI (Agentic)
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Configure memory compression, retry behavior, and intelligent task
          routing
        </p>
      </div>

      {/* Memory Compression */}
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setCompressionOpen(!compressionOpen)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              {compressionOpen ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              <Brain className="size-4" />
              Memory Compression
            </CardTitle>
            <Switch
              checked={compression.enabled}
              onCheckedChange={(checked) => {
                setCompression({ ...compression, enabled: checked });
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </CardHeader>
        {compressionOpen && (
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
              <Info className="size-4 mt-0.5 text-blue-500 shrink-0" />
              <p className="text-xs text-muted-foreground">
                Memory compression automatically summarizes older context when
                the conversation grows too long, keeping recent items intact
                while reducing token usage.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Threshold Tokens</Label>
              <Input
                type="number"
                min={10000}
                max={200000}
                step={5000}
                value={compression.threshold_tokens}
                onChange={(e) =>
                  setCompression({
                    ...compression,
                    threshold_tokens: Number(e.target.value),
                  })
                }
                disabled={!compression.enabled}
              />
              <p className="text-xs text-muted-foreground">
                Compression triggers when context exceeds this token count
              </p>
            </div>

            <div className="space-y-2">
              <Label>Target Tokens</Label>
              <Input
                type="number"
                min={5000}
                max={150000}
                step={5000}
                value={compression.target_tokens}
                onChange={(e) =>
                  setCompression({
                    ...compression,
                    target_tokens: Number(e.target.value),
                  })
                }
                disabled={!compression.enabled}
              />
              <p className="text-xs text-muted-foreground">
                Compress context down to this token count
              </p>
            </div>

            <div className="space-y-2">
              <Label>Keep Recent Items</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={compression.keep_recent_items}
                onChange={(e) =>
                  setCompression({
                    ...compression,
                    keep_recent_items: Number(e.target.value),
                  })
                }
                disabled={!compression.enabled}
              />
              <p className="text-xs text-muted-foreground">
                Number of recent context items to keep uncompressed
              </p>
            </div>

            <div className="space-y-2">
              <Label>Summarize Batch Size</Label>
              <Input
                type="number"
                min={5}
                max={50}
                value={compression.summarize_batch_size}
                onChange={(e) =>
                  setCompression({
                    ...compression,
                    summarize_batch_size: Number(e.target.value),
                  })
                }
                disabled={!compression.enabled}
              />
              <p className="text-xs text-muted-foreground">
                Number of items to summarize in each batch
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Retry with Feedback */}
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setRetryOpen(!retryOpen)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              {retryOpen ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              <RefreshCw className="size-4" />
              Retry with Feedback
            </CardTitle>
            <Switch
              checked={retry.enabled}
              onCheckedChange={(checked) => {
                setRetry({ ...retry, enabled: checked });
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </CardHeader>
        {retryOpen && (
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Max Retries</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={retry.max_retries}
                onChange={(e) =>
                  setRetry({
                    ...retry,
                    max_retries: Number(e.target.value),
                  })
                }
                disabled={!retry.enabled}
              />
            </div>

            <div className="space-y-2">
              <Label>Base Delay (ms)</Label>
              <Input
                type="number"
                min={100}
                max={10000}
                step={100}
                value={retry.base_delay_ms}
                onChange={(e) =>
                  setRetry({
                    ...retry,
                    base_delay_ms: Number(e.target.value),
                  })
                }
                disabled={!retry.enabled}
              />
            </div>

            <div className="space-y-2">
              <Label>Max Delay (ms)</Label>
              <Input
                type="number"
                min={1000}
                max={120000}
                step={1000}
                value={retry.max_delay_ms}
                onChange={(e) =>
                  setRetry({
                    ...retry,
                    max_delay_ms: Number(e.target.value),
                  })
                }
                disabled={!retry.enabled}
              />
            </div>

            <div className="space-y-2">
              <Label>Exponential Base</Label>
              <Input
                type="number"
                min={1.1}
                max={4}
                step={0.1}
                value={retry.exponential_base}
                onChange={(e) =>
                  setRetry({
                    ...retry,
                    exponential_base: Number(e.target.value),
                  })
                }
                disabled={!retry.enabled}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Add Jitter</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Add random jitter to retry delays
                </p>
              </div>
              <Switch
                checked={retry.jitter}
                onCheckedChange={(checked) =>
                  setRetry({ ...retry, jitter: checked })
                }
                disabled={!retry.enabled}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Feedback Injection</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Include error context in retry prompts
                </p>
              </div>
              <Switch
                checked={retry.feedback_injection}
                onCheckedChange={(checked) =>
                  setRetry({ ...retry, feedback_injection: checked })
                }
                disabled={!retry.enabled}
              />
            </div>
          </CardContent>
        )}
      </Card>

      {/* Intelligent Task Routing */}
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setRoutingOpen(!routingOpen)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              {routingOpen ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              <Route className="size-4" />
              Intelligent Task Routing
            </CardTitle>
            <Switch
              checked={routing.enabled}
              onCheckedChange={(checked) => {
                setRouting({ ...routing, enabled: checked });
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </CardHeader>
        {routingOpen && (
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Simple Tasks Model</Label>
              <Select
                value={routing.simple_model}
                onValueChange={(v) =>
                  setRouting({ ...routing, simple_model: v })
                }
                disabled={!routing.enabled}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUTING_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Medium Tasks Model</Label>
              <Select
                value={routing.medium_model}
                onValueChange={(v) =>
                  setRouting({ ...routing, medium_model: v })
                }
                disabled={!routing.enabled}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUTING_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Complex Tasks Model</Label>
              <Select
                value={routing.complex_model}
                onValueChange={(v) =>
                  setRouting({ ...routing, complex_model: v })
                }
                disabled={!routing.enabled}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUTING_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Simple Threshold (files)</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={routing.file_threshold_simple}
                onChange={(e) =>
                  setRouting({
                    ...routing,
                    file_threshold_simple: Number(e.target.value),
                  })
                }
                disabled={!routing.enabled}
              />
              <p className="text-xs text-muted-foreground">
                Tasks touching this many files or fewer use the simple model
              </p>
            </div>

            <div className="space-y-2">
              <Label>Medium Threshold (files)</Label>
              <Input
                type="number"
                min={2}
                max={50}
                value={routing.file_threshold_medium}
                onChange={(e) =>
                  setRouting({
                    ...routing,
                    file_threshold_medium: Number(e.target.value),
                  })
                }
                disabled={!routing.enabled}
              />
              <p className="text-xs text-muted-foreground">
                Tasks touching this many files or fewer use the medium model;
                more uses the complex model
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Actions */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={handleResetDefaults}
          className="text-text-muted"
        >
          <RotateCcw className="size-4 mr-2" />
          Reset to Defaults
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
