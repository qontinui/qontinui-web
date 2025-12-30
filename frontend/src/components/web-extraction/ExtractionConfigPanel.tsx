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

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  X,
  Globe,
  Loader2,
  Monitor,
  Check,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { useRunnerMonitors } from "@/hooks/useRunnerMonitors";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ExtractionSessionCreate } from "@/services/extraction-service";
import type { useExtractionConfig } from "@/hooks/use-extraction-config";

interface ExtractionConfigPanelProps {
  onStartExtraction: (config: ExtractionSessionCreate) => Promise<void>;
  isRunning: boolean;
  extractionConfig: ReturnType<typeof useExtractionConfig>;
}

// Default viewport size when monitor resolution is not available
const DEFAULT_VIEWPORT: [number, number] = [1920, 1080];

export function ExtractionConfigPanel({
  onStartExtraction,
  isRunning,
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

  // Sort monitors by x position (left to right) for correct visual display
  const sortedMonitors = [...runnerMonitors].sort((a, b) => a.x - b.x);

  // Toggle monitor selection
  const handleMonitorClick = (monitorIndex: number) => {
    if (selectedMonitors.includes(monitorIndex)) {
      // Don't allow deselecting if it's the only one selected
      if (selectedMonitors.length > 1) {
        setSelectedMonitors(selectedMonitors.filter((i) => i !== monitorIndex));
      } else {
        toast.error("At least one monitor must be selected");
      }
    } else {
      setSelectedMonitors(
        [...selectedMonitors, monitorIndex].sort((a, b) => a - b)
      );
    }
  };

  // Select all monitors
  const handleSelectAllMonitors = () => {
    setSelectedMonitors(sortedMonitors.map((m) => m.index));
  };

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

  const handleStartExtraction = async () => {
    // Validate URLs
    const validUrls = urls.filter((url) => url.trim().length > 0);
    if (validUrls.length === 0) {
      toast.error("At least one valid URL is required");
      return;
    }

    // Basic URL validation
    for (const url of validUrls) {
      try {
        new URL(url);
      } catch (_e) {
        toast.error(`Invalid URL: ${url}`);
        return;
      }
    }

    const extractionSessionConfig: ExtractionSessionCreate = {
      source_urls: validUrls,
      config: {
        viewports: getViewportsFromMonitors(),
        capture_hover_states: captureHover,
        capture_focus_states: captureFocus,
        max_depth: maxDepth,
        max_pages: maxPages,
        auth_cookies: {},
      },
    };

    try {
      await onStartExtraction(extractionSessionConfig);
    } catch (error) {
      console.error("Failed to start extraction:", error);
      toast.error("Failed to start extraction");
    }
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
    <Card>
      <CardHeader className="pb-4">
        <CardTitle>Extraction Configuration</CardTitle>
        <CardDescription>
          Configure URLs and settings for web extraction. Settings are saved
          automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* URLs Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">URLs to Extract</Label>
            <Button
              onClick={handleAddUrl}
              variant="outline"
              size="sm"
              disabled={isRunning}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          </div>

          <div className="space-y-1.5">
            {urls.map((url, index) => (
              <div key={index} className="flex gap-2">
                <div className="relative max-w-lg flex-1">
                  <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="url"
                    placeholder="https://example.com"
                    value={url}
                    onChange={(e) => handleUrlChange(index, e.target.value)}
                    className="pl-8 h-9 text-sm"
                    disabled={isRunning}
                  />
                </div>
                {urls.length > 1 && (
                  <Button
                    onClick={() => handleRemoveUrl(index)}
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    disabled={isRunning}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* Two-column grid for Options and Monitors */}
        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-4">
          {/* Left Column: Options + Button */}
          <div className="space-y-3">
            <div className="flex gap-3">
              {/* Capture Options Card */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <Label className="text-sm font-semibold">Capture Options</Label>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="capture-hover"
                      checked={captureHover}
                      onCheckedChange={setCaptureHover}
                      disabled={isRunning}
                    />
                    <Label htmlFor="capture-hover" className="text-sm">
                      Hover States
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="capture-focus"
                      checked={captureFocus}
                      onCheckedChange={setCaptureFocus}
                      disabled={isRunning}
                    />
                    <Label htmlFor="capture-focus" className="text-sm">
                      Focus States
                    </Label>
                  </div>
                </div>
              </div>

              {/* Crawl Limits Card */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <Label className="text-sm font-semibold">Crawl Limits</Label>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label
                      htmlFor="max-depth"
                      className="text-xs text-muted-foreground"
                    >
                      Max Depth
                    </Label>
                    <Input
                      id="max-depth"
                      type="number"
                      min={1}
                      max={10}
                      value={maxDepth}
                      onChange={(e) =>
                        setMaxDepth(parseInt(e.target.value) || 1)
                      }
                      disabled={isRunning}
                      className="h-8 text-sm w-24"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label
                      htmlFor="max-pages"
                      className="text-xs text-muted-foreground"
                    >
                      Max Pages
                    </Label>
                    <Input
                      id="max-pages"
                      type="number"
                      min={1}
                      max={1000}
                      value={maxPages}
                      onChange={(e) =>
                        setMaxPages(parseInt(e.target.value) || 1)
                      }
                      disabled={isRunning}
                      className="h-8 text-sm w-24"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Start Button - under both containers */}
            <Button onClick={handleStartExtraction} disabled={isRunning}>
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Extraction Running...
                </>
              ) : (
                <>
                  <Globe className="mr-2 h-4 w-4" />
                  Start Extraction
                </>
              )}
            </Button>
          </div>

          {/* Right Column: Monitors */}
          <TooltipProvider>
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-semibold">Target Monitors</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help">
                      {isRunnerConnected ? (
                        <Wifi className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <WifiOff className="w-3.5 h-3.5 text-gray-500" />
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isRunnerConnected
                      ? `Connected to runner (${runnerMonitors.length} monitors detected)`
                      : "Runner not connected - using default monitors"}
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Monitor Cards */}
              <div className="flex flex-wrap gap-2">
                {sortedMonitors.map((monitor) => {
                  const isSelected = selectedMonitors.includes(monitor.index);
                  return (
                    <button
                      key={monitor.index}
                      onClick={() => handleMonitorClick(monitor.index)}
                      disabled={isRunning}
                      className={`flex flex-col items-center gap-0.5 p-2 rounded-md border-2 transition-all min-w-[80px] ${
                        isSelected
                          ? "bg-primary/10 border-primary text-primary ring-1 ring-primary/30"
                          : "bg-background border-muted-foreground/20 text-muted-foreground hover:border-primary/50 hover:bg-muted"
                      } ${isRunning ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <div className="flex items-center gap-1">
                        <Monitor className="w-4 h-4" />
                        <span className="font-medium text-sm">
                          [{monitor.index}]
                        </span>
                        {isSelected && <Check className="w-3 h-3" />}
                      </div>
                      <div className="text-[10px] text-center leading-tight">
                        {monitor.is_primary && (
                          <div className="text-green-500 font-medium">
                            Primary
                          </div>
                        )}
                        <div className="text-muted-foreground">
                          {monitor.width}x{monitor.height}
                        </div>
                      </div>
                    </button>
                  );
                })}

                {/* All button when multiple monitors available */}
                {sortedMonitors.length > 1 && (
                  <button
                    onClick={handleSelectAllMonitors}
                    disabled={isRunning}
                    className={`flex flex-col items-center justify-center gap-0.5 p-2 rounded-md border-2 transition-all min-w-[80px] ${
                      selectedMonitors.length === sortedMonitors.length
                        ? "bg-primary/10 border-primary text-primary ring-1 ring-primary/30"
                        : "bg-background border-muted-foreground/20 text-muted-foreground hover:border-primary/50 hover:bg-muted"
                    } ${isRunning ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <div className="flex items-center gap-1">
                      <Monitor className="w-4 h-4" />
                      <span className="font-medium text-sm">All</span>
                      {selectedMonitors.length === sortedMonitors.length && (
                        <Check className="w-3 h-3" />
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {sortedMonitors.length} monitors
                    </div>
                  </button>
                )}
              </div>

              {/* Show resolved viewports */}
              <div className="text-[10px] text-muted-foreground">
                Viewports:{" "}
                {getViewportsFromMonitors()
                  .map(([w, h]) => `${w}x${h}`)
                  .join(", ")}
              </div>
            </div>
          </TooltipProvider>
        </div>
      </CardContent>
    </Card>
  );
}
