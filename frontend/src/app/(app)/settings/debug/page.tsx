"use client";

import { useState, useEffect } from "react";
import {
  useRunnerHealth,
  runnerApi,
  type DebugSettings,
  type DeviceInfo,
} from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  FlaskConical,
  Monitor,
  Copy,
  Check,
  Info,
} from "lucide-react";

export default function DebugSettingsPage() {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Debug form state
  const [enableImageDebug, setEnableImageDebug] = useState(false);
  const [topMatchesCount, setTopMatchesCount] = useState(5);

  // Device info state
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (isOffline) {
      setLoading(false);
      return;
    }
    loadAll();
  }, [isOffline]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [debugData, deviceData] = await Promise.all([
        runnerApi.getDebugSettings(),
        runnerApi.getDeviceInfo().catch(() => null),
      ]);
      setEnableImageDebug(debugData.enable_image_debug ?? false);
      setTopMatchesCount(debugData.top_matches_count ?? 5);
      setDeviceInfo(deviceData);
    } catch {
      toast.error("Failed to load debug settings");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await runnerApi.saveDebugSettings({
        enable_image_debug: enableImageDebug,
        top_matches_count: topMatchesCount,
      } satisfies DebugSettings);
      toast.success("Settings saved");
    } catch (err) {
      toast.error(
        `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  if (healthLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <FlaskConical className="size-5" />
            Debug
          </h2>
          <p className="text-sm text-text-muted mt-1">
            Diagnostics, debug modes, and device information
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          variant="brand-primary"
          size="sm"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Save
        </Button>
      </div>

      {/* Debug Settings */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FlaskConical className="size-4" />
            Debug
          </CardTitle>
          <CardDescription>
            Image matching diagnostics and debug output
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label
                htmlFor="image-debug"
                className="text-sm text-text-primary"
              >
                Enable Image Match Debug Mode
              </Label>
              <p className="text-xs text-text-muted">
                Save annotated screenshots showing match regions and confidence
                scores
              </p>
            </div>
            <Switch
              id="image-debug"
              checked={enableImageDebug}
              onCheckedChange={setEnableImageDebug}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="top-matches" className="text-sm text-text-primary">
              Top Matches to Display
            </Label>
            <p className="text-xs text-text-muted">
              Number of top match candidates to show in debug output (1-10)
            </p>
            <Input
              id="top-matches"
              type="number"
              min={1}
              max={10}
              value={topMatchesCount}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val) && val >= 1 && val <= 10) {
                  setTopMatchesCount(val);
                }
              }}
              className="w-24 bg-surface-canvas/50 border-border-subtle/50"
            />
            <input
              type="range"
              min={1}
              max={10}
              value={topMatchesCount}
              onChange={(e) => setTopMatchesCount(parseInt(e.target.value))}
              className="w-full h-2 bg-surface-canvas/50 rounded-lg appearance-none cursor-pointer accent-brand-primary"
            />
          </div>

          <div className="flex items-start gap-2 p-3 rounded-md bg-blue-500/5 border border-blue-500/10">
            <Info className="size-4 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-text-muted">
              When image debug mode is enabled, the runner saves annotated
              screenshots to{" "}
              <code className="text-text-primary bg-surface-canvas/50 px-1 py-0.5 rounded text-[11px]">
                .dev-logs/screenshots/
              </code>{" "}
              showing bounding boxes and confidence scores for each match
              attempt. This is useful for diagnosing image recognition issues
              but increases disk usage.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Device Information */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Monitor className="size-4" />
            Device Information
          </CardTitle>
          <CardDescription>
            Runner device identification details
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {deviceInfo ? (
            <>
              <CopyableField
                label="Device ID"
                value={deviceInfo.device_id}
                copied={copiedField === "device_id"}
                onCopy={() =>
                  copyToClipboard(deviceInfo.device_id, "device_id")
                }
              />
              <CopyableField
                label="Device Name"
                value={deviceInfo.device_name}
                copied={copiedField === "device_name"}
                onCopy={() =>
                  copyToClipboard(deviceInfo.device_name, "device_name")
                }
              />
              <CopyableField
                label="Platform"
                value={deviceInfo.platform}
                copied={copiedField === "platform"}
                onCopy={() => copyToClipboard(deviceInfo.platform, "platform")}
              />
            </>
          ) : (
            <p className="text-sm text-text-muted">
              Device information not available
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CopyableField({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <span
          data-content-role="label"
          data-content-label="field label"
          className="text-xs text-text-muted block"
        >
          {label}
        </span>
        <span
          data-content-role="body-text"
          data-content-label="field value"
          className="text-sm text-text-primary font-mono truncate block"
        >
          {value}
        </span>
      </div>
      <button
        onClick={onCopy}
        className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-canvas/50 transition-colors shrink-0"
        title={`Copy ${label}`}
      >
        {copied ? (
          <Check className="size-3.5 text-green-400" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </div>
  );
}
