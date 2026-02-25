"use client";

import { useState, useCallback } from "react";
import { useRunnerHealth } from "@/lib/runner-api";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import { useInspector } from "@/hooks/use-inspector";
import type { ExternalElement, DiscoveredSpec } from "@/hooks/use-inspector";
import {
  ElementsPanel,
  ActionsPanel,
  SearchPanel,
  AccessibilityPanel,
  SpecsPanel,
  ApiPanel,
} from "@/components/inspector";
import { AppBrowser } from "@/components/shared/AppBrowser";
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
  Terminal,
  Shield,
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
    browser,
    activeTab,
    setActiveTab,
    elements,
    selectedElement,
    selectElement,
    discoverElements,
    isDiscovering,
    highlightElement,
    isConnected,
    error: currentError,
    isLoadingElements: isLoading,
  } = inspector;

  // Action form state
  const [actionType, setActionType] = useState<"click" | "type" | "focus">(
    "click"
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
    [selectElement]
  );

  // Execute action on selected element (unified SDK)
  const handleExecuteAction = useCallback(async () => {
    const el = selectedElement;
    if (!el) return;

    setIsExecutingAction(true);
    setActionResult(null);

    try {
      const result = await inspector.executeAction(
        el.id,
        actionType,
        actionType === "type" ? { text: typeText } : undefined
      );
      setActionResult({
        success: result.success,
        message: result.success
          ? `${actionType} on ${el.id} succeeded`
          : result.error || "Action failed",
      });
    } catch (err) {
      setActionResult({
        success: false,
        message: err instanceof Error ? err.message : "Action failed",
      });
    } finally {
      setIsExecutingAction(false);
    }
  }, [selectedElement, actionType, typeText, inspector]);

  // Send raw API command (SDK-based)
  const handleSendApiCommand = useCallback(async () => {
    if (!apiAction.trim()) return;
    setIsSendingApi(true);
    try {
      const params = JSON.parse(apiParams);
      await inspector.sendCommand(apiAction.trim(), params);
    } catch {
      await inspector.sendCommand(apiAction.trim(), {});
    } finally {
      setIsSendingApi(false);
    }
  }, [apiAction, apiParams, inspector]);

  // Discover specs (unified SDK)
  const handleDiscoverSpecs = useCallback(async () => {
    setIsLoadingSpecs(true);
    try {
      const specs = await inspector.discoverSpecs();
      setDiscoveredSpecs(specs);
    } catch {
      setDiscoveredSpecs([]);
    } finally {
      setIsLoadingSpecs(false);
    }
  }, [inspector]);

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

  // Handle page click in tree: navigate + re-discover elements
  const handlePageNavigate = useCallback(
    (url: string) => {
      inspector.navigateToPage(url);
    },
    [inspector]
  );

  if (healthLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      {/* Header */}
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-2">
          <div className="flex items-center gap-2">
            <ScanSearch className="w-5 h-5 text-amber-400" />
            <h1 className="text-xl font-bold bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
              Inspector
            </h1>
          </div>
          <Badge variant="success" className="gap-1.5">
            <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
            Runner Connected
          </Badge>
        </div>
      </header>

      <main className="p-4 max-w-7xl mx-auto space-y-3">
        {isOffline && (
          <RunnerPartialState message="Runner offline — this tool requires the runner for execution" />
        )}

        {/* Two-column layout: AppBrowser sidebar + Main Content */}
        <div className="flex gap-4">
          {/* Left sidebar: App Browser */}
          <div className="w-72 flex-shrink-0 space-y-3">
            <AppBrowser
              browser={browser}
              onPageClick={(url) => handlePageNavigate(url)}
              isBusy={inspector.isNavigating}
            >
              {/* Discover Elements button in custom slot */}
              {isConnected && (
                <Button
                  onClick={discoverElements}
                  disabled={isDiscovering}
                  size="sm"
                  variant="outline"
                  className="w-full h-8 text-xs"
                >
                  {isDiscovering ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Search className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Discover Elements
                  {elements.length > 0 && (
                    <span className="text-text-muted ml-1">
                      ({elements.length})
                    </span>
                  )}
                </Button>
              )}
            </AppBrowser>
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0 space-y-3">
            {/* Inspector Tabs + Refresh */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex gap-1 bg-surface-raised/50 rounded-lg p-1 border border-border-subtle/30">
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
              {activeTab === "elements" && isConnected && (
                <Button
                  size="sm"
                  onClick={discoverElements}
                  disabled={isLoading}
                  className="bg-brand-primary hover:bg-brand-primary/90 text-black font-semibold h-8"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                </Button>
              )}
            </div>

            {currentError && (
              <div className="flex items-center gap-2 text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <p className="text-sm">{currentError}</p>
              </div>
            )}

            {/* Tab Content */}
            <div className="space-y-6">
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
                  onHighlightElement={highlightElement}
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
                  commandHistory={inspector.commandHistory}
                  onClearHistory={inspector.clearCommandHistory}
                  lastResult={inspector.lastCommandResult}
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
                          Connect to an app or click &quot;Discover
                          Elements&quot; to start inspecting.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
