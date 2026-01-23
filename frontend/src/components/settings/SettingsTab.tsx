"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Save, RotateCcw, Download } from "lucide-react";

interface QontinuiSettings {
  core: {
    image_path: string;
    mock: boolean;
    headless: boolean;
    sikuli_jar_path: string | null;
    tesseract_path: string | null;
    image_cache_size: number;
    auto_wait_timeout: number;
  };
  mouse: {
    move_delay: number;
    pause_before_down: number;
    pause_after_down: number;
    pause_before_up: number;
    pause_after_up: number;
    click_delay: number;
    drag_delay: number;
  };
  mock: {
    click_duration: number;
    type_duration: number;
    find_duration: number;
    drag_duration: number;
    scroll_duration: number;
    wait_duration: number;
    vanish_duration: number;
    exists_duration: number;
  };
  screenshot: {
    save_snapshots: boolean;
    path: string;
    max_history: number;
    format: string;
    quality: number;
    include_timestamp: boolean;
    capture_on_error: boolean;
  };
  illustration: {
    enabled: boolean;
    show_click: boolean;
    show_drag: boolean;
    show_type: boolean;
    show_find: boolean;
    highlight_color: string;
    highlight_thickness: number;
    annotation_font_size: number;
  };
  analysis: {
    kmeans_clusters: number;
    color_tolerance: number;
    hsv_bins: number[];
    min_contour_area: number;
    max_contour_area: number;
  };
  recording: {
    enabled: boolean;
    path: string;
    fps: number;
    codec: string;
    quality: string;
    include_audio: boolean;
    max_duration_minutes: number;
  };
  dataset: {
    collect: boolean;
    path: string;
    include_screenshots: boolean;
    include_actions: boolean;
    include_timing: boolean;
    include_results: boolean;
    format: string;
    compression: string | null;
  };
  testing: {
    timeout_multiplier: number;
    retry_failed: boolean;
    max_retries: number;
    screenshot_on_failure: boolean;
    verbose_logging: boolean;
    parallel_execution: boolean;
    random_seed: number | null;
    iteration: number;
    send_logs: boolean;
  };
  monitor: {
    default_screen_index: number;
    multi_monitor_enabled: boolean;
    search_all_monitors: boolean;
    log_monitor_info: boolean;
    operation_monitor_map: Record<string, number>;
  };
}

const defaultSettings: QontinuiSettings = {
  core: {
    image_path: "classpath:images/",
    mock: false,
    headless: false,
    sikuli_jar_path: null,
    tesseract_path: null,
    image_cache_size: 100,
    auto_wait_timeout: 3.0,
  },
  mouse: {
    move_delay: 0.5,
    pause_before_down: 0.0,
    pause_after_down: 0.0,
    pause_before_up: 0.0,
    pause_after_up: 0.0,
    click_delay: 0.0,
    drag_delay: 0.5,
  },
  mock: {
    click_duration: 0.5,
    type_duration: 2.0,
    find_duration: 0.3,
    drag_duration: 1.0,
    scroll_duration: 0.5,
    wait_duration: 0.1,
    vanish_duration: 1.0,
    exists_duration: 0.3,
  },
  screenshot: {
    save_snapshots: true,
    path: "screenshots/",
    max_history: 50,
    format: "png",
    quality: 90,
    include_timestamp: true,
    capture_on_error: true,
  },
  illustration: {
    enabled: true,
    show_click: true,
    show_drag: true,
    show_type: true,
    show_find: true,
    highlight_color: "red",
    highlight_thickness: 3,
    annotation_font_size: 12,
  },
  analysis: {
    kmeans_clusters: 3,
    color_tolerance: 30,
    hsv_bins: [50, 60, 60],
    min_contour_area: 100,
    max_contour_area: 100000,
  },
  recording: {
    enabled: false,
    path: "recordings/",
    fps: 30,
    codec: "mp4v",
    quality: "medium",
    include_audio: false,
    max_duration_minutes: 60,
  },
  dataset: {
    collect: false,
    path: "datasets/",
    include_screenshots: true,
    include_actions: true,
    include_timing: true,
    include_results: true,
    format: "json",
    compression: null,
  },
  testing: {
    timeout_multiplier: 2.0,
    retry_failed: true,
    max_retries: 3,
    screenshot_on_failure: true,
    verbose_logging: true,
    parallel_execution: false,
    random_seed: null,
    iteration: 1,
    send_logs: true,
  },
  monitor: {
    default_screen_index: -1,
    multi_monitor_enabled: false,
    search_all_monitors: false,
    log_monitor_info: true,
    operation_monitor_map: {},
  },
};

export function SettingsTab() {
  const [settings, setSettings] = useState<QontinuiSettings>(defaultSettings);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/v1/settings/", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/v1/settings/", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify(settings),
      });
      if (response.ok) {
        toast.success("Settings saved successfully");
      } else {
        toast.error("Failed to save settings");
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error("Failed to save settings");
    } finally {
      setLoading(false);
    }
  };

  const resetSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/v1/settings/reset", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        toast.success("Settings reset to defaults");
      } else {
        toast.error("Failed to reset settings");
      }
    } catch (error) {
      console.error("Failed to reset settings:", error);
      toast.error("Failed to reset settings");
    } finally {
      setLoading(false);
    }
  };

  const exportSettings = async () => {
    try {
      const response = await fetch("/api/v1/settings/export?format=yaml", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        const blob = new Blob([data.content], { type: "text/yaml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "qontinui-settings.yaml";
        a.click();
        toast.success("Settings exported");
      }
    } catch (error) {
      console.error("Failed to export settings:", error);
      toast.error("Failed to export settings");
    }
  };

  const updateSetting = (
    category: keyof QontinuiSettings,
    key: string,
    value: unknown
  ) => {
    setSettings((prev) => ({
      ...prev,
      [category]: {
        ...prev[category],
        [key]: value,
      },
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Application Settings</h2>
          <p className="text-sm text-muted-foreground">
            Configure global properties for the Qontinui framework
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportSettings} data-ui-id="settings-export-btn">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button variant="outline" size="sm" onClick={resetSettings} data-ui-id="settings-reset-btn">
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset
          </Button>
          <Button size="sm" onClick={saveSettings} disabled={loading} data-ui-id="settings-save-btn">
            <Save className="w-4 h-4 mr-2" />
            Save
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Core Settings</CardTitle>
            <CardDescription>Essential framework configuration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="image_path">Image Path</Label>
              <Input
                id="image_path"
                value={settings.core.image_path}
                onChange={(e) =>
                  updateSetting("core", "image_path", e.target.value)
                }
                data-ui-id="settings-core-image-path-input"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="mock">Mock Mode</Label>
              <Switch
                id="mock"
                checked={settings.core.mock}
                onCheckedChange={(checked) =>
                  updateSetting("core", "mock", checked)
                }
                data-ui-id="settings-core-mock-toggle"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="headless">Headless Mode</Label>
              <Switch
                id="headless"
                checked={settings.core.headless}
                onCheckedChange={(checked) =>
                  updateSetting("core", "headless", checked)
                }
                data-ui-id="settings-core-headless-toggle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="image_cache_size">Image Cache Size</Label>
              <Input
                id="image_cache_size"
                type="number"
                value={settings.core.image_cache_size}
                onChange={(e) =>
                  updateSetting(
                    "core",
                    "image_cache_size",
                    parseInt(e.target.value)
                  )
                }
                data-ui-id="settings-core-image-cache-size-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="auto_wait_timeout">
                Auto Wait Timeout (seconds)
              </Label>
              <Input
                id="auto_wait_timeout"
                type="number"
                step="0.1"
                value={settings.core.auto_wait_timeout}
                onChange={(e) =>
                  updateSetting(
                    "core",
                    "auto_wait_timeout",
                    parseFloat(e.target.value)
                  )
                }
                data-ui-id="settings-core-auto-wait-timeout-input"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monitor Settings</CardTitle>
            <CardDescription>Multi-monitor configuration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="default_screen_index">
                Default Monitor Index (-1 for primary)
              </Label>
              <Input
                id="default_screen_index"
                type="number"
                value={settings.monitor.default_screen_index}
                onChange={(e) =>
                  updateSetting(
                    "monitor",
                    "default_screen_index",
                    parseInt(e.target.value)
                  )
                }
                data-ui-id="settings-monitor-default-screen-index-input"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="multi_monitor_enabled">
                Multi-Monitor Support
              </Label>
              <Switch
                id="multi_monitor_enabled"
                checked={settings.monitor.multi_monitor_enabled}
                onCheckedChange={(checked) =>
                  updateSetting("monitor", "multi_monitor_enabled", checked)
                }
                data-ui-id="settings-monitor-multi-monitor-enabled-toggle"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="search_all_monitors">Search All Monitors</Label>
              <Switch
                id="search_all_monitors"
                checked={settings.monitor.search_all_monitors}
                onCheckedChange={(checked) =>
                  updateSetting("monitor", "search_all_monitors", checked)
                }
                data-ui-id="settings-monitor-search-all-monitors-toggle"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="log_monitor_info">Log Monitor Info</Label>
              <Switch
                id="log_monitor_info"
                checked={settings.monitor.log_monitor_info}
                onCheckedChange={(checked) =>
                  updateSetting("monitor", "log_monitor_info", checked)
                }
                data-ui-id="settings-monitor-log-monitor-info-toggle"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mouse Settings</CardTitle>
            <CardDescription>Mouse action timing and behavior</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="move_delay">Move Delay (seconds)</Label>
              <Input
                id="move_delay"
                type="number"
                step="0.1"
                value={settings.mouse.move_delay}
                onChange={(e) =>
                  updateSetting(
                    "mouse",
                    "move_delay",
                    parseFloat(e.target.value)
                  )
                }
                data-ui-id="settings-mouse-move-delay-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pause_before_down">
                Pause Before Mouse Down (seconds)
              </Label>
              <Input
                id="pause_before_down"
                type="number"
                step="0.1"
                value={settings.mouse.pause_before_down}
                onChange={(e) =>
                  updateSetting(
                    "mouse",
                    "pause_before_down",
                    parseFloat(e.target.value)
                  )
                }
                data-ui-id="settings-mouse-pause-before-down-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pause_after_down">
                Pause After Mouse Down (seconds)
              </Label>
              <Input
                id="pause_after_down"
                type="number"
                step="0.1"
                value={settings.mouse.pause_after_down}
                onChange={(e) =>
                  updateSetting(
                    "mouse",
                    "pause_after_down",
                    parseFloat(e.target.value)
                  )
                }
                data-ui-id="settings-mouse-pause-after-down-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="click_delay">Click Delay (seconds)</Label>
              <Input
                id="click_delay"
                type="number"
                step="0.1"
                value={settings.mouse.click_delay}
                onChange={(e) =>
                  updateSetting(
                    "mouse",
                    "click_delay",
                    parseFloat(e.target.value)
                  )
                }
                data-ui-id="settings-mouse-click-delay-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="drag_delay">Drag Delay (seconds)</Label>
              <Input
                id="drag_delay"
                type="number"
                step="0.1"
                value={settings.mouse.drag_delay}
                onChange={(e) =>
                  updateSetting(
                    "mouse",
                    "drag_delay",
                    parseFloat(e.target.value)
                  )
                }
                data-ui-id="settings-mouse-drag-delay-input"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mock Mode Settings</CardTitle>
            <CardDescription>
              Simulated action timings for testing
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="click_duration">Click Duration (seconds)</Label>
              <Input
                id="click_duration"
                type="number"
                step="0.1"
                value={settings.mock.click_duration}
                onChange={(e) =>
                  updateSetting(
                    "mock",
                    "click_duration",
                    parseFloat(e.target.value)
                  )
                }
                data-ui-id="settings-mock-click-duration-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type_duration">Type Duration (seconds)</Label>
              <Input
                id="type_duration"
                type="number"
                step="0.1"
                value={settings.mock.type_duration}
                onChange={(e) =>
                  updateSetting(
                    "mock",
                    "type_duration",
                    parseFloat(e.target.value)
                  )
                }
                data-ui-id="settings-mock-type-duration-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="find_duration">Find Duration (seconds)</Label>
              <Input
                id="find_duration"
                type="number"
                step="0.1"
                value={settings.mock.find_duration}
                onChange={(e) =>
                  updateSetting(
                    "mock",
                    "find_duration",
                    parseFloat(e.target.value)
                  )
                }
                data-ui-id="settings-mock-find-duration-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="drag_duration">Drag Duration (seconds)</Label>
              <Input
                id="drag_duration"
                type="number"
                step="0.1"
                value={settings.mock.drag_duration}
                onChange={(e) =>
                  updateSetting(
                    "mock",
                    "drag_duration",
                    parseFloat(e.target.value)
                  )
                }
                data-ui-id="settings-mock-drag-duration-input"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Screenshot Settings</CardTitle>
            <CardDescription>
              Screen capture and history configuration
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="save_snapshots">Save Snapshots</Label>
              <Switch
                id="save_snapshots"
                checked={settings.screenshot.save_snapshots}
                onCheckedChange={(checked) =>
                  updateSetting("screenshot", "save_snapshots", checked)
                }
                data-ui-id="settings-screenshot-save-snapshots-toggle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="screenshot_path">Screenshot Path</Label>
              <Input
                id="screenshot_path"
                value={settings.screenshot.path}
                onChange={(e) =>
                  updateSetting("screenshot", "path", e.target.value)
                }
                data-ui-id="settings-screenshot-path-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max_history">Max History</Label>
              <Input
                id="max_history"
                type="number"
                value={settings.screenshot.max_history}
                onChange={(e) =>
                  updateSetting(
                    "screenshot",
                    "max_history",
                    parseInt(e.target.value)
                  )
                }
                data-ui-id="settings-screenshot-max-history-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="screenshot_format">Format</Label>
              <Select
                value={settings.screenshot.format}
                onValueChange={(value) =>
                  updateSetting("screenshot", "format", value)
                }
              >
                <SelectTrigger id="screenshot_format" data-ui-id="settings-screenshot-format-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="png">PNG</SelectItem>
                  <SelectItem value="jpg">JPG</SelectItem>
                  <SelectItem value="jpeg">JPEG</SelectItem>
                  <SelectItem value="bmp">BMP</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="quality">Quality (1-100)</Label>
              <Input
                id="quality"
                type="number"
                min="1"
                max="100"
                value={settings.screenshot.quality}
                onChange={(e) =>
                  updateSetting(
                    "screenshot",
                    "quality",
                    parseInt(e.target.value)
                  )
                }
                data-ui-id="settings-screenshot-quality-input"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="include_timestamp">Include Timestamp</Label>
              <Switch
                id="include_timestamp"
                checked={settings.screenshot.include_timestamp}
                onCheckedChange={(checked) =>
                  updateSetting("screenshot", "include_timestamp", checked)
                }
                data-ui-id="settings-screenshot-include-timestamp-toggle"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="capture_on_error">Capture on Error</Label>
              <Switch
                id="capture_on_error"
                checked={settings.screenshot.capture_on_error}
                onCheckedChange={(checked) =>
                  updateSetting("screenshot", "capture_on_error", checked)
                }
                data-ui-id="settings-screenshot-capture-on-error-toggle"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recording Settings</CardTitle>
            <CardDescription>Screen recording configuration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="recording_enabled">Enable Recording</Label>
              <Switch
                id="recording_enabled"
                checked={settings.recording.enabled}
                onCheckedChange={(checked) =>
                  updateSetting("recording", "enabled", checked)
                }
                data-ui-id="settings-recording-enabled-toggle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recording_path">Recording Path</Label>
              <Input
                id="recording_path"
                value={settings.recording.path}
                onChange={(e) =>
                  updateSetting("recording", "path", e.target.value)
                }
                data-ui-id="settings-recording-path-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fps">FPS</Label>
              <Input
                id="fps"
                type="number"
                value={settings.recording.fps}
                onChange={(e) =>
                  updateSetting("recording", "fps", parseInt(e.target.value))
                }
                data-ui-id="settings-recording-fps-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recording_quality">Quality</Label>
              <Select
                value={settings.recording.quality}
                onValueChange={(value) =>
                  updateSetting("recording", "quality", value)
                }
              >
                <SelectTrigger id="recording_quality" data-ui-id="settings-recording-quality-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="max_duration_minutes">
                Max Duration (minutes)
              </Label>
              <Input
                id="max_duration_minutes"
                type="number"
                value={settings.recording.max_duration_minutes}
                onChange={(e) =>
                  updateSetting(
                    "recording",
                    "max_duration_minutes",
                    parseInt(e.target.value)
                  )
                }
                data-ui-id="settings-recording-max-duration-minutes-input"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Illustration Settings</CardTitle>
            <CardDescription>Visual feedback and annotations</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="illustration_enabled">Enable Illustrations</Label>
              <Switch
                id="illustration_enabled"
                checked={settings.illustration.enabled}
                onCheckedChange={(checked) =>
                  updateSetting("illustration", "enabled", checked)
                }
                data-ui-id="settings-illustration-enabled-toggle"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="show_click">Show Clicks</Label>
              <Switch
                id="show_click"
                checked={settings.illustration.show_click}
                onCheckedChange={(checked) =>
                  updateSetting("illustration", "show_click", checked)
                }
                data-ui-id="settings-illustration-show-click-toggle"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="show_drag">Show Drags</Label>
              <Switch
                id="show_drag"
                checked={settings.illustration.show_drag}
                onCheckedChange={(checked) =>
                  updateSetting("illustration", "show_drag", checked)
                }
                data-ui-id="settings-illustration-show-drag-toggle"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="show_find">Show Finds</Label>
              <Switch
                id="show_find"
                checked={settings.illustration.show_find}
                onCheckedChange={(checked) =>
                  updateSetting("illustration", "show_find", checked)
                }
                data-ui-id="settings-illustration-show-find-toggle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="highlight_color">Highlight Color</Label>
              <Input
                id="highlight_color"
                value={settings.illustration.highlight_color}
                onChange={(e) =>
                  updateSetting(
                    "illustration",
                    "highlight_color",
                    e.target.value
                  )
                }
                data-ui-id="settings-illustration-highlight-color-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="highlight_thickness">
                Highlight Thickness (1-10)
              </Label>
              <Input
                id="highlight_thickness"
                type="number"
                min="1"
                max="10"
                value={settings.illustration.highlight_thickness}
                onChange={(e) =>
                  updateSetting(
                    "illustration",
                    "highlight_thickness",
                    parseInt(e.target.value)
                  )
                }
                data-ui-id="settings-illustration-highlight-thickness-input"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Analysis Settings</CardTitle>
            <CardDescription>
              Color analysis and clustering configuration
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="kmeans_clusters">K-Means Clusters</Label>
              <Input
                id="kmeans_clusters"
                type="number"
                value={settings.analysis.kmeans_clusters}
                onChange={(e) =>
                  updateSetting(
                    "analysis",
                    "kmeans_clusters",
                    parseInt(e.target.value)
                  )
                }
                data-ui-id="settings-analysis-kmeans-clusters-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="color_tolerance">Color Tolerance (0-255)</Label>
              <Input
                id="color_tolerance"
                type="number"
                value={settings.analysis.color_tolerance}
                onChange={(e) =>
                  updateSetting(
                    "analysis",
                    "color_tolerance",
                    parseInt(e.target.value)
                  )
                }
                data-ui-id="settings-analysis-color-tolerance-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="min_contour_area">Min Contour Area</Label>
              <Input
                id="min_contour_area"
                type="number"
                value={settings.analysis.min_contour_area}
                onChange={(e) =>
                  updateSetting(
                    "analysis",
                    "min_contour_area",
                    parseInt(e.target.value)
                  )
                }
                data-ui-id="settings-analysis-min-contour-area-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max_contour_area">Max Contour Area</Label>
              <Input
                id="max_contour_area"
                type="number"
                value={settings.analysis.max_contour_area}
                onChange={(e) =>
                  updateSetting(
                    "analysis",
                    "max_contour_area",
                    parseInt(e.target.value)
                  )
                }
                data-ui-id="settings-analysis-max-contour-area-input"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dataset Settings</CardTitle>
            <CardDescription>AI training data collection</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="dataset_collect">Collect Dataset</Label>
              <Switch
                id="dataset_collect"
                checked={settings.dataset.collect}
                onCheckedChange={(checked) =>
                  updateSetting("dataset", "collect", checked)
                }
                data-ui-id="settings-dataset-collect-toggle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dataset_path">Dataset Path</Label>
              <Input
                id="dataset_path"
                value={settings.dataset.path}
                onChange={(e) =>
                  updateSetting("dataset", "path", e.target.value)
                }
                data-ui-id="settings-dataset-path-input"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="include_screenshots">Include Screenshots</Label>
              <Switch
                id="include_screenshots"
                checked={settings.dataset.include_screenshots}
                onCheckedChange={(checked) =>
                  updateSetting("dataset", "include_screenshots", checked)
                }
                data-ui-id="settings-dataset-include-screenshots-toggle"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="include_actions">Include Actions</Label>
              <Switch
                id="include_actions"
                checked={settings.dataset.include_actions}
                onCheckedChange={(checked) =>
                  updateSetting("dataset", "include_actions", checked)
                }
                data-ui-id="settings-dataset-include-actions-toggle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dataset_format">Format</Label>
              <Select
                value={settings.dataset.format}
                onValueChange={(value) =>
                  updateSetting("dataset", "format", value)
                }
              >
                <SelectTrigger id="dataset_format" data-ui-id="settings-dataset-format-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="parquet">Parquet</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Testing Settings</CardTitle>
            <CardDescription>Test execution configuration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="timeout_multiplier">Timeout Multiplier</Label>
              <Input
                id="timeout_multiplier"
                type="number"
                step="0.1"
                value={settings.testing.timeout_multiplier}
                onChange={(e) =>
                  updateSetting(
                    "testing",
                    "timeout_multiplier",
                    parseFloat(e.target.value)
                  )
                }
                data-ui-id="settings-testing-timeout-multiplier-input"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="retry_failed">Retry Failed Tests</Label>
              <Switch
                id="retry_failed"
                checked={settings.testing.retry_failed}
                onCheckedChange={(checked) =>
                  updateSetting("testing", "retry_failed", checked)
                }
                data-ui-id="settings-testing-retry-failed-toggle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max_retries">Max Retries</Label>
              <Input
                id="max_retries"
                type="number"
                value={settings.testing.max_retries}
                onChange={(e) =>
                  updateSetting(
                    "testing",
                    "max_retries",
                    parseInt(e.target.value)
                  )
                }
                data-ui-id="settings-testing-max-retries-input"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="screenshot_on_failure">
                Screenshot on Failure
              </Label>
              <Switch
                id="screenshot_on_failure"
                checked={settings.testing.screenshot_on_failure}
                onCheckedChange={(checked) =>
                  updateSetting("testing", "screenshot_on_failure", checked)
                }
                data-ui-id="settings-testing-screenshot-on-failure-toggle"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="verbose_logging">Verbose Logging</Label>
              <Switch
                id="verbose_logging"
                checked={settings.testing.verbose_logging}
                onCheckedChange={(checked) =>
                  updateSetting("testing", "verbose_logging", checked)
                }
                data-ui-id="settings-testing-verbose-logging-toggle"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="parallel_execution">Parallel Execution</Label>
              <Switch
                id="parallel_execution"
                checked={settings.testing.parallel_execution}
                onCheckedChange={(checked) =>
                  updateSetting("testing", "parallel_execution", checked)
                }
                data-ui-id="settings-testing-parallel-execution-toggle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="test_iteration">Test Iteration</Label>
              <Input
                id="test_iteration"
                type="number"
                value={settings.testing.iteration}
                onChange={(e) =>
                  updateSetting(
                    "testing",
                    "iteration",
                    parseInt(e.target.value)
                  )
                }
                data-ui-id="settings-testing-iteration-input"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="send_logs">Send Logs</Label>
              <Switch
                id="send_logs"
                checked={settings.testing.send_logs}
                onCheckedChange={(checked) =>
                  updateSetting("testing", "send_logs", checked)
                }
                data-ui-id="settings-testing-send-logs-toggle"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
