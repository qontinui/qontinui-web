/**
 * Extraction Config Panel Component
 *
 * Allows users to configure web extraction settings:
 * - Input URLs to crawl
 * - Configure viewports (responsive testing)
 * - Toggle hover/focus state capture
 * - Set crawl depth and page limits
 * - Add authentication cookies
 */

"use client";

import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Plus, X, Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ExtractionSessionCreate } from "@/services/extraction-service";

interface ExtractionConfigPanelProps {
  onStartExtraction: (config: ExtractionSessionCreate) => Promise<void>;
  isRunning: boolean;
}

// Common viewport presets
const VIEWPORT_PRESETS = [
  { name: "Desktop HD", width: 1920, height: 1080 },
  { name: "Desktop", width: 1366, height: 768 },
  { name: "Laptop", width: 1280, height: 720 },
  { name: "Tablet", width: 768, height: 1024 },
  { name: "Mobile", width: 375, height: 667 },
];

export function ExtractionConfigPanel({
  onStartExtraction,
  isRunning,
}: ExtractionConfigPanelProps) {
  const [urls, setUrls] = useState<string[]>([""]);
  const [viewports, setViewports] = useState<Array<[number, number]>>([
    [1920, 1080],
  ]);
  const [captureHover, setCaptureHover] = useState(true);
  const [captureFocus, setCaptureFocus] = useState(true);
  const [maxDepth, setMaxDepth] = useState(5);
  const [maxPages, setMaxPages] = useState(100);
  const [customViewportWidth, setCustomViewportWidth] = useState("");
  const [customViewportHeight, setCustomViewportHeight] = useState("");

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

  const handleAddViewport = (width: number, height: number) => {
    // Check if viewport already exists
    const exists = viewports.some(([w, h]) => w === width && h === height);
    if (exists) {
      toast.error("Viewport already added");
      return;
    }
    setViewports([...viewports, [width, height]]);
    toast.success(`Added ${width}x${height} viewport`);
  };

  const handleAddCustomViewport = () => {
    const width = parseInt(customViewportWidth);
    const height = parseInt(customViewportHeight);

    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
      toast.error("Invalid viewport dimensions");
      return;
    }

    handleAddViewport(width, height);
    setCustomViewportWidth("");
    setCustomViewportHeight("");
  };

  const handleRemoveViewport = (index: number) => {
    if (viewports.length === 1) {
      toast.error("At least one viewport is required");
      return;
    }
    setViewports(viewports.filter((_, i) => i !== index));
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
      } catch (e) {
        toast.error(`Invalid URL: ${url}`);
        return;
      }
    }

    const config: ExtractionSessionCreate = {
      source_urls: validUrls,
      config: {
        viewports,
        capture_hover_states: captureHover,
        capture_focus_states: captureFocus,
        max_depth: maxDepth,
        max_pages: maxPages,
        auth_cookies: {},
      },
    };

    try {
      await onStartExtraction(config);
    } catch (error) {
      console.error("Failed to start extraction:", error);
      toast.error("Failed to start extraction");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Extraction Configuration</CardTitle>
        <CardDescription>
          Configure URLs and settings for web extraction
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

        {/* Viewports Section */}
        <div className="space-y-3">
          <Label className="text-base font-semibold">Viewports</Label>

          {/* Current Viewports */}
          <div className="flex flex-wrap gap-2">
            {viewports.map(([width, height], index) => (
              <Badge
                key={index}
                variant="secondary"
                className="flex items-center gap-2 px-3 py-1"
              >
                {width}x{height}
                {viewports.length > 1 && (
                  <button
                    onClick={() => handleRemoveViewport(index)}
                    className="hover:text-destructive"
                    disabled={isRunning}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
          </div>

          {/* Viewport Presets */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              Quick Add Presets
            </Label>
            <div className="flex flex-wrap gap-2">
              {VIEWPORT_PRESETS.map((preset) => (
                <Button
                  key={preset.name}
                  onClick={() => handleAddViewport(preset.width, preset.height)}
                  variant="outline"
                  size="sm"
                  disabled={isRunning}
                >
                  {preset.name}
                </Button>
              ))}
            </div>
          </div>

          {/* Custom Viewport */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              Custom Viewport
            </Label>
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="Width"
                value={customViewportWidth}
                onChange={(e) => setCustomViewportWidth(e.target.value)}
                className="w-24"
                disabled={isRunning}
              />
              <span className="flex items-center text-muted-foreground">x</span>
              <Input
                type="number"
                placeholder="Height"
                value={customViewportHeight}
                onChange={(e) => setCustomViewportHeight(e.target.value)}
                className="w-24"
                disabled={isRunning}
              />
              <Button
                onClick={handleAddCustomViewport}
                variant="outline"
                size="sm"
                disabled={isRunning}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>
          </div>
        </div>

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
