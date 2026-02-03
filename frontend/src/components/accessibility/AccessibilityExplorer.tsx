"use client";

import * as React from "react";
import { useState, useCallback, useEffect } from "react";
import {
  RefreshCw,
  Settings,
  Wifi,
  WifiOff,
  Copy,
  Crosshair,
  MousePointer2,
  Type,
  Focus,
  Accessibility,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { toast } from "sonner";
import { AccessibilityTreeViewer } from "./AccessibilityTreeViewer";
import { AccessibilitySelectorBuilder } from "./AccessibilitySelectorBuilder";
import { AccessibilityBoundsOverlay } from "./AccessibilityBoundsOverlay";
import { useAccessibilityTree } from "@/hooks/use-accessibility-tree";
import type {
  AccessibilityNode,
  AccessibilitySelector,
} from "@qontinui/schemas/accessibility";

interface AccessibilityExplorerProps {
  /** Callback when a selector is configured for use in automation */
  onSelectorConfigured?: (selector: AccessibilitySelector, node: AccessibilityNode) => void;
  /** Initial CDP host */
  initialCdpHost?: string;
  /** Initial CDP port */
  initialCdpPort?: number;
  /** Runner API URL */
  apiUrl?: string;
  /** Show connection settings */
  showSettings?: boolean;
  /** Additional class names */
  className?: string;
}

/**
 * AccessibilityExplorer - Complete panel for accessibility tree exploration
 *
 * Combines:
 * - CDP connection settings
 * - Tree viewer with search and filters
 * - Selector builder for creating automation selectors
 * - Quick actions (click, type, focus)
 *
 * @example
 * ```tsx
 * <AccessibilityExplorer
 *   onSelectorConfigured={(selector, node) => {
 *     console.log('Configured selector:', selector);
 *   }}
 * />
 * ```
 */
export function AccessibilityExplorer({
  onSelectorConfigured,
  initialCdpHost = "localhost",
  initialCdpPort = 9222,
  // Use 127.0.0.1 instead of localhost to force IPv4 (runner only listens on IPv4)
  apiUrl = "http://127.0.0.1:9876",
  showSettings = true,
  className,
}: AccessibilityExplorerProps) {
  // CDP connection settings
  const [cdpHost, setCdpHost] = useState(initialCdpHost);
  const [cdpPort, setCdpPort] = useState(initialCdpPort);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Selector state
  const [currentSelector, setCurrentSelector] = useState<AccessibilitySelector>({});
  const [matchCount, setMatchCount] = useState(0);

  // Quick action state
  const [actionRef, setActionRef] = useState("");
  const [actionText, setActionText] = useState("");

  // Screenshot state (for bounds overlay)
  // Note: setScreenshotUrl will be used when runner API returns screenshot data
  const [screenshotUrl, _setScreenshotUrl] = useState<string | null>(null);
  const [hoveredRef, setHoveredRef] = useState<string | null>(null);

  // Suppress unused warning - will be used when screenshot capture is added
  void _setScreenshotUrl;

  // Use the accessibility tree hook
  const {
    snapshot,
    selectedNode,
    selectedRef,
    isLoading,
    error,
    aiContext,
    capture,
    selectNode,
    clickRef,
    fillRef,
    focusRef,
    findElements,
    disconnect,
  } = useAccessibilityTree({
    apiUrl,
    cdpHost,
    cdpPort,
  });

  // Handle capture
  const handleCapture = useCallback(async () => {
    try {
      await capture();
      toast.success("Accessibility tree captured");
    } catch {
      toast.error("Failed to capture accessibility tree");
    }
  }, [capture]);

  // Handle selector test
  const handleTestSelector = useCallback(async () => {
    try {
      const matches = await findElements(currentSelector);
      setMatchCount(matches.length);
      if (matches.length === 0) {
        toast.info("No matching elements found");
      } else {
        toast.success(`Found ${matches.length} matching element(s)`);
      }
    } catch {
      toast.error("Failed to test selector");
    }
  }, [currentSelector, findElements]);

  // Handle node selection
  const handleSelectNode = useCallback(
    (node: AccessibilityNode) => {
      selectNode(node);
      setActionRef(node.ref);

      // Pre-fill selector from selected node
      setCurrentSelector({
        role: node.role,
        name: node.name || undefined,
        is_interactive: node.is_interactive || undefined,
      });
    },
    [selectNode]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // Handle use selector
  const handleUseSelector = useCallback(() => {
    if (selectedNode) {
      onSelectorConfigured?.(currentSelector, selectedNode);
      toast.success("Selector configured");
    }
  }, [currentSelector, selectedNode, onSelectorConfigured]);

  // Quick actions
  const handleQuickClick = useCallback(async () => {
    if (!actionRef) return;
    const success = await clickRef(actionRef);
    if (success) {
      toast.success(`Clicked ${actionRef}`);
    } else {
      toast.error(`Failed to click ${actionRef}`);
    }
  }, [actionRef, clickRef]);

  const handleQuickType = useCallback(async () => {
    if (!actionRef || !actionText) return;
    const success = await fillRef(actionRef, actionText);
    if (success) {
      toast.success(`Typed into ${actionRef}`);
    } else {
      toast.error(`Failed to type into ${actionRef}`);
    }
  }, [actionRef, actionText, fillRef]);

  const handleQuickFocus = useCallback(async () => {
    if (!actionRef) return;
    const success = await focusRef(actionRef);
    if (success) {
      toast.success(`Focused ${actionRef}`);
    } else {
      toast.error(`Failed to focus ${actionRef}`);
    }
  }, [actionRef, focusRef]);

  // Copy AI context
  const handleCopyAIContext = useCallback(() => {
    if (aiContext) {
      navigator.clipboard.writeText(aiContext);
      toast.success("AI context copied to clipboard");
    }
  }, [aiContext]);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border-default bg-surface-panel">
        <div className="flex items-center gap-2">
          <Accessibility className="h-5 w-5 text-purple-400" />
          <h2 className="text-sm font-semibold">Accessibility Explorer</h2>
          {snapshot && (
            <Badge variant="secondary" className="text-xs">
              {snapshot.interactive_nodes} interactive
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Connection status */}
          {snapshot ? (
            <Badge variant="outline" className="gap-1 text-xs text-green-400">
              <Wifi className="h-3 w-3" />
              Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
              <WifiOff className="h-3 w-3" />
              Disconnected
            </Badge>
          )}

          {/* Settings toggle */}
          {showSettings && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSettingsOpen(!settingsOpen)}
              className="h-7 w-7 p-0"
            >
              <Settings className="h-4 w-4" />
            </Button>
          )}

          {/* Capture button */}
          <Button
            variant="default"
            size="sm"
            onClick={handleCapture}
            disabled={isLoading}
            className="h-7 gap-1"
          >
            <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
            Capture
          </Button>
        </div>
      </div>

      {/* Settings panel (collapsible) */}
      {showSettings && (
        <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
          <CollapsibleContent>
            <div className="p-3 border-b border-border-default bg-surface-canvas/50 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">CDP Host</Label>
                  <Input
                    value={cdpHost}
                    onChange={(e) => setCdpHost(e.target.value)}
                    placeholder="localhost"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">CDP Port</Label>
                  <Input
                    type="number"
                    value={cdpPort}
                    onChange={(e) => setCdpPort(parseInt(e.target.value) || 9222)}
                    placeholder="9222"
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Start Chrome with: chrome --remote-debugging-port={cdpPort}
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Error display */}
      {error && (
        <div className="p-3 bg-destructive/10 border-b border-destructive/20 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Main content */}
      <Tabs defaultValue="tree" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-full justify-start rounded-none border-b border-border-default px-3 h-9 bg-transparent">
          <TabsTrigger value="tree" className="text-xs">
            Tree View
          </TabsTrigger>
          <TabsTrigger value="overlay" className="text-xs">
            Overlay
          </TabsTrigger>
          <TabsTrigger value="selector" className="text-xs">
            Selector
          </TabsTrigger>
          <TabsTrigger value="actions" className="text-xs">
            Quick Actions
          </TabsTrigger>
          <TabsTrigger value="context" className="text-xs">
            AI Context
          </TabsTrigger>
        </TabsList>

        {/* Tree View Tab */}
        <TabsContent value="tree" className="flex-1 m-0 min-h-0">
          <AccessibilityTreeViewer
            snapshot={snapshot}
            selectedRef={selectedRef}
            onSelectNode={handleSelectNode}
            onRefresh={handleCapture}
            isLoading={isLoading}
            className="h-full"
          />
        </TabsContent>

        {/* Overlay Tab */}
        <TabsContent value="overlay" className="flex-1 m-0 min-h-0">
          <AccessibilityBoundsOverlay
            snapshot={snapshot}
            screenshotUrl={screenshotUrl}
            selectedRef={selectedRef}
            hoveredRef={hoveredRef}
            onSelectNode={handleSelectNode}
            onHoverNode={(node) => setHoveredRef(node?.ref ?? null)}
            interactiveOnly={true}
            showLabels={true}
            className="h-full"
          />
        </TabsContent>

        {/* Selector Tab */}
        <TabsContent value="selector" className="flex-1 m-0 p-3 overflow-auto">
          <div className="space-y-4">
            <AccessibilitySelectorBuilder
              selector={currentSelector}
              onChange={setCurrentSelector}
              onTest={handleTestSelector}
              matchCount={matchCount}
              selectedNode={selectedNode}
            />

            {selectedNode && onSelectorConfigured && (
              <Button
                onClick={handleUseSelector}
                className="w-full"
                variant="default"
              >
                <Crosshair className="h-4 w-4 mr-2" />
                Use This Selector
              </Button>
            )}
          </div>
        </TabsContent>

        {/* Quick Actions Tab */}
        <TabsContent value="actions" className="flex-1 m-0 p-3 overflow-auto">
          <div className="space-y-4">
            {/* Ref input */}
            <div className="space-y-2">
              <Label className="text-xs">Target Ref</Label>
              <div className="flex gap-2">
                <Input
                  value={actionRef}
                  onChange={(e) => setActionRef(e.target.value)}
                  placeholder="@e1"
                  className="font-mono"
                />
                {selectedRef && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setActionRef(selectedRef)}
                  >
                    Use Selected
                  </Button>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                onClick={handleQuickClick}
                disabled={!actionRef || isLoading}
                className="gap-2"
              >
                <MousePointer2 className="h-4 w-4" />
                Click
              </Button>
              <Button
                variant="outline"
                onClick={handleQuickFocus}
                disabled={!actionRef || isLoading}
                className="gap-2"
              >
                <Focus className="h-4 w-4" />
                Focus
              </Button>
              <Button
                variant="outline"
                onClick={handleQuickType}
                disabled={!actionRef || !actionText || isLoading}
                className="gap-2"
              >
                <Type className="h-4 w-4" />
                Type
              </Button>
            </div>

            {/* Text input for type action */}
            <div className="space-y-2">
              <Label className="text-xs">Text to Type</Label>
              <Input
                value={actionText}
                onChange={(e) => setActionText(e.target.value)}
                placeholder="Enter text to type..."
              />
            </div>

            {/* Selected node info */}
            {selectedNode && (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Selected Element</CardTitle>
                </CardHeader>
                <CardContent className="py-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono">
                      {selectedNode.ref}
                    </Badge>
                    <Badge variant="outline">{selectedNode.role}</Badge>
                    {selectedNode.is_interactive && (
                      <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                        Interactive
                      </Badge>
                    )}
                  </div>
                  {selectedNode.name && (
                    <p className="text-sm text-muted-foreground">
                      &quot;{selectedNode.name}&quot;
                    </p>
                  )}
                  {selectedNode.value && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Value:</span> {selectedNode.value}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* AI Context Tab */}
        <TabsContent value="context" className="flex-1 m-0 p-3 overflow-auto">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">AI-Friendly Context</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyAIContext}
                disabled={!aiContext}
                className="h-7 gap-1"
              >
                <Copy className="h-3 w-3" />
                Copy
              </Button>
            </div>
            <ScrollArea className="h-[400px] rounded border border-border-default">
              <pre className="p-3 text-xs font-mono whitespace-pre-wrap">
                {aiContext || "Capture an accessibility tree to generate AI context."}
              </pre>
            </ScrollArea>
            <p className="text-xs text-muted-foreground">
              This context can be included in AI prompts for ref-based automation.
              The AI can then use commands like &quot;click @e3&quot; or &quot;type &apos;hello&apos; into @e5&quot;.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default AccessibilityExplorer;
