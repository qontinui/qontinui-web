"use client";

import { Image as ImageIcon, Layers, Monitor } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ExplorerPanel,
  ExplorerPanelHeader,
  ExplorerPanelContent,
  ExplorerPanelList,
  ExplorerPanelItem,
  ExplorerPanelEmptyState,
} from "@/components/qontinui/ExplorerPanel";
import type { PlaywrightExtractionResults } from "@/hooks/use-playwright-extraction";
import type { PlaywrightClickable } from "@/lib/runner-client";
import { usePlaywrightExplorerState } from "./_hooks/usePlaywrightExplorerState";
import { MetricsSummaryBar } from "./_components/MetricsSummaryBar";
import { PlaywrightElementThumbnail } from "./_components/PlaywrightElementThumbnail";
import { PlaywrightScreenshotThumbnail } from "./_components/PlaywrightScreenshotThumbnail";
import { ImageLocationsPanel } from "./_components/ImageLocationsPanel";

interface PlaywrightStateExplorerViewProps {
  results: PlaywrightExtractionResults;
}

export function PlaywrightStateExplorerView({
  results,
}: PlaywrightStateExplorerViewProps) {
  const state = usePlaywrightExplorerState(results);

  if (!state.converted || state.converted.states.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <ExplorerPanelEmptyState
          message="No extraction results"
          icon={ImageIcon}
        />
      </div>
    );
  }

  const metrics = results.metrics;

  return (
    <div className="flex flex-col gap-4 h-full min-h-0 overflow-hidden">
      {metrics && <MetricsSummaryBar metrics={metrics} />}

      <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
        {/* Panel 1: States List */}
        <ExplorerPanel accent="primary" width="w-[16%]" className="shrink-0">
          <ExplorerPanelHeader title="States" icon={Layers} accent="primary">
            <Badge
              variant="outline"
              className="ml-auto text-[10px] border-brand-primary/30 text-brand-primary"
            >
              {state.filteredStates.length}
            </Badge>
          </ExplorerPanelHeader>

          <div className="px-3 pt-3 pb-2 border-b border-brand-primary/10">
            <Input
              placeholder="Filter states..."
              value={state.searchQuery}
              onChange={(e) => state.setSearchQuery(e.target.value)}
              className="bg-surface-canvas border-border-subtle text-white font-mono text-xs h-8 focus:border-brand-primary focus:ring-brand-primary/30 placeholder:text-text-muted/50"
            />
          </div>

          <ExplorerPanelContent scrollable padding="sm">
            <ExplorerPanelList>
              {state.filteredStates.length === 0 ? (
                <ExplorerPanelEmptyState
                  message="No states found"
                  icon={Layers}
                />
              ) : (
                state.filteredStates.map((s) => (
                  <ExplorerPanelItem
                    key={s.id}
                    selected={s.id === state.selectedState?.id}
                    accent="primary"
                    onClick={() => state.handleSelectState(s.id)}
                  >
                    <div className="font-semibold text-white text-sm mb-2 truncate">
                      {s.name}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-text-muted font-mono truncate max-w-[100px]">
                        {s.description || "No description"}
                      </span>
                      <Badge className="bg-brand-secondary/20 text-brand-secondary border-brand-secondary/30 text-[9px] px-1.5">
                        {s.stateImages.length}
                      </Badge>
                    </div>
                  </ExplorerPanelItem>
                ))
              )}
            </ExplorerPanelList>
          </ExplorerPanelContent>
        </ExplorerPanel>

        {/* Panel 2: State Images (Elements) */}
        <ExplorerPanel accent="secondary" width="w-[14%]" className="shrink-0">
          <ExplorerPanelHeader
            title="State Images"
            icon={ImageIcon}
            accent="secondary"
            actions={
              state.selectedState && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-brand-secondary/30 text-brand-secondary"
                >
                  {state.stateElements.length}
                </Badge>
              )
            }
          />

          <ExplorerPanelContent scrollable padding="sm">
            {!state.selectedState ? (
              <ExplorerPanelEmptyState
                message="Select a state"
                icon={ImageIcon}
              />
            ) : state.stateElements.length === 0 ? (
              <ExplorerPanelEmptyState
                message="No images found"
                icon={ImageIcon}
              />
            ) : (
              <ExplorerPanelList gap="md">
                {state.stateElements.map((element: PlaywrightClickable) => (
                  <PlaywrightElementThumbnail
                    key={element.element_id}
                    element={element}
                    onMouseEnter={() =>
                      state.setHoveredElementId(element.element_id)
                    }
                    onMouseLeave={() => state.setHoveredElementId(null)}
                    isSelected={state.hoveredElementId === element.element_id}
                  />
                ))}
              </ExplorerPanelList>
            )}
          </ExplorerPanelContent>
        </ExplorerPanel>

        {/* Panel 3: Image Locations (Main Canvas) */}
        <ImageLocationsPanel
          selectedScreenshotId={state.selectedScreenshotId}
          pageScreenshots={state.pageScreenshots}
          hoveredElementId={state.hoveredElementId}
          clickablesMap={state.clickablesMap}
          zoom={state.zoom}
          isDragging={state.isDragging}
          canvasRef={state.canvasRef}
          containerRef={state.containerRef}
          onZoomIn={state.handleZoomIn}
          onZoomOut={state.handleZoomOut}
          onResetZoom={state.handleResetZoom}
          onMouseDown={state.handleMouseDown}
          onMouseMove={state.handleMouseMove}
          onMouseUp={state.handleMouseUp}
        />

        {/* Panel 4: Screenshots */}
        <ExplorerPanel accent="primary" width="w-[12%]" className="shrink-0">
          <ExplorerPanelHeader
            title="Screenshots"
            icon={Monitor}
            accent="primary"
            actions={
              <Badge
                variant="outline"
                className="text-[10px] border-brand-primary/30 text-brand-primary"
              >
                {state.stateScreenshotIds.length}
              </Badge>
            }
          />

          <ExplorerPanelContent scrollable padding="sm">
            {state.stateScreenshotIds.length === 0 ? (
              <ExplorerPanelEmptyState
                message="No screenshots"
                icon={Monitor}
              />
            ) : (
              <ExplorerPanelList gap="md">
                {state.stateScreenshotIds.map((ssId) => (
                  <PlaywrightScreenshotThumbnail
                    key={ssId}
                    screenshotId={ssId}
                    isSelected={ssId === state.selectedScreenshotId}
                    screenshotBase64={state.pageScreenshots[ssId]}
                    onClick={() => state.handleSelectScreenshot(ssId)}
                  />
                ))}
              </ExplorerPanelList>
            )}
          </ExplorerPanelContent>
        </ExplorerPanel>
      </div>
    </div>
  );
}
