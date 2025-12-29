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
      <CardHeader>
        <CardTitle>Extraction Configuration</CardTitle>
        <CardDescription>
          Configure URLs and settings for web extraction. Settings are saved
          automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* URLs Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">URLs to Extract</Label>
            <Button
              onClick={handleAddUrl}
              variant="outline"
              size="sm"
              disabled={isRunning}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add URL
            </Button>
          </div>

          <div className="space-y-2">
            {urls.map((url, index) => (
              <div key={index} className="flex gap-2">
                <div className="relative flex-1">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="url"
                    placeholder="https://example.com"
                    value={url}
                    onChange={(e) => handleUrlChange(index, e.target.value)}
                    className="pl-9"
                    disabled={isRunning}
                  />
                </div>
                {urls.length > 1 && (
                  <Button
                    onClick={() => handleRemoveUrl(index)}
                    variant="ghost"
                    size="icon"
                    disabled={isRunning}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* Monitors Section */}
        <TooltipProvider>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Label className="text-base font-semibold">Target Monitors</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help">
                    {isRunnerConnected ? (
                      <Wifi className="w-4 h-4 text-green-500" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-gray-500" />
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
            <p className="text-sm text-muted-foreground">
              Select monitors to capture. The viewport size will match each
              monitor&apos;s resolution.
            </p>

            {/* Monitor Cards */}
            <div className="flex flex-wrap gap-3">
              {sortedMonitors.map((monitor) => {
                const isSelected = selectedMonitors.includes(monitor.index);
                return (
                  <button
                    key={monitor.index}
                    onClick={() => handleMonitorClick(monitor.index)}
                    disabled={isRunning}
                    className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all min-w-[100px] ${
                      isSelected
                        ? "bg-primary/10 border-primary text-primary ring-2 ring-primary/30"
                        : "bg-muted/50 border-muted-foreground/20 text-muted-foreground hover:border-primary/50 hover:bg-muted"
                    } ${isRunning ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Monitor className="w-5 h-5" />
                      <span className="font-semibold text-base">
                        [{monitor.index}]
                      </span>
                      {isSelected && <Check className="w-4 h-4" />}
                    </div>
                    <div className="text-xs space-y-0.5 text-center">
                      {monitor.is_primary && (
                        <div className="text-green-500 font-medium">
                          Primary
                        </div>
                      )}
                      <div className="capitalize">{monitor.position}</div>
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
                  className={`flex flex-col items-center justify-center gap-1 p-3 rounded-lg border-2 transition-all min-w-[100px] ${
                    selectedMonitors.length === sortedMonitors.length
                      ? "bg-primary/10 border-primary text-primary ring-2 ring-primary/30"
                      : "bg-muted/50 border-muted-foreground/20 text-muted-foreground hover:border-primary/50 hover:bg-muted"
                  } ${isRunning ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <div className="flex items-center gap-1.5">
                    <Monitor className="w-5 h-5" />
                    <span className="font-semibold text-base">All</span>
                    {selectedMonitors.length === sortedMonitors.length && (
                      <Check className="w-4 h-4" />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {sortedMonitors.length} monitors
                  </div>
                </button>
              )}
            </div>

            {/* Show resolved viewports */}
            <div className="text-xs text-muted-foreground">
              Viewports:{" "}
              {getViewportsFromMonitors()
                .map(([w, h]) => `${w}x${h}`)
                .join(", ")}
            </div>
          </div>
        </TooltipProvider>

        <Separator />

        {/* Capture Options */}
        <div className="space-y-4">
          <Label className="text-base font-semibold">Capture Options</Label>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="capture-hover">Capture Hover States</Label>
                <p className="text-xs text-muted-foreground">
                  Detect elements with hover interactions
                </p>
              </div>
              <Switch
                id="capture-hover"
                checked={captureHover}
                onCheckedChange={setCaptureHover}
                disabled={isRunning}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="capture-focus">Capture Focus States</Label>
                <p className="text-xs text-muted-foreground">
                  Detect elements with focus interactions
                </p>
              </div>
              <Switch
                id="capture-focus"
                checked={captureFocus}
                onCheckedChange={setCaptureFocus}
                disabled={isRunning}
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Crawl Limits */}
        <div className="space-y-4">
          <Label className="text-base font-semibold">Crawl Limits</Label>

          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="max-depth">Maximum Depth</Label>
                <span className="text-sm text-muted-foreground">
                  {maxDepth}
                </span>
              </div>
              <Input
                id="max-depth"
                type="number"
                min={1}
                max={10}
                value={maxDepth}
                onChange={(e) => setMaxDepth(parseInt(e.target.value) || 1)}
                disabled={isRunning}
              />
              <p className="text-xs text-muted-foreground">
                How many levels deep to crawl links
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="max-pages">Maximum Pages</Label>
                <span className="text-sm text-muted-foreground">
                  {maxPages}
                </span>
              </div>
              <Input
                id="max-pages"
                type="number"
                min={1}
                max={1000}
                value={maxPages}
                onChange={(e) => setMaxPages(parseInt(e.target.value) || 1)}
                disabled={isRunning}
              />
              <p className="text-xs text-muted-foreground">
                Maximum number of pages to extract
              </p>
            </div>
          </div>
        </div>

        <Separator />

        {/* Start Button */}
        <Button
          onClick={handleStartExtraction}
          disabled={isRunning}
          className="w-full"
          size="lg"
        >
          {isRunning ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Extraction Running...
            </>
          ) : (
            <>
              <Globe className="mr-2 h-5 w-5" />
              Start Extraction
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
