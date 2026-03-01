"use client";

import React from "react";
import { ChevronDown, ChevronRight, ShieldCheck, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useSpecSourceState } from "./_hooks/useSpecSourceState";
import { ConnectionBar } from "./_components/ConnectionBar";
import { SpecGroupList } from "./_components/SpecGroupList";
import { PromptPreview } from "./_components/PromptPreview";

// Re-export types for external consumers
export type {
  DiscoveredPage,
  SpecSourceState,
  SpecSourceSectionProps,
} from "./spec-source-types";

export function SpecSourceSection({
  onSpecsChanged,
}: {
  onSpecsChanged: (
    state: import("./spec-source-types").SpecSourceState
  ) => void;
}) {
  const state = useSpecSourceState(onSpecsChanged);

  return (
    <Collapsible open={state.isOpen} onOpenChange={state.setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
        {state.isOpen ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        <ShieldCheck className="w-4 h-4" />
        Page Specs
        {state.selectedCount > 0 && (
          <Badge variant="secondary" className="text-xs ml-1">
            {state.selectedCount} group{state.selectedCount !== 1 ? "s" : ""}
          </Badge>
        )}
        {state.browser.isConnected && (
          <span className="flex items-center gap-1 text-xs text-green-400 ml-auto">
            <Wifi className="w-3 h-3" />
            {state.browser.connectedAppName}
          </span>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-3 space-y-3">
        <ConnectionBar
          browser={state.browser}
          isDiscovering={state.isDiscovering}
          isCrawling={state.isCrawling}
          crawlProgress={state.crawlProgress}
          manualUrl={state.manualUrl}
          setManualUrl={state.setManualUrl}
          showManualConnect={state.showManualConnect}
          setShowManualConnect={state.setShowManualConnect}
          onDiscoverSpecs={state.handleDiscoverSpecs}
          onDiscoverAllPages={state.handleDiscoverAllPages}
          onManualConnect={state.handleManualConnect}
        />

        {state.discoveredSpecs.length > 0 && (
          <SpecGroupList
            selectedCount={state.selectedCount}
            totalGroups={state.totalGroups}
            specsByPage={state.specsByPage}
            selectedGroupIds={state.selectedGroupIds}
            collapsedPages={state.collapsedPages}
            getPageCheckState={state.getPageCheckState}
            onSelectAll={state.handleSelectAll}
            onSelectNone={state.handleSelectNone}
            onClearAll={state.handleClearAll}
            onTogglePage={state.togglePage}
            onTogglePageCollapse={state.togglePageCollapse}
            onToggleGroup={state.toggleGroup}
          />
        )}

        {state.discoveredSpecs.length > 0 && state.promptPreview && (
          <PromptPreview
            promptPreview={state.promptPreview}
            showPromptPreview={state.showPromptPreview}
            setShowPromptPreview={state.setShowPromptPreview}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
