"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useUIElement } from "@qontinui/ui-bridge/react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Code2,
  Loader2,
  MessageSquare,
  Sparkles,
  XIcon,
} from "lucide-react";
import {
  LensLink,
  NAVIGATION_ONLY_PROPS,
  OperatorOnly,
  Provenance,
  usePresentationMode,
} from "@/components/presentation";
import { useBrowserOnline } from "../_hooks/useBrowserOnline";
import { useSubspaceRaw } from "../_hooks/useSubspaceRaw";
import {
  drawerRawReading,
  drawerSummary,
  ownReadAnswered,
  ownReadOf,
  type DrawerLine,
} from "../_lib/drawer-reading";
import { drawerStatusAsOf, presentDrawerStatus } from "../_lib/drawer-status";
import { inLifecycleOrder, stageInfo, twinPlantInfo } from "../_lib/lifecycle";
import type { ProbeAttempt } from "../_lib/probe-read";
import { pageAccessLabel, upperFirst } from "../_lib/status-presentation";
import { FIDELITY_SOURCE } from "../_lib/twin-aspects";
import { askTheTwinQuestion, useTwinNavigation } from "../_lib/twin-navigation";
import { workUnitHref } from "../_lib/twin-plans";
import type { ResolvedSubspace } from "../_lib/types";
import { UnknownBadge } from "./FidelityFigures";

interface SubspaceDetailProps {
  row: ResolvedSubspace | null;
  /**
   * The probe `row` was resolved from (`useProbeRead`, without its rows):
   * whether its last refresh failed over the answer the row still shows, and
   * when that answer — or the attempt that left the row UNKNOWN — was read.
   */
  probe: ProbeAttempt;
  onOpenChange: (open: boolean) => void;
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

/** The UI test id of each line the Summary says about its read. */
const LINE_TEST_IDS: Record<DrawerLine["kind"], string> = {
  // "held": react-query holds the read — it has not been made.
  "read-unmade": "digital-twin-drawer-read-held",
  "read-in-flight": "digital-twin-drawer-read-in-flight",
  "read-error": "digital-twin-drawer-read-error",
  "read-empty": "digital-twin-drawer-read-empty",
  "read-retained": "digital-twin-drawer-read-retained",
  "probe-held": "digital-twin-drawer-probe-held",
  "no-envelope": "digital-twin-drawer-no-envelope",
};

function SummaryLine({ line }: { line: DrawerLine }) {
  if (line.kind === "read-in-flight") {
    return (
      <p
        data-testid={LINE_TEST_IDS[line.kind]}
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 className="size-3.5 animate-spin" />
        <span>{line.text}</span>
      </p>
    );
  }
  return (
    <p
      data-testid={LINE_TEST_IDS[line.kind]}
      className="text-sm text-muted-foreground"
    >
      {line.text}
    </p>
  );
}

/**
 * Detail drawer for one sub-space. It can show two readings of one observer,
 * and says which is which in every state of the reads behind them:
 *
 * - **Status** is the page probe's answer for the row — the cell's status,
 *   worded with the probe as its source and dated by when the probe read it
 *   (`drawer-status.ts`). A last answer kept after a failed refresh is named
 *   as one ("Last answer: Live", on the ignorance floor's dot); an UNKNOWN
 *   row says there is no current reading, unless this drawer's own LATEST
 *   read answered, when it points at the Summary instead — as an error or a
 *   refusal does beside that reading.
 * - **Summary** is a reading of the observer (`drawer-reading.ts`): for a
 *   row on coord's twin door, this drawer's own raw read of it — the exact
 *   JSON an AI agent receives, summarized; for the admin outbound budget, an
 *   `envelope` door off the twin door, the probe's answer for the row, once
 *   there is one. Each reading is dated by when it was read, and its
 *   staleness is its staleness then — for the envelope door, its worst
 *   bucket's, named so, or UNKNOWN when no age was served (never "live").
 *   One kept after a failed read leads with
 *   that failure, is introduced as the last one read, and its envelope is
 *   never headed "Live". With no reading the Summary says why (not made, in
 *   flight, failed), and an envelope door with no probe answer has none.
 *
 * For all rows it shows the twin and lifecycle stages, the backing coord tool
 * / observer module, the research doc and, while the row is still being
 * built, the plan building it — a link to that plan's work unit (plain text
 * while presenting, until that page can be presented: `LensLink`).
 *
 * In presentation mode (plan `2026-10-23-console-presentation-spaces` D3.2)
 * the drawer keeps only navigation: "Ask the Twin about this" leads to a
 * control that starts an AI session, and the raw JSON is engineering detail
 * an outsider is not shown, so both are `OperatorOnly`; closing the drawer
 * and opening the Delivery tab only change what is displayed.
 */
export function SubspaceDetail({
  row,
  probe,
  onOpenChange,
}: SubspaceDetailProps) {
  const { presenting } = usePresentationMode();
  const readsRaw = !!row && row.liveProbed && row.doorShape !== "envelope";
  const rawQuery = useSubspaceRaw(row?.id ?? null, readsRaw);
  // Why that read may be unmade: react-query makes none while this browser
  // is offline.
  const online = useBrowserOnline();
  const [showRaw, setShowRaw] = useState(false);

  // Collapse the raw view whenever a different sub-space is opened.
  useEffect(() => {
    setShowRaw(false);
  }, [row?.id]);

  // UI Bridge: stable id for the raw-data toggle (automation + spec-checks).
  const { ref: showRawRef } = useUIElement({
    id: "digital-twin-show-raw",
    label: "Toggle the raw DriftVerdict JSON in the sub-space drawer",
    type: "button",
  });
  const { ref: askRef } = useUIElement({
    id: "digital-twin-drawer-ask",
    label: "Ask the Twin about this sub-space (opens the Completeness tab)",
    type: "button",
  });
  const { ref: openDeliveryRef } = useUIElement({
    id: "digital-twin-drawer-open-delivery",
    label: "Open the Delivery tab from the sub-space drawer",
    type: "button",
  });
  const navigation = useTwinNavigation();
  // Close the drawer, then go. (The drawer has no DialogTrigger, so Radix
  // returns focus nowhere on close and the destination keeps it.)
  const navigate = (go: (nav: NonNullable<typeof navigation>) => void) => {
    if (!navigation) return;
    onOpenChange(false);
    go(navigation);
  };

  if (!row) return null;
  // The drawer's own read, by what its LATEST attempt did — a failed refetch
  // keeps react-query's data, and that is a retained reading, not an answer.
  const own = ownReadOf(readsRaw, rawQuery, online, row.doorShape);
  const style = presentDrawerStatus(row, {
    probe,
    ownReadAnswered: ownReadAnswered(own),
  });
  const summary = drawerSummary({ row, probe, own, presenting });
  const reading = summary?.reading ?? null;
  // An envelope door's Summary IS the probe's answer, already dated by the
  // probe: a second, identical chip under the Status would add nothing.
  const statusAsOf =
    reading?.source === FIDELITY_SOURCE.probe
      ? undefined
      : drawerStatusAsOf(row, probe);
  const rawReading = drawerRawReading(own);

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" showCloseButton={false}>
        {/* The shared close button, marked navigation-only: closing the
            drawer changes only what is displayed. */}
        <DialogClose
          {...NAVIGATION_ONLY_PROPS}
          className="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogClose>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              data-testid="digital-twin-drawer-status-dot"
              className={`size-2.5 rounded-full ${style.dot}`}
            />
            <span className="capitalize">{row.id.replace(/_/g, " ")}</span>
            <span className="font-mono text-sm text-muted-foreground">
              {row.symbol}
            </span>
          </DialogTitle>
          <DialogDescription>{row.description}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto pr-1 text-sm">
          {/* A reading of the observer, or why there is none: the drawer's
              own read for a twin-door row, the probe's answer for an
              envelope door once it has one. */}
          {summary && (
            <div
              data-testid="digital-twin-drawer-summary"
              className="mb-3 rounded-md border border-border bg-muted/40 p-3"
            >
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Sparkles className="size-3.5" /> Summary
              </div>
              {summary.lines.map((line) => (
                <SummaryLine key={line.kind} line={line} />
              ))}
              {reading && (
                <>
                  <p
                    data-testid="digital-twin-drawer-reading"
                    className="text-sm"
                  >
                    {reading.prose}
                  </p>
                  {/* When it was read, in both modes: nothing else in the
                      drawer dates it, and a kept reading must say it is old. */}
                  <Provenance
                    persistent
                    source={reading.source}
                    asOf={reading.asOf}
                    className="mt-2"
                    data-testid="digital-twin-drawer-reading-provenance"
                  />
                </>
              )}
            </div>
          )}

          <Field label="Status" value={style.label} />
          <p
            data-testid="digital-twin-drawer-status-meaning"
            className="pb-2 text-xs text-muted-foreground"
          >
            {style.meaning}
          </p>
          {/* When the probe read what the Status says — an UNKNOWN by the
              attempt that left it so; nothing for a manifest claim or a
              probe in flight. */}
          {statusAsOf !== undefined && (
            <Provenance
              persistent
              source={FIDELITY_SOURCE.probe}
              asOf={statusAsOf}
              className="mb-2"
              data-testid="digital-twin-drawer-status-provenance"
            />
          )}
          <Field label="Twin" value={twinPlantInfo(row.twin).label} />
          <Field
            label="Lifecycle stages"
            value={inLifecycleOrder(row.stages)
              .map((stage) => stageInfo(stage).label)
              .join(", ")}
          />
          <Field label="Tier" value={`Tier ${row.tier}`} />
          <Field label="Layer" value={row.layer} />
          <Field label="Research status" value={row.research_status} />
          {/* What the row's query_kind + ask_via mean HERE — the raw
              query_kind reads `parameterized` even for a tool coord's own
              catalog lists as kind `snapshot`. */}
          <Field label="On this page" value={pageAccessLabel(row)} />
          {/* Act on that answer: the drawer closes and the page goes there.
              Only where the row really is askable — `not-on-this-page` and
              claim-only rows get no button. */}
          {navigation &&
            row.query_kind === "parameterized" &&
            (row.ask_via === "ask-the-twin" ||
              row.ask_via === "delivery-tab") && (
              <div className="flex justify-end pb-1">
                {row.ask_via === "ask-the-twin" && (
                  <OperatorOnly>
                    <Button
                      ref={askRef}
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() =>
                        navigate((nav) =>
                          nav.askTheTwin(askTheTwinQuestion(row))
                        )
                      }
                    >
                      <MessageSquare aria-hidden="true" className="size-3.5" />
                      Ask the Twin about this
                    </Button>
                  </OperatorOnly>
                )}
                {row.ask_via === "delivery-tab" && (
                  <Button
                    ref={openDeliveryRef}
                    {...NAVIGATION_ONLY_PROPS}
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => navigate((nav) => nav.openTab("delivery"))}
                  >
                    Open the Delivery tab
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Button>
                )}
              </div>
            )}

          {reading?.envelope && (
            <>
              <Separator className="my-2" />
              <p
                data-testid="digital-twin-drawer-envelope-heading"
                className="pb-1 text-xs font-semibold text-muted-foreground"
              >
                {reading.envelope.heading}
              </p>
              {reading.envelope.facts.map((f) => (
                <Field
                  key={f.label}
                  label={f.label}
                  value={
                    f.unknownReason !== undefined ? (
                      <UnknownBadge title={`${upperFirst(f.unknownReason)}.`} />
                    ) : (
                      f.value
                    )
                  }
                />
              ))}
            </>
          )}

          {/* The token the probe's failed read carried for the row. The
              Status says it in words; the token is the operator's. */}
          {row.error && (
            <OperatorOnly>
              <Separator className="my-2" />
              <Field label="Probe error" value={row.error} />
            </OperatorOnly>
          )}

          <Separator className="my-2" />
          <Field
            label="coord tool"
            value={
              row.coord_query_tool ? (
                <code className="text-xs">{row.coord_query_tool}</code>
              ) : (
                "—"
              )
            }
          />
          <Field
            label="Observer"
            value={
              row.observer_module ? (
                <code className="text-xs">{row.observer_module}</code>
              ) : (
                "—"
              )
            }
          />
          <Field
            label="Research"
            value={<code className="text-xs">{row.research_doc}</code>}
          />
          {row.plan && (
            <Field
              label="Planned in"
              value={
                <LensLink
                  href={workUnitHref(row.plan)}
                  data-testid="digital-twin-drawer-plan-link"
                  className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                  textClassName="font-mono text-xs"
                >
                  {row.plan}
                </LensLink>
              }
            />
          )}

          {/* Raw data view — the exact JSON an AI agent receives. */}
          {rawReading && (
            <OperatorOnly>
              <Separator className="my-2" />
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">
                  {rawReading.kind === "report" ? "Raw report" : "Raw verdict"}
                </span>
                <Button
                  ref={showRawRef}
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => setShowRaw((v) => !v)}
                >
                  <Code2 className="size-3.5" />
                  {showRaw ? "Hide raw data" : "Show raw data"}
                </Button>
              </div>
              <p
                data-testid="digital-twin-drawer-raw-caption"
                className="pb-2 text-[11px] text-muted-foreground"
              >
                {rawReading.retained
                  ? "The exact JSON an AI agent received from "
                  : "The exact JSON an AI agent receives from "}
                <code>{rawReading.tool ?? row.coord_query_tool}</code>
                {rawReading.retained ? ", at this drawer's last read." : "."}
              </p>
              {showRaw && (
                <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/50 p-3 text-[11px] leading-relaxed">
                  {JSON.stringify(rawReading.json, null, 2)}
                </pre>
              )}
            </OperatorOnly>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
