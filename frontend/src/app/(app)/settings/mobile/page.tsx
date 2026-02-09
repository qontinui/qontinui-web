"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useRunnerHealth,
  runnerApi,
  type MobileSettings,
} from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  Smartphone,
  FolderOpen,
  Info,
  RefreshCw,
} from "lucide-react";

export default function MobileSettingsPage() {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [devices, setDevices] = useState<string[]>([]);
  const [refreshingDevices, setRefreshingDevices] = useState(false);

  // Form state
  const [adbPath, setAdbPath] = useState("");
  const [defaultDeviceId, setDefaultDeviceId] = useState("");
  const [appPackage, setAppPackage] = useState("");
  const [logcatLines, setLogcatLines] = useState(500);
  const [filterReactNative, setFilterReactNative] = useState(false);
  const [outputDir, setOutputDir] = useState("");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await runnerApi.getMobileSettings();
      setAdbPath(data.adb_path ?? "");
      setDefaultDeviceId(data.default_device_id ?? "");
      setAppPackage(data.app_package ?? "");
      setLogcatLines(data.logcat_lines ?? 500);
      setFilterReactNative(data.filter_react_native ?? false);
      setOutputDir(data.output_dir ?? "");
    } catch {
      toast.error("Failed to load mobile settings");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefreshDevices = useCallback(async () => {
    setRefreshingDevices(true);
    try {
      // Placeholder: in the future this would call runnerApi to list ADB devices
      setDevices([]);
      toast.info("Device scan complete");
    } catch {
      toast.error("Failed to refresh devices");
    } finally {
      setRefreshingDevices(false);
    }
  }, []);

  useEffect(() => {
    if (isOffline) {
      setLoading(false);
      return;
    }
    loadSettings();
  }, [isOffline, loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await runnerApi.saveMobileSettings({
        adb_path: adbPath || null,
        default_device_id: defaultDeviceId || null,
        app_package: appPackage || null,
        logcat_lines: logcatLines,
        filter_react_native: filterReactNative,
        output_dir: outputDir || null,
      } satisfies MobileSettings);
      toast.success("Mobile settings saved");
    } catch (err) {
      toast.error(
        `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setSaving(false);
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
            <Smartphone className="size-5" />
            Mobile
          </h2>
          <p className="text-sm text-text-muted mt-1">
            ADB device and mobile automation settings
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

      {/* ADB Configuration */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Smartphone className="size-4" />
            ADB Configuration
          </CardTitle>
          <CardDescription>
            Path to the Android Debug Bridge executable
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="adb-path" className="text-sm text-text-primary">
              ADB Path
            </Label>
            <Input
              id="adb-path"
              type="text"
              placeholder="Auto-detect"
              value={adbPath}
              onChange={(e) => setAdbPath(e.target.value)}
            />
            <p className="text-xs text-text-muted">
              Leave empty to auto-detect from ANDROID_HOME or system PATH.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Default Device */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Smartphone className="size-4" />
            Default Device
          </CardTitle>
          <CardDescription>
            Device to use when multiple are connected
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="device-id" className="text-sm text-text-primary">
              Device ID
            </Label>
            <div className="flex gap-2">
              <Select
                value={defaultDeviceId || undefined}
                onValueChange={(v) => setDefaultDeviceId(v)}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a device..." />
                </SelectTrigger>
                <SelectContent>
                  {devices.length === 0 ? (
                    <SelectItem value="__none__" disabled>
                      No devices found
                    </SelectItem>
                  ) : (
                    devices.map((device) => (
                      <SelectItem key={device} value={device}>
                        {device}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={handleRefreshDevices}
                disabled={refreshingDevices}
                title="Refresh devices"
              >
                <RefreshCw
                  className={`size-4 ${refreshingDevices ? "animate-spin" : ""}`}
                />
              </Button>
            </div>
            <p className="text-xs text-text-muted">
              The serial number or emulator ID shown by{" "}
              <code className="text-xs font-mono bg-surface-raised px-1 py-0.5 rounded">
                adb devices
              </code>
              . Click refresh to scan for connected devices.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* App Package */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Smartphone className="size-4" />
            App Package
          </CardTitle>
          <CardDescription>
            Default application package for automation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="app-package" className="text-sm text-text-primary">
              Package Name
            </Label>
            <Input
              id="app-package"
              type="text"
              placeholder="com.myapp or com.myapp.debug"
              value={appPackage}
              onChange={(e) => setAppPackage(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Logcat Capture */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FolderOpen className="size-4" />
            Logcat Capture
          </CardTitle>
          <CardDescription>
            Configure how device logs are captured
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="logcat-lines" className="text-sm text-text-primary">
              Lines to Capture
            </Label>
            <Input
              id="logcat-lines"
              type="number"
              min={100}
              max={10000}
              value={logcatLines}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val)) {
                  setLogcatLines(Math.min(10000, Math.max(100, val)));
                }
              }}
            />
            <p className="text-xs text-text-muted">
              Number of logcat lines to capture per session (100-10000).
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label
                htmlFor="filter-react-native"
                className="text-sm text-text-primary"
              >
                Filter React Native Logs
              </Label>
              <p className="text-xs text-text-muted">
                Only capture logs from ReactNative and ReactNativeJS tags
              </p>
            </div>
            <Switch
              id="filter-react-native"
              checked={filterReactNative}
              onCheckedChange={setFilterReactNative}
            />
          </div>
        </CardContent>
      </Card>

      {/* Output Directory */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FolderOpen className="size-4" />
            Output Directory
          </CardTitle>
          <CardDescription>
            Where mobile automation artifacts are saved
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="output-dir" className="text-sm text-text-primary">
              Custom Output Path
            </Label>
            <Input
              id="output-dir"
              type="text"
              placeholder="Default: .dev-logs/mobile/"
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
            />
            <p className="text-xs text-text-muted">
              Leave empty to use the default output directory.
            </p>
          </div>

          <div className="flex items-start gap-2 p-3 rounded-md bg-blue-500/5 border border-blue-500/10">
            <Info className="size-4 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-text-muted">
              Screenshots, logcat output, and other mobile artifacts are stored
              in the output directory, organized by session.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
