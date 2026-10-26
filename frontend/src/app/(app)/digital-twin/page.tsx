"use client";

import { useMemo, useState } from "react";
import { useUIElement } from "@qontinui/ui-bridge/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Boxes } from "lucide-react";
import { Caption } from "@/components/presentation";
import { CoverageMatrix } from "./_components/CoverageMatrix";
import { LifecycleView } from "./_components/LifecycleView";
import { TwinCatalog } from "./_components/TwinCatalog";
import { TwinFidelityHeader } from "./_components/TwinFidelityHeader";
import { AskTheTwin } from "./_components/AskTheTwin";
import { DeliveryVerdictCard } from "./_components/DeliveryVerdictCard";
import { UiBridgePanel } from "./_components/UiBridgePanel";
import {
  TwinNavigationContext,
  type TwinNavigation,
  type TwinTab,
} from "./_lib/twin-navigation";

/**
 * Digital Twin Explorer — the twin of the software-development process: the
 * environment the agents act in, the process they follow and the intent they
 * serve.
 *
 * Four tabs:
 *  - Completeness (default) — the twin's self-fidelity (coord's fidelity
 *    report, UNKNOWN until coord serves it), then every observation
 *    sub-space (Ξ) by tier: which are live, partial, blind or unbuilt for this
 *    tenant, with the credibility envelope each live probe reports, kept
 *    visibly apart from rows that are only manifest claims; plus coord's
 *    queryable-surface catalog and "Ask the Twin" (your connected AI answers
 *    questions from the same tools).
 *  - Lifecycle — the same sub-spaces laid over the lifecycle (intent → plan →
 *    implement → verify → integrate → release → operate → learn), per stage
 *    saying how much is live-probed, how much is only claimed, and what is
 *    still planned, with the human touchpoint left at each stage.
 *  - Delivery — the parameterized "has this work unit / PR landed?" read: a
 *    work-unit slug resolves to the same `coord_query_delivery` verdict an
 *    agent gets (work-unit status ⋈ per-PR merge state ⋈ deploy state), with
 *    provenance + staleness.
 *  - UI Bridge — the runner's UI half: processed/cached spec pages + state graph
 *    vs an automation-required live snapshot.
 *
 * Renders no cloud-only extension slot, so it degrades cleanly in base deploys
 * (cells show "error" when coord / the runner is unreachable) — matching the
 * sibling coord-backed Operations / Commits pages.
 *
 * The page title is its presentation caption (`digital-twin.page`, plan
 * `2026-10-23-console-presentation-spaces` D5): the title and one-liner in
 * operator mode, plus why it matters in presentation mode. The toggle that
 * switches the lens is the layout's, in the bar above this page (`layout.tsx`).
 */
export default function DigitalTwinPage() {
  // UI Bridge: stable ids so automation can switch tabs by id.
  const { ref: tabCompletenessRef } = useUIElement({
    id: "digital-twin-tab-completeness",
    label: "Digital Twin — Completeness tab",
    type: "button",
  });
  const { ref: tabLifecycleRef } = useUIElement({
    id: "digital-twin-tab-lifecycle",
    label: "Digital Twin — Lifecycle tab",
    type: "button",
  });
  const { ref: tabDeliveryRef } = useUIElement({
    id: "digital-twin-tab-delivery",
    label: "Digital Twin — Delivery tab",
    type: "button",
  });
  const { ref: tabUiBridgeRef } = useUIElement({
    id: "digital-twin-tab-ui-bridge",
    label: "Digital Twin — UI Bridge tab",
    type: "button",
  });

  // Controlled so the sub-space drawer can switch tabs (`TwinNavigation`).
  const [tab, setTab] = useState<TwinTab>("completeness");
  // A question the drawer handed to Ask the Twin, until it has been typed in.
  const [askDraft, setAskDraft] = useState<string | null>(null);
  const navigation = useMemo<TwinNavigation>(
    () => ({
      askTheTwin: (question) => {
        setAskDraft(question);
        setTab("completeness");
      },
      openTab: setTab,
    }),
    []
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-6 py-3">
        <Boxes className="h-5 w-5 shrink-0 text-muted-foreground" />
        <Caption id="digital-twin.page" level={1} persistent />
      </header>

      <TwinNavigationContext.Provider value={navigation}>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as TwinTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="mx-6 mt-3 w-fit shrink-0">
            <TabsTrigger ref={tabCompletenessRef} value="completeness">
              Completeness
            </TabsTrigger>
            <TabsTrigger ref={tabLifecycleRef} value="lifecycle">
              Lifecycle
            </TabsTrigger>
            <TabsTrigger ref={tabDeliveryRef} value="delivery">
              Delivery
            </TabsTrigger>
            <TabsTrigger ref={tabUiBridgeRef} value="ui-bridge">
              UI Bridge
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="min-h-0 flex-1">
            <TabsContent value="completeness" className="mt-0">
              <div className="space-y-6 px-6 py-4">
                <TwinFidelityHeader />
                <CoverageMatrix />
                <TwinCatalog />
                <AskTheTwin
                  draft={askDraft}
                  onDraftApplied={() => setAskDraft(null)}
                />
              </div>
            </TabsContent>
            <TabsContent value="lifecycle" className="mt-0">
              <div className="px-6 py-4">
                <LifecycleView />
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
      </TwinNavigationContext.Provider>
    </div>
  );
}
