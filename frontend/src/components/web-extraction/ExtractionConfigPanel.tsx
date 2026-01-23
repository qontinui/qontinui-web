/**
 * Extraction Config Panel Component
 *
 * Allows users to configure web extraction settings:
 * - Input URLs to crawl
 * - Configure viewports based on selected monitors
 * - Toggle hover/focus state capture
 * - Set crawl depth and page limits
 * - Add authentication cookies
 *
 * Configuration is persisted via the useExtractionConfig hook until logout.
 */

"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, X, Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRunnerMonitors } from "@/hooks/useRunnerMonitors";
import type { useExtractionConfig } from "@/hooks/use-extraction-config";
import { MonitorSelector } from "../monitor-selector";

interface ExtractionConfigPanelProps {
  extractionConfig: ReturnType<typeof useExtractionConfig>;
}

// Default viewport size when monitor resolution is not available
const DEFAULT_VIEWPORT: [number, number] = [1920, 1080];

export function ExtractionConfigPanel({
  extractionConfig,
}: ExtractionConfigPanelProps) {
  // Use persistent config from hook
  const {
    config,
    isLoaded,
    setUrls,
    setSelectedMonitors,
    setCaptureHover,
    setCaptureFocus,
    setMaxDepth,
    setMaxPages,
  } = extractionConfig;

  const {
    urls,
    selectedMonitors,
    captureHover,
    captureFocus,
    maxDepth,
    maxPages,
  } = config;

  // Fetch runner monitors to get actual monitor resolutions
  const { monitors: runnerMonitors, isRunnerConnected } = useRunnerMonitors();

  // Convert selected monitor indices to viewport dimensions
  const getViewportsFromMonitors = (): [number, number][] => {
    return selectedMonitors.map((monitorIndex) => {
      const monitor = runnerMonitors.find((m) => m.index === monitorIndex);
      if (monitor) {
        return [monitor.width, monitor.height];
      }
      // Fallback to default viewport
      return DEFAULT_VIEWPORT;
    });
  };

  const handleAddUrl = () => {
    setUrls([...urls, ""]);
  };

  const handleRemoveUrl = (index: number) => {
    if (urls.length === 1) {
      toast.error("At least one URL is required");
      return;
    }
    setUrls(urls.filter((_, i) => i !== index));
  };

  const handleUrlChange = (index: number, value: string) => {
    const newUrls = [...urls];
    newUrls[index] = value;
    setUrls(newUrls);
  };

  // Show loading state while config is being loaded from localStorage
  if (!isLoaded) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Panel 1: URL Input (Cyan) */}
      <Card className="bg-surface-raised/60 border-brand-primary/30 backdrop-blur-sm shadow-[0_0_20px_rgba(0,217,255,0.05)]">
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-brand-primary" />
              <Label className="text-brand-primary text-base font-mono font-semibold uppercase tracking-wider">
                Target URLs
              </Label>
            </div>
            <Button
              onClick={handleAddUrl}
              size="sm"
              data-ui-id="extraction-web-add-url-btn"
              className="bg-brand-primary/20 text-brand-primary hover:bg-brand-primary/30 border border-brand-primary/50 transition-all duration-300"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add URL
            </Button>
          </div>

          <div className="space-y-2" data-ui-id="extraction-web-urls-list">
            {urls.map((url, index) => (
              <div key={index} className="flex gap-2 group">
                <div className="relative flex-1">
                  <Input
                    type="url"
                    value={url}
                    onChange={(e) => handleUrlChange(index, e.target.value)}
                    placeholder="https://example.com"
                    data-ui-id={`extraction-web-url-input-${index}`}
                    className="bg-surface-canvas border-brand-primary/20 text-white font-mono focus:border-brand-primary focus:ring-brand-primary/30 pl-3 h-10 transition-all group-hover:border-brand-primary/40"
                  />
                </div>
                {urls.length > 1 && (
                  <Button
                    onClick={() => handleRemoveUrl(index)}
                    size="icon"
                    variant="ghost"
                    data-ui-id={`extraction-web-remove-url-${index}-btn`}
                    className="text-red-400/60 hover:text-red-400 hover:bg-red-500/10 h-10 w-10"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Panel 2: Monitor Selector (Purple) */}
      <Card className="bg-surface-raised/60 border-brand-secondary/30 backdrop-blur-sm shadow-[0_0_20px_rgba(189,0,255,0.05)]">
        <div className="p-4">
          <MonitorSelector
            monitors={selectedMonitors}
            onChange={setSelectedMonitors}
            runnerMonitors={runnerMonitors}
            isRunnerConnected={isRunnerConnected}
          />
          {/* Show resolved viewports */}
          <div className="text-[10px] text-text-muted mt-3 font-mono text-center uppercase tracking-widest">
            Resolved Viewports:{" "}
            <span className="text-brand-secondary font-bold">
              {getViewportsFromMonitors()
                .map(([w, h]) => `${w}x${h}`)
                .join(" | ")}
            </span>
          </div>
        </div>
      </Card>

      {/* Panel 3: Extraction Options (Green) */}
      <Card className="bg-surface-raised/60 border-brand-success/30 backdrop-blur-sm shadow-[0_0_20px_rgba(0,255,136,0.05)]">
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-brand-success text-base font-mono font-semibold uppercase tracking-wider">
              Extraction Options
            </Label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-surface-canvas/50 rounded-lg border border-brand-success/10 transition-all hover:border-brand-success/30 group">
                <Label
                  htmlFor="hover"
                  className="text-text-secondary text-xs font-mono tracking-tight group-hover:text-white transition-colors"
                >
                  CAPTURE HOVER STATES
                </Label>
                <Switch
                  id="hover"
                  data-ui-id="extraction-web-hover-toggle"
                  checked={captureHover}
                  onCheckedChange={setCaptureHover}
                  className="data-[state=checked]:bg-brand-success shadow-[0_0_10px_rgba(0,255,136,0.2)]"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-surface-canvas/50 rounded-lg border border-brand-success/10 transition-all hover:border-brand-success/30 group">
                <Label
                  htmlFor="focus"
                  className="text-text-secondary text-xs font-mono tracking-tight group-hover:text-white transition-colors"
                >
                  CAPTURE FOCUS STATES
                </Label>
                <Switch
                  id="focus"
                  data-ui-id="extraction-web-focus-toggle"
                  checked={captureFocus}
                  onCheckedChange={setCaptureFocus}
                  className="data-[state=checked]:bg-brand-success shadow-[0_0_10px_rgba(0,255,136,0.2)]"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label
                    htmlFor="depth"
                    className="text-text-muted text-[9px] font-mono uppercase tracking-tighter"
                  >
                    Max Crawl Depth
                  </Label>
                  <Input
                    id="depth"
                    type="number"
                    min={1}
                    max={10}
                    value={maxDepth}
                    onChange={(e) => setMaxDepth(parseInt(e.target.value) || 1)}
                    data-ui-id="extraction-web-max-depth-input"
                    className="bg-surface-canvas border-brand-success/20 text-white font-mono focus:border-brand-success focus:ring-brand-success/30 h-10 transition-all hover:border-brand-success/40"
                  />
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="pages"
                    className="text-text-muted text-[9px] font-mono uppercase tracking-tighter"
                  >
                    Max Pages Count
                  </Label>
                  <Input
                    id="pages"
                    type="number"
                    min={1}
                    max={1000}
                    value={maxPages}
                    onChange={(e) => setMaxPages(parseInt(e.target.value) || 1)}
                    data-ui-id="extraction-web-max-pages-input"
                    className="bg-surface-canvas border-brand-success/20 text-white font-mono focus:border-brand-success focus:ring-brand-success/30 h-10 transition-all hover:border-brand-success/40"
                  />
                </div>
              </div>

              <div className="p-2.5 bg-brand-success/2 border border-brand-success/10 rounded-md text-[9px] text-text-muted font-mono italic leading-relaxed">
                <span className="text-brand-success/40 mr-1">◆</span>
                Tree exploration limit. Deeper scans capture more states but
                require more resources.
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
