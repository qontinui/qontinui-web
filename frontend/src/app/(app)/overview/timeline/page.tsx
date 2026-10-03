"use client";

/**
 * Project Overview — Timeline. The estimate's phases as the delivery plan,
 * tracked against what actually happened (plan
 * `2026-09-19-project-overview-for-business-leaders`, Phase 3; authored on
 * the layer of `2026-09-20-overview-authoring-layer`, Phase 4).
 *
 * What it reads, and from where:
 * - the project's estimate (the baseline, else the newest) — its phases'
 *   tasks and its calendar breaks;
 * - `phase_progress` — each phase's actual dates and gate outcome, with the
 *   version a write must name;
 * - `milestones`;
 * - the project's shipped plans (`/api/v1/operations/plans`), for the lane
 *   that closes the chart;
 * - `GET /estimates/{id}/forecast` — the current phase, the next gate, the
 *   forecast finish and its slip. This page does no schedule arithmetic; it
 *   places what the server says.
 *
 * What it writes: a phase's progress and the milestones, each through the
 * kit's contract (`If-Match`, a conflict shown side by side, the change log).
 * Edit controls come from the served permission for THIS project
 * (`useCanEdit`), never `isCoordAdmin`, and are absent — not disabled — for
 * a reader who may not edit.
 *
 * Loading, failure and "no estimate yet" are kept apart; none renders as an
 * empty chart.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { useCanEdit } from "@/components/overview/editing/permissions";
import {
  useResourceList,
  useResourceRecord,
} from "@/components/overview/editing/useResource";
import { cn } from "@/lib/utils";
import { useForecast } from "../_hooks/useForecast";
import { useOverviewProject } from "../_hooks/useOverviewProject";
import { useShippedPlans } from "../_hooks/useShippedPlans";
import {
  ESTIMATES,
  pickBaseline,
  type EstimateRecord,
  type PhaseTaskRead,
} from "../_lib/estimate-api";
import type { PhaseChoice } from "../_lib/milestones";
import {
  MILESTONES,
  MILESTONES_PATH,
  PHASE_PROGRESS,
  PHASE_PROGRESS_PATH,
  type Milestone,
  type PhaseProgress,
} from "../_lib/timeline-api";
import {
  ZOOMS,
  projectWindow,
  toDay,
  toMermaidGantt,
  zoomWindow,
  type Zoom,
} from "../_lib/timeline";
import { MilestonesSection } from "./_components/MilestonesSection";
import { assemblePhases, phaseKey } from "./_components/model";
import { PhaseDetails } from "./_components/PhaseDetails";
import { PhaseList } from "./_components/PhaseList";
import { ShippedPlansList } from "./_components/ShippedPlansList";
import { TimelineChart } from "./_components/TimelineChart";
import { TimelineHeader } from "./_components/TimelineHeader";

function Section({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} data-ui-bridge-id={id}>
      <h2
        id={`${id}-heading`}
        className="font-[family-name:var(--font-overview-serif)] text-[1.625rem] leading-snug text-foreground"
      >
        {title}
      </h2>
      {lede && (
        <p className="mb-5 mt-1.5 max-w-[46rem] text-[15px] leading-relaxed text-muted-foreground">
          {lede}
        </p>
      )}
      <div className={lede ? "" : "mt-5"}>{children}</div>
    </section>
  );
}

function Loading({ uiBridgeId }: { uiBridgeId: string }) {
  return (
    <div className="space-y-3" aria-hidden data-ui-bridge-id={uiBridgeId}>
      <Skeleton className="h-7 w-52" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
    </div>
  );
}

function NoEstimate({ canEdit }: { canEdit: boolean }) {
  return (
    <section
      className="max-w-[38rem]"
      data-ui-bridge-id="overview.timeline.no-estimate"
    >
      <h2 className="font-[family-name:var(--font-overview-serif)] text-2xl text-foreground">
        This project has no schedule yet
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
        The Timeline draws the phases of the project&rsquo;s estimate and tracks
        each one against what actually happens. No estimate has been entered, so
        there are no phases to draw. Milestones can be recorded below in the
        meantime.
      </p>
      {canEdit ? (
        <Link
          href="/overview/team/edit"
          className="mt-3 inline-flex min-h-9 items-center rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ui-bridge-id="overview.timeline.no-estimate.create"
        >
          Enter the estimate
        </Link>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          A project administrator, or anyone the project lets edit its overview,
          can enter it.
        </p>
      )}
    </section>
  );
}

/** "Copy as mermaid gantt": the plan as a chart a document or deck can hold. */
function CopyGantt({
  estimate,
  milestones,
}: {
  estimate: EstimateRecord;
  milestones: Milestone[];
}) {
  const [result, setResult] = useState<
    | { state: "idle" }
    | { state: "copied"; skipped: string[] }
    | { state: "manual"; text: string; skipped: string[] }
  >({ state: "idle" });

  const copy = async () => {
    const { text, skipped } = toMermaidGantt(
      estimate.name,
      estimate.content?.phases ?? [],
      milestones
    );
    try {
      await navigator.clipboard.writeText(text);
      setResult({ state: "copied", skipped });
    } catch {
      // No clipboard (an insecure context, a refused permission): show the
      // text to copy by hand rather than failing quietly.
      setResult({ state: "manual", text, skipped });
    }
  };

  return (
    <div className="space-y-2" data-ui-bridge-id="overview.timeline.export">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void copy()}
        disabled={estimate.content === null}
        data-ui-bridge-id="overview.timeline.export.copy"
      >
        Copy as mermaid gantt
      </Button>
      {result.state !== "idle" && (
        <div role="status" className="text-xs text-muted-foreground">
          {result.state === "copied"
            ? "Copied. Paste it into a document inside a ```mermaid fence — it is one already."
            : "Your browser did not allow copying. Select the text below and copy it."}
          {result.skipped.length > 0 &&
            ` Left out, having no dates: ${result.skipped.join(", ")}.`}
        </div>
      )}
      {result.state === "manual" && (
        <textarea
          readOnly
          value={result.text}
          className="h-40 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
          data-ui-bridge-id="overview.timeline.export.text"
        />
      )}
    </div>
  );
}

export default function TimelinePage() {
  const { projectId, hold, tenantsError } = useOverviewProject();
  const canEditProgress = useCanEdit(PHASE_PROGRESS);
  const canEditMilestones = useCanEdit(MILESTONES);
  const canEditEstimate = useCanEdit(ESTIMATES);

  const estimates = useResourceList<EstimateRecord>(ESTIMATES, {
    hold,
    reloadKey: projectId,
  });
  const estimate =
    estimates.list.state === "ready"
      ? pickBaseline(estimates.list.items)
      : null;
  const estimateId = estimate?.id ?? null;
  const record = useResourceRecord<EstimateRecord>(ESTIMATES, estimateId, {
    hold,
    reloadKey: projectId,
  });
  const progress = useResourceList<PhaseProgress>(PHASE_PROGRESS_PATH, {
    params: estimateId ? { estimate_id: estimateId } : {},
    hold: hold || estimateId === null,
    reloadKey: projectId,
  });
  const milestones = useResourceList<Milestone>(MILESTONES_PATH, {
    hold,
    reloadKey: projectId,
  });
  // The forecast is computed from progress, so it is re-read whenever the
  // served progress moves: a save, and equally a conflict — the list has
  // already taken the peer's newer copy. Its first arrival is not a move (the
  // forecast is being read for it anyway), so that does not read it twice.
  const progressStamp =
    progress.list.state === "ready"
      ? progress.list.items.map((p) => `${p.id}@${p.version}`).join(",")
      : null;
  const [forecastToken, setForecastToken] = useState({
    stamp: progressStamp,
    n: 0,
  });
  if (forecastToken.stamp !== progressStamp) {
    const moved = forecastToken.stamp !== null && progressStamp !== null;
    setForecastToken({
      stamp: progressStamp,
      n: moved ? forecastToken.n + 1 : forecastToken.n,
    });
  }
  const forecast = useForecast(estimateId, hold, forecastToken.n);
  const shipped = useShippedPlans(projectId, hold);

  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [zoom, setZoom] = useState<Zoom>("project");
  const [selected, setSelected] = useState<string | null>(null);

  const content =
    record.record.state === "ready" ? record.record.item.content : null;
  const tasks = useMemo(() => {
    const byPhase = new Map<string, PhaseTaskRead[]>();
    for (const phase of content?.phases ?? [])
      byPhase.set(phase.id, phase.tasks);
    return byPhase;
  }, [content]);
  const breaks = content?.calendar_breaks ?? [];
  const phases = useMemo(
    () =>
      progress.list.state === "ready"
        ? assemblePhases(
            progress.list.items,
            tasks,
            forecast.state === "ready" ? forecast.forecast.phases : null
          )
        : [],
    [progress.list, tasks, forecast]
  );
  const phaseChoices: PhaseChoice[] = useMemo(
    () =>
      phases.map((p) => ({
        id: p.progress.id,
        code: p.progress.code,
        name: p.progress.name,
      })),
    [phases]
  );
  const milestoneItems =
    milestones.list.state === "ready" ? milestones.list.items : [];

  const today =
    toDay(forecast.state === "ready" ? forecast.forecast.today : null) ??
    new Date();
  const projectSpan = projectWindow([
    ...phases.flatMap((p) => [
      p.progress.planned_start,
      p.progress.planned_end,
      p.progress.actual_start,
      p.progress.actual_end,
      p.forecast?.forecast_end,
    ]),
    ...milestoneItems.map((m) => m.target_date),
    ...breaks.flatMap((b) => [b.start_date, b.end_date]),
  ]);
  const axis = projectSpan ? zoomWindow(projectSpan, zoom, today) : null;
  const selectedPhase = phases.find((p) => phaseKey(p) === selected) ?? null;

  if (tenantsError) {
    return (
      <LoadFailure
        what="the list of projects"
        message={tenantsError}
        uiBridgeId="overview.timeline.error"
      />
    );
  }
  if (estimates.list.state === "loading")
    return <Loading uiBridgeId="overview.timeline.loading" />;
  if (estimates.list.state === "error") {
    return (
      <LoadFailure
        what="the project's estimate"
        message={estimates.list.message}
        uiBridgeId="overview.timeline.error"
      />
    );
  }

  const milestonesSection = (
    <Section
      id="overview.timeline.section.milestones"
      title="Milestones"
      lede="Pilots, the date the project first delivers value, and any other date worth watching. Gates belong to phases and are recorded with them above."
    >
      {milestones.list.state === "loading" && (
        <Loading uiBridgeId="overview.timeline.milestones.loading" />
      )}
      {milestones.list.state === "error" && (
        <LoadFailure
          what="the milestones"
          message={milestones.list.message}
          uiBridgeId="overview.timeline.milestones.error"
          announce={false}
        />
      )}
      {milestones.list.state === "ready" && (
        <MilestonesSection
          milestones={milestones.list.items}
          phases={phaseChoices}
          canEdit={canEditMilestones}
          create={milestones.create}
          update={milestones.update}
          drop={milestones.drop}
          replace={milestones.replace}
        />
      )}
    </Section>
  );

  if (!estimate) {
    return (
      <div className="space-y-14" data-ui-bridge-id="overview.timeline">
        <NoEstimate canEdit={canEditEstimate} />
        {milestonesSection}
        <ShippedPlansList shipped={shipped} />
      </div>
    );
  }

  return (
    <div className="space-y-14" data-ui-bridge-id="overview.timeline">
      <div>
        <p className="mb-6 text-sm text-muted-foreground">
          The schedule of{" "}
          <span className="text-foreground">{estimate.name}</span>, against what
          has actually happened.
        </p>
        {forecast.state === "loading" && (
          <Loading uiBridgeId="overview.timeline.header.loading" />
        )}
        {forecast.state === "error" && (
          <LoadFailure
            what="the forecast"
            message={forecast.message}
            uiBridgeId="overview.timeline.header.error"
            announce={false}
          />
        )}
        {forecast.state === "ready" && (
          <TimelineHeader forecast={forecast.forecast} />
        )}
      </div>

      <Section
        id="overview.timeline.section.schedule"
        title="Phases, planned and actual"
        lede="Each phase as planned, and beneath it what actually happened. The diamond at a phase's end is its gate."
      >
        <div
          className="mb-4 flex flex-wrap items-center gap-3"
          data-ui-bridge-id="overview.timeline.controls"
        >
          <div
            role="group"
            aria-label="Show as"
            className="hidden overflow-hidden rounded-md border border-border md:inline-flex"
            data-ui-bridge-id="overview.timeline.view"
          >
            {(["calendar", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "min-h-9 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  view === v
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                data-ui-bridge-id={`overview.timeline.view.${v}`}
              >
                {v === "calendar" ? "Calendar" : "List"}
              </button>
            ))}
          </div>
          {view === "calendar" && (
            <label className="hidden items-center gap-2 text-sm text-muted-foreground md:inline-flex">
              Show
              <select
                value={zoom}
                onChange={(e) => setZoom(e.target.value as Zoom)}
                className="min-h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-ui-bridge-id="overview.timeline.zoom"
              >
                {ZOOMS.map((z) => (
                  <option key={z.value} value={z.value}>
                    {z.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="ml-auto">
            {record.record.state === "ready" && (
              <CopyGantt
                estimate={record.record.item}
                milestones={milestoneItems}
              />
            )}
          </div>
        </div>

        {record.record.state === "error" && (
          <div className="mb-4">
            <LoadFailure
              what="the estimate's tasks and holidays"
              message={record.record.message}
              uiBridgeId="overview.timeline.estimate.error"
              announce={false}
            />
          </div>
        )}
        {progress.list.state === "loading" && (
          <Loading uiBridgeId="overview.timeline.phases.loading" />
        )}
        {progress.list.state === "error" && (
          <LoadFailure
            what="the phases"
            message={progress.list.message}
            uiBridgeId="overview.timeline.phases.error"
            announce={false}
          />
        )}
        {progress.list.state === "ready" && phases.length === 0 && (
          <p
            className="text-[15px] text-muted-foreground"
            data-ui-bridge-id="overview.timeline.phases.empty"
          >
            The estimate has no phases yet, so there is nothing to draw.
          </p>
        )}
        {progress.list.state === "ready" && phases.length > 0 && (
          <>
            {view === "calendar" && axis && (
              <div className="hidden space-y-4 md:block">
                <div className="overflow-x-auto">
                  <div className="min-w-[40rem]">
                    <TimelineChart
                      phases={phases}
                      milestones={milestoneItems}
                      shipped={shipped}
                      wholeProject={zoom === "project"}
                      breaks={breaks}
                      window={axis}
                      today={today}
                      selected={selected}
                      onSelect={setSelected}
                    />
                  </div>
                </div>
                {selectedPhase && (
                  <div
                    className="rounded-md border border-border p-4"
                    data-ui-bridge-id="overview.timeline.gate-panel"
                  >
                    <h3 className="mb-2 font-[family-name:var(--font-overview-serif)] text-lg text-foreground">
                      Gate {selectedPhase.progress.code} &middot;{" "}
                      {selectedPhase.progress.name}
                    </h3>
                    {/* Keyed on the phase: choosing another gate is another
                        form, never this one's working copy under its name. */}
                    <PhaseDetails
                      key={selectedPhase.progress.id}
                      phase={selectedPhase}
                      canEdit={canEditProgress}
                      onSave={progress.update}
                      uiBridgeId="overview.timeline.gate-panel.details"
                    />
                  </div>
                )}
              </div>
            )}
            <div
              className={cn(
                "space-y-8",
                view === "calendar" ? "md:hidden" : undefined
              )}
            >
              <PhaseList
                phases={phases}
                milestones={milestoneItems}
                canEdit={canEditProgress}
                onSave={progress.update}
              />
              <ShippedPlansList shipped={shipped} />
            </div>
          </>
        )}
      </Section>

      {milestonesSection}
    </div>
  );
}
