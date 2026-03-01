"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Globe, MousePointerClick } from "lucide-react";
import { ExtractionConfigPanel } from "../ExtractionConfigPanel";
import {
  PlaywrightCollectorConfig,
  type PlaywrightCollectorConfigState,
} from "../PlaywrightCollectorConfig";
import { ExtractionHistorySidebar } from "./ExtractionHistorySidebar";
import type { PlaywrightExtractionJob } from "@/hooks/use-playwright-extraction";
import type { ConfigSubTab } from "../_hooks";
import type { RefObject } from "react";
import type { useExtractionConfig } from "@/hooks/use-extraction-config";

interface ExtractionSummary {
  id: string;
  source_urls: string[];
  status: string;
  stats: {
    pages_extracted?: number;
    states_found?: number;
  };
  created_at: string;
}

interface ConfigurationTabContentProps {
  contentRef: RefObject<HTMLDivElement | null>;
  configSubTab: ConfigSubTab;
  setConfigSubTab: (tab: ConfigSubTab) => void;
  extractionConfig: ReturnType<typeof useExtractionConfig>;
  playwrightJob: PlaywrightExtractionJob | null;
  isStartingPlaywright: boolean;
  isPollingPlaywright: boolean;
  onStartPlaywrightExtraction: (config: PlaywrightCollectorConfigState) => void;
  extractions: ExtractionSummary[] | undefined;
  activeExtractionId: string | null;
  isDeletingAll: boolean;
  onSelectExtraction: (extractionId: string) => void;
  onDeleteExtraction: (extractionId: string) => void;
  onDeleteAllExtractions: () => void;
}

export function ConfigurationTabContent({
  contentRef,
  configSubTab,
  setConfigSubTab,
  extractionConfig,
  playwrightJob,
  isStartingPlaywright,
  isPollingPlaywright,
  onStartPlaywrightExtraction,
  extractions,
  activeExtractionId,
  isDeletingAll,
  onSelectExtraction,
  onDeleteExtraction,
  onDeleteAllExtractions,
}: ConfigurationTabContentProps) {
  return (
    <Tabs
      ref={contentRef}
      value={configSubTab}
      onValueChange={(v) => setConfigSubTab(v as ConfigSubTab)}
      className="layout-full-height"
    >
      <TabsList className="bg-surface-raised/80 border border-brand-primary/20 p-1 backdrop-blur-sm w-fit mb-4 shrink-0">
        <TabsTrigger
          value="dom-extraction"
          className="data-[state=active]:bg-brand-primary/20 data-[state=active]:text-brand-primary font-mono flex items-center gap-2"
        >
          <Globe className="h-4 w-4" />
          DOM Extraction
        </TabsTrigger>
        <TabsTrigger
          value="playwright-collector"
          className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400 font-mono flex items-center gap-2"
        >
          <MousePointerClick className="h-4 w-4" />
          State Collector
          {playwrightJob && (
            <Badge
              variant={
                playwrightJob.status === "completed"
                  ? "default"
                  : playwrightJob.status === "failed"
                    ? "destructive"
                    : "secondary"
              }
              className="ml-1 scale-75"
            >
              {playwrightJob.status}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>

      {/* DOM Extraction Config Sub-tab */}
      <TabsContent
        value="dom-extraction"
        className="flex-1 h-full flex flex-col mt-0 min-h-0 overflow-hidden data-[state=inactive]:hidden"
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 grid-rows-[1fr] gap-6 h-full">
          {/* Left: Configuration Panel (2 columns) */}
          <div className="lg:col-span-2 h-full min-h-0">
            <ScrollArea className="h-full pr-4">
              <ExtractionConfigPanel extractionConfig={extractionConfig} />
            </ScrollArea>
          </div>

          {/* Right: Previous Extractions Sidebar (1 column) */}
          <div className="lg:col-span-1 min-h-0 overflow-hidden">
            <ExtractionHistorySidebar
              extractions={extractions}
              activeExtractionId={activeExtractionId}
              isDeletingAll={isDeletingAll}
              onSelectExtraction={onSelectExtraction}
              onDeleteExtraction={onDeleteExtraction}
              onDeleteAllExtractions={onDeleteAllExtractions}
            />
          </div>
        </div>
      </TabsContent>

      {/* Playwright State Collector Config Sub-tab */}
      <TabsContent
        value="playwright-collector"
        className="flex-1 h-full flex flex-col mt-0 min-h-0 overflow-hidden data-[state=inactive]:hidden"
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 grid-rows-[1fr] gap-6 h-full">
          {/* Left: Playwright Config Panel (2 columns) */}
          <div className="lg:col-span-2 h-full min-h-0">
            <ScrollArea className="h-full pr-4 text-green-400">
              <PlaywrightCollectorConfig
                onStartExtraction={onStartPlaywrightExtraction}
                isLoading={isStartingPlaywright || isPollingPlaywright}
              />
            </ScrollArea>
          </div>

          {/* Right: Info Panel (1 column) */}
          <div className="lg:col-span-1 min-h-0 overflow-hidden">
            <Card className="bg-surface-raised/60 border-green-500/20 backdrop-blur-sm h-full overflow-hidden flex flex-col">
              <div className="p-4 border-b border-green-500/10 shrink-0">
                <div className="flex items-center gap-2">
                  <MousePointerClick className="h-4 w-4 text-green-400" />
                  <Label className="text-green-400 text-base font-mono font-semibold uppercase tracking-wider">
                    About State Collector
                  </Label>
                </div>
              </div>
              <ScrollArea className="flex-1 min-h-0">
                <div className="p-4 space-y-4 text-sm text-muted-foreground">
                  <p>
                    The Playwright State Collector uses DOM-based detection to
                    identify clickable elements (buttons, links, menu items) and
                    safely navigates through your web application.
                  </p>
                  <div className="space-y-2">
                    <p className="font-medium text-green-400">
                      Safety Features:
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                      <li>
                        Blocks dangerous actions (delete, purchase, logout)
                      </li>
                      <li>Auto-dismisses confirmation dialogs</li>
                      <li>Customizable keyword blocklist</li>
                      <li>Dry run mode for safe exploration</li>
                    </ul>
                  </div>
                  <div className="space-y-2">
                    <p className="font-medium text-green-400">Verification:</p>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                      <li>Pattern matching validates extracted images</li>
                      <li>Only verified elements are recommended for use</li>
                      <li>Confidence scores indicate reliability</li>
                    </ul>
                  </div>
                  <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
                    <p className="text-xs text-yellow-400">
                      <strong>Note:</strong> This feature requires the runner to
                      be running on port 9876.
                    </p>
                  </div>
                </div>
              </ScrollArea>
            </Card>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}
