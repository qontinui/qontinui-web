"use client";

import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccessibilityTreeViewer } from "./AccessibilityTreeViewer";
import { AccessibilityBoundsOverlay } from "./AccessibilityBoundsOverlay";
import { useAccessibilityExplorer } from "./_hooks/use-accessibility-explorer";
import { ExplorerHeader } from "./_components/ExplorerHeader";
import { ConnectionSettings } from "./_components/ConnectionSettings";
import { SelectorTab } from "./_components/SelectorTab";
import { QuickActionsTab } from "./_components/QuickActionsTab";
import { AIContextTab } from "./_components/AIContextTab";
import type { AccessibilityExplorerProps } from "./types";

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
  const explorer = useAccessibilityExplorer({
    apiUrl,
    cdpHost: initialCdpHost,
    cdpPort: initialCdpPort,
    onSelectorConfigured,
  });

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <ExplorerHeader
        snapshot={explorer.snapshot}
        isLoading={explorer.isLoading}
        showSettings={showSettings}
        onToggleSettings={() =>
          explorer.setSettingsOpen(!explorer.settingsOpen)
        }
        onCapture={explorer.handleCapture}
      />

      {/* Settings panel (collapsible) */}
      {showSettings && (
        <ConnectionSettings
          open={explorer.settingsOpen}
          onOpenChange={explorer.setSettingsOpen}
          cdpHost={explorer.cdpHost}
          cdpPort={explorer.cdpPort}
          onHostChange={explorer.setCdpHost}
          onPortChange={explorer.setCdpPort}
        />
      )}

      {/* Error display */}
      {explorer.error && (
        <div className="p-3 bg-destructive/10 border-b border-destructive/20 text-destructive text-sm">
          {explorer.error}
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
            snapshot={explorer.snapshot}
            selectedRef={explorer.selectedRef}
            onSelectNode={explorer.handleSelectNode}
            onRefresh={explorer.handleCapture}
            isLoading={explorer.isLoading}
            className="h-full"
          />
        </TabsContent>

        {/* Overlay Tab */}
        <TabsContent value="overlay" className="flex-1 m-0 min-h-0">
          <AccessibilityBoundsOverlay
            snapshot={explorer.snapshot}
            screenshotUrl={explorer.screenshotUrl}
            selectedRef={explorer.selectedRef}
            hoveredRef={explorer.hoveredRef}
            onSelectNode={explorer.handleSelectNode}
            onHoverNode={(node) => explorer.setHoveredRef(node?.ref ?? null)}
            interactiveOnly={true}
            showLabels={true}
            className="h-full"
          />
        </TabsContent>

        {/* Selector Tab */}
        <TabsContent value="selector" className="flex-1 m-0 p-3 overflow-auto">
          <SelectorTab
            currentSelector={explorer.currentSelector}
            onSelectorChange={explorer.setCurrentSelector}
            onTestSelector={explorer.handleTestSelector}
            matchCount={explorer.matchCount}
            selectedNode={explorer.selectedNode}
            showUseButton={!!onSelectorConfigured}
            onUseSelector={explorer.handleUseSelector}
          />
        </TabsContent>

        {/* Quick Actions Tab */}
        <TabsContent value="actions" className="flex-1 m-0 p-3 overflow-auto">
          <QuickActionsTab
            actionRef={explorer.actionRef}
            onActionRefChange={explorer.setActionRef}
            actionText={explorer.actionText}
            onActionTextChange={explorer.setActionText}
            selectedRef={explorer.selectedRef}
            selectedNode={explorer.selectedNode}
            isLoading={explorer.isLoading}
            onQuickClick={explorer.handleQuickClick}
            onQuickFocus={explorer.handleQuickFocus}
            onQuickType={explorer.handleQuickType}
          />
        </TabsContent>

        {/* AI Context Tab */}
        <TabsContent value="context" className="flex-1 m-0 p-3 overflow-auto">
          <AIContextTab
            aiContext={explorer.aiContext}
            onCopyContext={explorer.handleCopyAIContext}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default AccessibilityExplorer;
