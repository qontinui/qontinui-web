"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Boxes } from "lucide-react";
import { CoverageMatrix } from "./_components/CoverageMatrix";
import { AskTheTwin } from "./_components/AskTheTwin";
import { DeliveryVerdictCard } from "./_components/DeliveryVerdictCard";
import { UiBridgePanel } from "./_components/UiBridgePanel";

/**
 * Digital Twin Explorer.
 *
 * Three tabs spanning the twin's two halves:
 *  - Completeness — the coordination-layer observers: which observation
 *    sub-spaces (Ξ) are live, partial, blind, or unbuilt for this tenant, with
 *    the credibility envelope each reports; plus "Ask the Twin" (your connected
 *    AI answers questions from the same tools).
 *  - Delivery — the parameterized "has this plan/PR landed?" read: a plan slug
 *    resolves to the same `coord_query_delivery` verdict an agent gets (plan
 *    status ⋈ per-PR merge state ⋈ deploy state), with provenance + staleness.
 *  - UI Bridge — the runner's UI half: processed/cached spec pages + state graph
 *    vs an automation-required live snapshot.
 *
 * Renders no cloud-only extension slot, so it degrades cleanly in base deploys
 * (cells show "error" when coord / the runner is unreachable) — matching the
 * sibling coord-backed Operations / Commits pages.
 */
export default function DigitalTwinPage() {
  return (
    <div className="flex h-[calc(100vh-44px)] flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-2">
          <Boxes className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">Digital Twin</h1>
            <p className="text-xs text-muted-foreground">
              How complete the twin is, the credibility each observer reports,
              and the UI half — the same view an AI agent gets.
            </p>
          </div>
        </div>
      </header>

      <Tabs defaultValue="completeness" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-6 mt-3 w-fit shrink-0">
          <TabsTrigger value="completeness">Completeness</TabsTrigger>
          <TabsTrigger value="delivery">Delivery</TabsTrigger>
          <TabsTrigger value="ui-bridge">UI Bridge</TabsTrigger>
        </TabsList>

        <ScrollArea className="min-h-0 flex-1">
          <TabsContent value="completeness" className="mt-0">
            <div className="space-y-6 px-6 py-4">
              <CoverageMatrix />
              <AskTheTwin />
            </div>
          </TabsContent>
          <TabsContent value="delivery" className="mt-0">
            <div className="px-6 py-4">
              <DeliveryVerdictCard />
            </div>
          </TabsContent>
          <TabsContent value="ui-bridge" className="mt-0">
            <div className="px-6 py-4">
              <UiBridgePanel />
            </div>
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
