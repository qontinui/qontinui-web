"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useUIElement } from "@qontinui/ui-bridge/react";
import {
  Dialog,
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
} from "lucide-react";
import { useSubspaceRaw } from "../_hooks/useSubspaceRaw";
import { inLifecycleOrder, stageInfo, twinPlantInfo } from "../_lib/lifecycle";
import { summarizeVerdict } from "../_lib/verdict-formatter";
import { pageAccessLabel, presentStatus } from "../_lib/status-presentation";
import { askTheTwinQuestion, useTwinNavigation } from "../_lib/twin-navigation";
import type { DriftVerdict, ResolvedSubspace } from "../_lib/types";

interface SubspaceDetailProps {
  row: ResolvedSubspace | null;
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

/**
 * Detail drawer for one sub-space. For live-probed observers answered on the
 * twin door it fetches the raw answer (the exact JSON an AI agent receives)
 * and renders both a human-digestible summary and the raw JSON on demand. A
 * `report` door's answer is not a DriftVerdict, so it gets no verdict
 * summary — only its raw JSON. An `envelope` door (the admin outbound budget)
 * is not on the twin door at all, so there is no raw read to fetch here: its
 * summary and credibility envelope come from the probe's own metrics. For
 * all rows it shows the twin and lifecycle stages, the backing coord tool /
 * observer module, the research doc and, while the row is still being built,
 * the plan building it.
 */
export function SubspaceDetail({ row, onOpenChange }: SubspaceDetailProps) {
  const readsRaw = !!row && row.liveProbed && row.doorShape !== "envelope";
  const isReport = row?.doorShape === "report";
  const isEnvelope = !!row && row.liveProbed && row.doorShape === "envelope";
  const { data, isLoading, isError, error } = useSubspaceRaw(
    row?.id ?? null,
    !!row && readsRaw
  );
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
  const style = presentStatus(row);
  const verdict = data?.verdict;
  // An envelope door has no raw read here; the probe already carried its
  // top-level DriftVerdict fields, so its live envelope is those metrics.
  const envelopeVerdict: DriftVerdict | null =
    isEnvelope && row.metrics
      ? {
          coverage: row.metrics.coverage,
          credibility: row.metrics.credibility,
          posterior: row.metrics.posterior,
          staleness_seconds: row.metrics.staleness_seconds,
          provenance: row.metrics.provenance,
          drift_class: row.metrics.drift_class ?? undefined,
        }
      : null;
  const summary =
    verdict && !isReport
      ? summarizeVerdict(row.id, verdict)
      : envelopeVerdict
        ? summarizeVerdict(row.id, envelopeVerdict)
        : null;

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${style.dot}`} />
            <span className="capitalize">{row.id.replace(/_/g, " ")}</span>
            <span className="font-mono text-sm text-muted-foreground">
              {row.symbol}
            </span>
          </DialogTitle>
          <DialogDescription>{row.description}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto pr-1 text-sm">
          {/* Human-digestible summary (live-probed observers only). */}
          {(readsRaw || isEnvelope) && (
            <div
              data-testid="digital-twin-drawer-summary"
              className="mb-3 rounded-md border border-border bg-muted/40 p-3"
            >
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Sparkles className="size-3.5" /> Summary
              </div>
              {isLoading && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Reading the
                  observer…
                </p>
              )}
              {isError && (
                <p className="text-sm text-muted-foreground">
                  Could not read the live verdict
                  {error instanceof Error ? `: ${error.message}` : ""}.
                </p>
              )}
              {summary && <p className="text-sm">{summary.prose}</p>}
              {isEnvelope && !envelopeVerdict && (
                <p className="text-sm text-muted-foreground">
                  The probe returned no credibility envelope.
                </p>
              )}
              {isReport && verdict && (
                <p className="text-sm">
                  coord answers this sub-space with its own report, not a
                  verdict — served, not graded. The raw data below is the
                  report.
                </p>
              )}
            </div>
          )}

          <Field label="Status" value={style.label} />
          <p className="pb-2 text-xs text-muted-foreground">{style.meaning}</p>
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
                  <Button
                    ref={askRef}
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() =>
                      navigate((nav) => nav.askTheTwin(askTheTwinQuestion(row)))
                    }
                  >
                    <MessageSquare aria-hidden="true" className="size-3.5" />
                    Ask the Twin about this
                  </Button>
                )}
                {row.ask_via === "delivery-tab" && (
                  <Button
                    ref={openDeliveryRef}
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

          {summary && (
            <>
              <Separator className="my-2" />
              <p className="pb-1 text-xs font-semibold text-muted-foreground">
                Live credibility envelope
              </p>
              {summary.facts.map((f) => (
                <Field key={f.label} label={f.label} value={f.value} />
              ))}
            </>
          )}

          {row.error && (
            <>
              <Separator className="my-2" />
              <Field label="Error" value={row.error} />
            </>
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
              value={<code className="text-xs">{row.plan}</code>}
            />
          )}

          {/* Raw data view — the exact JSON an AI agent receives. */}
          {readsRaw && verdict && (
            <>
              <Separator className="my-2" />
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">
                  Raw verdict
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
              <p className="pb-2 text-[11px] text-muted-foreground">
                The exact JSON an AI agent receives from{" "}
                <code>{data?.tool ?? row.coord_query_tool}</code>.
              </p>
              {showRaw && (
                <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/50 p-3 text-[11px] leading-relaxed">
                  {JSON.stringify(verdict, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
