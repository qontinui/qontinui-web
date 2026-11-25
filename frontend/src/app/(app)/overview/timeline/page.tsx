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
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { useCanEdit } from "@/components/overview/editing/permissions";
import {
  useResourceList,
  useResourceRecord,
} from "@/components/overview/editing/useResource";
import { cn } from "@/lib/utils";
import { useOverviewProject } from "../_hooks/useOverviewProject";
import { useSchedule } from "../_hooks/useSchedule";
import {
  ESTIMATES,
  pickBaseline,
  type EstimateRecord,
  type PhaseTaskRead,
} from "../_lib/estimate-api";
import type { PhaseChoice } from "../_lib/milestones";
import { mergeMilestones, overlayPhases } from "../_lib/schedule";
import type { ScheduleEnvelope } from "../_lib/schedule-api";
import {
  MILESTONES,
  MILESTONES_PATH,
  PHASE_PROGRESS,
  PHASE_PROGRESS_PATH,
  fetchForecast,
  type Milestone,
  type PhaseProgress,
  type PhaseProgressPatch,
  type TimelineForecast,
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
import { ProvenanceLine } from "./_components/ProvenanceLine";
import {
  ScheduleSection,
  SchedulePhaseList,
} from "./_components/ScheduleSection";
import { TimelineChart } from "./_components/TimelineChart";
import { TimelineHeader } from "./_components/TimelineHeader";

type ForecastState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; forecast: TimelineForecast };

/** The forecast for `estimateId`, re-read whenever `token` moves (after a
 *  progress write, which is what changes it). */
function useForecast(estimateId: string | null, hold: boolean, token: number) {
  const [value, setValue] = useState<ForecastState>({ state: "loading" });
  useEffect(() => {
    if (hold || estimateId === null) return;
    let live = true;
    fetchForecast(estimateId).then(
      (forecast) => live && setValue({ state: "ready", forecast }),
      (err: unknown) =>
        live &&
        setValue({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        })
    );
    return () => {
      live = false;
    };
  }, [estimateId, hold, token]);
  return value;
}

/** True when the schedule was READ and says there is nothing to draw: no
 *  programme, or a programme with no phases. A failed or truncated read is not
 *  that - it is unknown, and the schedule section says so itself. */
function scheduleIsEmpty(env: ScheduleEnvelope): boolean {
  const phases = env.phases;
  if (phases.value !== null) return phases.value.length === 0;
  return (
    phases.unknown_reason === "no_programme" ||
    phases.unknown_reason === "no_phases"
  );
}

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
  const schedule = useSchedule(projectId, hold);
  const [forecastToken, setForecastToken] = useState(0);
  const forecast = useForecast(estimateId, hold, forecastToken);

  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [zoom, setZoom] = useState<Zoom>("project");
  const [selected, setSelected] = useState<string | null>(null);

  const updateProgress = progress.update;
  const onSaveProgress = useCallback(
    async (current: PhaseProgress, patch: PhaseProgressPatch) => {
      const result = await updateProgress(current, patch);
      // Progress is what the forecast is computed from.
      if (result.ok) setForecastToken((n) => n + 1);
      return result;
    },
    [updateProgress]
  );

  const content =
    record.record.state === "ready" ? record.record.item.content : null;
  const tasks = useMemo(() => {
    const byPhase = new Map<string, PhaseTaskRead[]>();
    for (const phase of content?.phases ?? [])
      byPhase.set(phase.id, phase.tasks);
    return byPhase;
  }, [content]);
  const breaks = content?.calendar_breaks ?? [];
  // Coord's phases laid over the estimate's, matched by equal code only.
  const coordPhases = schedule.data?.phases.value ?? null;
  const overlay = useMemo(
    () =>
      overlayPhases(
        progress.list.state === "ready" ? progress.list.items : [],
        coordPhases
      ),
    [progress.list, coordPhases]
  );
  const phases = useMemo(
    () =>
      progress.list.state === "ready"
        ? assemblePhases(
            progress.list.items,
            tasks,
            forecast.state === "ready" ? forecast.forecast.phases : null,
            overlay.matched
          )
        : [],
    [progress.list, tasks, forecast, overlay]
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
  const milestoneItems = useMemo(
    () => (milestones.list.state === "ready" ? milestones.list.items : []),
    [milestones.list]
  );
  const lane = useMemo(
    () =>
      mergeMilestones(
        milestoneItems,
        schedule.data?.milestones.items.value ?? null
      ),
    [milestoneItems, schedule.data]
  );

  const today =
    toDay(forecast.state === "ready" ? forecast.forecast.today : null) ??
    new Date();
  const projectSpan = projectWindow([
    ...phases.flatMap((p) => [
      p.progress.planned_start,
      p.progress.planned_end,
      p.coord ? p.coord.start.day : p.progress.actual_start,
      p.coord ? p.coord.end.day : p.progress.actual_end,
      p.forecast?.forecast_end,
    ]),
    ...lane.map((m) => m.date),
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
        {schedule.loading && !schedule.data && (
          <Loading uiBridgeId="overview.schedule.loading" />
        )}
        {schedule.data && (
          <ScheduleSection
            env={schedule.data}
            typedMilestones={milestoneItems}
          />
        )}
        {schedule.error && (
          <LoadFailure
            what={
              schedule.data
                ? "the latest update of the schedule"
                : "the schedule from the project record"
            }
            message={schedule.error}
            uiBridgeId="overview.schedule.error"
            announce={false}
          />
        )}
        {schedule.data && scheduleIsEmpty(schedule.data) && (
          <NoEstimate canEdit={canEditEstimate} />
        )}
        {milestonesSection}
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
        {schedule.data && coordPhases && (
          <div
            className="mt-6 space-y-2"
            data-ui-bridge-id="overview.timeline.overlay"
          >
            {overlay.disagreements > 0 && (
              <p
                role="note"
                className="max-w-[46rem] rounded-md border border-amber-500/40 px-3 py-2 text-sm text-foreground"
                data-ui-bridge-id="overview.timeline.overlay.disagreements"
                data-count={overlay.disagreements}
              >
                {overlay.disagreements === 1
                  ? "1 date differs from the project record."
                  : `${overlay.disagreements} dates differ from the project record.`}{" "}
                The project record&rsquo;s date is drawn; the entered one is
                shown beside it in the phase&rsquo;s details and is not changed.
              </p>
            )}
            <ProvenanceLine
              observedAt={schedule.data.observed_at}
              stale={schedule.data.stale}
              sources={schedule.data.sources}
              uiBridgeId="overview.timeline.overlay.provenance"
            />
          </div>
        )}
        {schedule.error && !schedule.data && (
          <div className="mt-6">
            <LoadFailure
              what="the schedule from the project record"
              message={schedule.error}
              uiBridgeId="overview.timeline.overlay.error"
              announce={false}
            />
          </div>
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
                      lane={lane}
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
                    <PhaseDetails
                      phase={selectedPhase}
                      canEdit={canEditProgress}
                      onSave={onSaveProgress}
                      uiBridgeId="overview.timeline.gate-panel.details"
                    />
                  </div>
                )}
              </div>
            )}
            <div className={view === "calendar" ? "md:hidden" : undefined}>
              <PhaseList
                phases={phases}
                milestones={milestoneItems}
                canEdit={canEditProgress}
                onSave={onSaveProgress}
              />
            </div>
          </>
        )}
        {overlay.coordOnly.length > 0 && (
          <div
            className="mt-8"
            data-ui-bridge-id="overview.timeline.coord-only"
          >
            <h3 className="mb-2 font-[family-name:var(--font-overview-serif)] text-lg text-foreground">
              Also in the project record
            </h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Phases the project record holds that no phase of the estimate
              shares a code with.
            </p>
            <SchedulePhaseList phases={overlay.coordOnly} />
          </div>
        )}
      </Section>

      {milestonesSection}
    </div>
  );
}
