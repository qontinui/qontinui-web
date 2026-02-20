"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
import { useRunnerHealth } from "@/lib/runner-api";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import { useInspector } from "@/hooks/use-inspector";
import type {
  ExternalElement,
  DiscoveredSpec,
} from "@/hooks/use-external-ui-bridge";
import {
  ConnectionPanel,
  ElementsPanel,
  ActionsPanel,
  SearchPanel,
  AccessibilityPanel,
  SpecsPanel,
  ApiPanel,
} from "@/components/inspector";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Search,
  RefreshCw,
  Box,
  Play,
  AlertCircle,
  Layers,
  Plug,
  Terminal,
  Shield,
  Camera,
  ScanSearch,
  Accessibility,
} from "lucide-react";
import type { SpecConfig as SpecConfigType } from "@qontinui/ui-bridge/specs";
import pageSpecJson from "./inspector.spec.uibridge.json";

const pageSpec = pageSpecJson as unknown as SpecConfigType;

type InspectorTab =
  | "elements"
  | "actions"
  | "accessibility"
  | "search"
  | "specs"
  | "api";

const TAB_CONFIG: Array<{
  key: InspectorTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "elements", label: "Elements", icon: Box },
  { key: "actions", label: "Actions", icon: Play },
  { key: "accessibility", label: "Accessibility", icon: Accessibility },
  { key: "search", label: "Search", icon: Search },
  { key: "specs", label: "Specs", icon: Shield },
  { key: "api", label: "API", icon: Terminal },
];

export default function InspectorPage() {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  usePageSpecs({ inspector: pageSpec });

  const inspector = useInspector();
  const {
    activeSource,
    activeTab,
    setActiveTab,
    bridge,
    desktop,
    elements,
    selectedElement,
    selectElement,
    isConnected,
    error: currentError,
    isLoadingElements: isLoading,
  } = inspector;

  // Action form state
  const [actionType, setActionType] = useState<"click" | "type" | "focus">(
    "click",
  );
  const [typeText, setTypeText] = useState("");
  const [actionResult, setActionResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [isExecutingAction, setIsExecutingAction] = useState(false);

  // Search state
  const [controlSearch, setControlSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFilter, setSearchFilter] = useState<
    "all" | "interactive" | "visible"
  >("all");

  // API tab state
  const [apiAction, setApiAction] = useState("");
  const [apiParams, setApiParams] = useState("{}");
  const [isSendingApi, setIsSendingApi] = useState(false);

  // Spec tab state
  const [discoveredSpecs, setDiscoveredSpecs] = useState<DiscoveredSpec[]>([]);
  const [isLoadingSpecs, setIsLoadingSpecs] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Filter elements based on search and filters
  const filteredElements = elements.filter((el) => {
    if (searchFilter === "interactive" && !el.is_interactive && !el.interactive)
      return false;
    if (searchFilter === "visible" && el.visible === false) return false;

    const query = activeTab === "search" ? searchQuery : controlSearch;
    if (!query.trim()) return true;
    const lower = query.toLowerCase();
    return (
      el.id?.toLowerCase().includes(lower) ||
      el.type?.toLowerCase().includes(lower) ||
      el.text?.toLowerCase().includes(lower) ||
      (el.tagName as string)?.toLowerCase().includes(lower) ||
      el.role?.toLowerCase().includes(lower) ||
      el.label?.toLowerCase().includes(lower)
    );
  });

  // Element selection handler
  const handleSelectElement = useCallback(
    (el: ExternalElement) => {
      selectElement(el);
    },
    [selectElement],
  );

  // Execute action on selected element
  const handleExecuteAction = useCallback(async () => {
    const el = selectedElement;
    if (!el) return;

    setIsExecutingAction(true);
    setActionResult(null);

    try {
      if (activeSource === "desktop") {
        const result = await desktop.executeAction(
          el.id,
          actionType,
          actionType === "type" ? { text: typeText } : undefined,
        );
        setActionResult({
          success: result.success,
          message: result.success
            ? `${actionType} on ${el.id} succeeded`
            : result.error || "Action failed",
        });
      } else {
        const result = await bridge.executeAction(
          el.id,
          actionType,
          actionType === "type" ? { text: typeText } : {},
        );
        setActionResult({
          success: result.success,
          message: result.success
            ? `${actionType} on ${el.id} succeeded`
            : result.error || "Action failed",
        });
      }
    } catch (err) {
      setActionResult({
        success: false,
        message: err instanceof Error ? err.message : "Action failed",
      });
    } finally {
      setIsExecutingAction(false);
    }
  }, [selectedElement, activeSource, actionType, typeText, bridge, desktop]);

  // Send raw API command
  const handleSendApiCommand = useCallback(async () => {
    if (!apiAction.trim()) return;
    setIsSendingApi(true);
    try {
      const params = JSON.parse(apiParams);
      await bridge.sendCommand(apiAction.trim(), params);
    } catch {
      await bridge.sendCommand(apiAction.trim(), {});
    } finally {
      setIsSendingApi(false);
    }
  }, [apiAction, apiParams, bridge]);

  // Discover specs (source-aware)
  const handleDiscoverSpecs = useCallback(async () => {
    setIsLoadingSpecs(true);
    try {
      if (activeSource === "browser") {
        const result = await bridge.getSpecs();
        if (result.success && result.data?.specs) {
          setDiscoveredSpecs(result.data.specs);
        }
      } else {
        const specs = await desktop.discoverSpecs();
        setDiscoveredSpecs(specs);
      }
    } catch {
      setDiscoveredSpecs([]);
    } finally {
      setIsLoadingSpecs(false);
    }
  }, [activeSource, bridge, desktop]);

  // Export spec as JSON
  const handleExportSpec = useCallback((spec: DiscoveredSpec) => {
    const json = JSON.stringify(spec.config, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${spec.specId}.spec.uibridge.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // Toggle spec group expansion
  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  if (healthLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      {/* Header */}
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <ScanSearch className="w-6 h-6 text-amber-400" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
              Inspector
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {bridge.isExtensionConnected && (
              <Badge variant="info" className="gap-1.5">
                <Plug className="w-3 h-3" />
                Extension Connected
              </Badge>
            )}
            <Badge variant="success" className="gap-1.5">
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              Runner Connected
            </Badge>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto space-y-6">
        {isOffline && (
          <RunnerPartialState message="Runner offline — this tool requires the runner for execution" />
        )}

        {/* Connection Panel */}
        <ConnectionPanel
          activeSource={activeSource}
          bridge={bridge}
          desktop={desktop}
        />

        {/* Inspector Tabs */}
        <div className="flex gap-1 bg-surface-raised/50 rounded-lg p-1 border border-border-subtle/30 w-fit">
          {TAB_CONFIG.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === key
                  ? "bg-purple-600/20 text-purple-400"
                  : "text-text-muted hover:text-white hover:bg-surface-hover"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Elements tab: refresh button */}
        {activeTab === "elements" && activeSource && (
          <div className="flex items-center gap-3">
            <Button
              onClick={
                activeSource === "desktop"
                  ? desktop.discover
                  : bridge.refreshElements
              }
              disabled={isLoading}
              className="bg-brand-primary hover:bg-brand-primary/90 text-black font-semibold"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh Elements
                </>
              )}
            </Button>
            {elements.length > 0 && (
              <span className="text-sm text-text-muted">
                {elements.length} element{elements.length !== 1 ? "s" : ""}{" "}
                found
                {activeSource === "desktop" ? " (Desktop)" : " (Browser)"}
              </span>
            )}
            {activeSource === "browser" &&
              bridge.connectionStatus === "connected" && (
                <Button
                  onClick={bridge.capturePageScreenshot}
                  disabled={bridge.isCapturingScreenshot}
                  size="sm"
                  variant="outline"
                >
                  {bridge.isCapturingScreenshot ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Camera className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Screenshot
                </Button>
              )}
          </div>
        )}

        {currentError && (
          <div className="flex items-center gap-2 text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <p className="text-sm">{currentError}</p>
          </div>
        )}

        {/* Tab Content */}
        {activeTab === "elements" && (
          <ElementsPanel
            elements={elements}
            filteredElements={filteredElements}
            selectedElement={selectedElement}
            onSelectElement={handleSelectElement}
            searchQuery={controlSearch}
            onSearchChange={setControlSearch}
          />
        )}

        {activeTab === "actions" && (
          <ActionsPanel
            selectedElement={selectedElement}
            actionType={actionType}
            onActionTypeChange={setActionType}
            typeText={typeText}
            onTypeTextChange={setTypeText}
            actionResult={actionResult}
            isExecutingAction={isExecutingAction}
            onExecuteAction={handleExecuteAction}
            targetType={activeSource === "desktop" ? "desktop" : "browser"}
            onHighlightElement={
              activeSource === "browser" ? bridge.highlightElement : undefined
            }
          />
        )}

        {activeTab === "accessibility" && <AccessibilityPanel />}

        {activeTab === "search" && (
          <SearchPanel
            elements={elements}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchFilter={searchFilter}
            onFilterChange={setSearchFilter}
            filteredElements={filteredElements}
            selectedElement={selectedElement}
            onSelectElement={handleSelectElement}
          />
        )}

        {activeTab === "specs" && (
          <SpecsPanel
            discoveredSpecs={discoveredSpecs}
            isLoading={isLoadingSpecs}
            onDiscover={handleDiscoverSpecs}
            onExport={handleExportSpec}
            expandedGroups={expandedGroups}
            onToggleGroup={toggleGroup}
            targetType={activeSource === "desktop" ? "desktop" : "browser"}
            isConnected={isConnected}
          />
        )}

        {activeTab === "api" && (
          <ApiPanel
            apiAction={apiAction}
            onApiActionChange={setApiAction}
            apiParams={apiParams}
            onApiParamsChange={setApiParams}
            isSending={isSendingApi}
            onSend={handleSendApiCommand}
            commandHistory={bridge.commandHistory}
            onClearHistory={bridge.clearCommandHistory}
            lastResult={bridge.lastCommandResult}
          />
        )}

        {/* Empty state for elements tab */}
        {activeTab === "elements" &&
          elements.length === 0 &&
          !currentError &&
          !isLoading && (
            <Card className="bg-surface-raised/50 border-border-subtle/50">
              <CardContent className="py-12">
                <div className="text-center">
                  <Layers className="w-12 h-12 mx-auto mb-4 text-text-muted" />
                  <h3 className="text-lg font-medium text-text-secondary mb-2">
                    No Elements Loaded
                  </h3>
                  <p className="text-sm text-text-muted max-w-md mx-auto">
                    Connect to a browser tab or click &quot;Discover
                    Elements&quot; on the Desktop panel above to start
                    inspecting.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

        {/* Screenshot preview */}
        {bridge.pageScreenshot && (
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-3">
                <Camera className="w-4 h-4 text-white" />
                <h3 className="text-base font-semibold text-white">
                  Page Screenshot
                </h3>
              </div>
              <div className="relative max-h-[400px] overflow-auto rounded-lg border border-border-subtle/30">
                <Image
                  src={`data:image/png;base64,${bridge.pageScreenshot.data}`}
                  alt="Page screenshot"
                  width={0}
                  height={0}
                  sizes="100vw"
                  style={{ width: "100%", height: "auto" }}
                  unoptimized
                />
              </div>
              <p className="text-xs text-text-muted mt-2">
                {bridge.pageScreenshot.viewport.width}x
                {bridge.pageScreenshot.viewport.height} — captured{" "}
                {new Date(
                  bridge.pageScreenshot.capturedAt,
                ).toLocaleTimeString()}
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
