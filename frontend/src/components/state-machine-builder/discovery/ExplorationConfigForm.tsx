"use client";

import { useState } from "react";
import { Play, ChevronRight, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { StartExplorationRequest } from "@/lib/state-machine-builder/types";

interface ExplorationConfigFormProps {
  onStart: (request: StartExplorationRequest) => void;
  isRunning: boolean;
  extensionConnected: boolean;
}

export function ExplorationConfigForm({
  onStart,
  isRunning,
  extensionConnected,
}: ExplorationConfigFormProps) {
  const [connectionUrl, setConnectionUrl] = useState("");
  const [maxDepth, setMaxDepth] = useState(2);
  const [maxElementsPerPage, setMaxElementsPerPage] = useState(20);
  const [maxTotalElements, setMaxTotalElements] = useState(100);
  const [actionDelayMs, setActionDelayMs] = useState(500);
  const [blockedKeywords, setBlockedKeywords] = useState("");
  const [safeKeywords, setSafeKeywords] = useState("");
  const [captureScreenshots, setCaptureScreenshots] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!connectionUrl || isRunning || !extensionConnected) return;

    const request: StartExplorationRequest = {
      target_type: "web",
      connection_url: connectionUrl,
      max_depth: maxDepth,
      max_elements_per_page: maxElementsPerPage,
      max_total_elements: maxTotalElements,
      action_delay_ms: actionDelayMs,
      capture_screenshots: captureScreenshots,
      run_state_discovery: true,
    };

    const blocked = blockedKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (blocked.length > 0) request.blocked_keywords = blocked;

    const safe = safeKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (safe.length > 0) request.safe_keywords = safe;

    onStart(request);
  }

  return (
    <Card className="border-border-subtle bg-surface-raised">
      <CardHeader className="pb-4">
        <CardTitle className="text-text-primary text-base">
          Explore Web Application
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!extensionConnected && (
            <Alert variant="warning">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Chrome extension not connected. Connect the extension to explore
                web pages.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="connection-url" className="text-text-secondary">
              Connection URL
            </Label>
            <Input
              id="connection-url"
              type="url"
              placeholder="https://example.com"
              value={connectionUrl}
              onChange={(e) => setConnectionUrl(e.target.value)}
              className="bg-surface-canvas border-border-subtle text-text-primary"
            />
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 text-text-muted hover:text-text-primary px-0"
              >
                <ChevronRight
                  className={`h-4 w-4 transition-transform ${
                    advancedOpen ? "rotate-90" : ""
                  }`}
                />
                Advanced Options
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-3">
              {/* Max Depth */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-text-secondary text-xs">
                    Max Depth
                  </Label>
                  <span className="text-xs text-text-muted tabular-nums">
                    {maxDepth}
                  </span>
                </div>
                <Slider
                  value={[maxDepth]}
                  onValueChange={(vals) => setMaxDepth(vals[0] ?? 2)}
                  min={1}
                  max={10}
                  step={1}
                />
              </div>

              {/* Max Elements Per Page */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-text-secondary text-xs">
                    Max Elements Per Page
                  </Label>
                  <span className="text-xs text-text-muted tabular-nums">
                    {maxElementsPerPage}
                  </span>
                </div>
                <Slider
                  value={[maxElementsPerPage]}
                  onValueChange={(vals) => setMaxElementsPerPage(vals[0] ?? 20)}
                  min={5}
                  max={100}
                  step={5}
                />
              </div>

              {/* Max Total Elements */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-text-secondary text-xs">
                    Max Total Elements
                  </Label>
                  <span className="text-xs text-text-muted tabular-nums">
                    {maxTotalElements}
                  </span>
                </div>
                <Slider
                  value={[maxTotalElements]}
                  onValueChange={(vals) => setMaxTotalElements(vals[0] ?? 100)}
                  min={10}
                  max={500}
                  step={10}
                />
              </div>

              {/* Action Delay */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-text-secondary text-xs">
                    Action Delay (ms)
                  </Label>
                  <span className="text-xs text-text-muted tabular-nums">
                    {actionDelayMs}ms
                  </span>
                </div>
                <Slider
                  value={[actionDelayMs]}
                  onValueChange={(vals) => setActionDelayMs(vals[0] ?? 500)}
                  min={100}
                  max={2000}
                  step={100}
                />
              </div>

              {/* Blocked Keywords */}
              <div className="space-y-2">
                <Label className="text-text-secondary text-xs">
                  Blocked Keywords
                </Label>
                <Textarea
                  placeholder="logout, delete, admin (comma-separated)"
                  value={blockedKeywords}
                  onChange={(e) => setBlockedKeywords(e.target.value)}
                  className="bg-surface-canvas border-border-subtle text-text-primary min-h-[60px]"
                  rows={2}
                />
              </div>

              {/* Safe Keywords */}
              <div className="space-y-2">
                <Label className="text-text-secondary text-xs">
                  Safe Keywords
                </Label>
                <Textarea
                  placeholder="home, dashboard, settings (comma-separated)"
                  value={safeKeywords}
                  onChange={(e) => setSafeKeywords(e.target.value)}
                  className="bg-surface-canvas border-border-subtle text-text-primary min-h-[60px]"
                  rows={2}
                />
              </div>

              {/* Capture Screenshots */}
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="capture-screenshots"
                  className="text-text-secondary text-xs"
                >
                  Capture Screenshots
                </Label>
                <Switch
                  id="capture-screenshots"
                  checked={captureScreenshots}
                  onCheckedChange={setCaptureScreenshots}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Button
            type="submit"
            variant="brand-primary"
            className="w-full"
            disabled={!connectionUrl || isRunning || !extensionConnected}
          >
            <Play className="h-4 w-4" />
            Start Exploration
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
