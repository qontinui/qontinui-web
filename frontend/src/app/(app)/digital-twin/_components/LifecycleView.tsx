"use client";

import { useMemo, useState } from "react";
import { useUIElement } from "@qontinui/ui-bridge/react";
import { Provenance } from "@/components/presentation";
import { cn } from "@/lib/utils";
import { useDigitalTwinSubspaces } from "../_hooks/useDigitalTwinSubspaces";
import { useTwinCatalog } from "../_hooks/useTwinCatalog";
import {
  LIFECYCLE_STAGES,
  TWIN_PLANTS,
  gradedOf,
  rowsForStage,
  stageSummary,
  twinSummary,
} from "../_lib/lifecycle";
import type { CoverageCounts, LifecycleStageInfo } from "../_lib/lifecycle";
import { allProbesRestricted, resolveSubspaces } from "../_lib/resolve";
import { COUNT_FILLS, STATUS_STYLES } from "../_lib/status-presentation";
import { FIDELITY_SOURCE } from "../_lib/twin-aspects";
import type { ResolvedSubspace } from "../_lib/types";
import { LensLink } from "./LensLink";
import { SubspaceCell } from "./SubspaceCell";
import { SubspaceDetail } from "./SubspaceDetail";
import {
  CoordUnreachableBanner,
  TwinAccessRestricted,
} from "./TwinProbeNotices";

/**
 * Honesty-bar segments, in order. Only the first is a live verdict; then come
 * reports coord served (an answer, not a verdict), probes coord refused to
 * this operator, probes still in flight (no verdict yet), probes that did not
 * answer, manifest claims, and the roadmap. A served report and a refused
 * sub-space are never counted as "not answering".
 */
const SEGMENTS = [
  {
    key: "live",
    label: "live-probed, answering",
    className: COUNT_FILLS.live,
  },
  {
    key: "served",
    label: "live-probed, a report (not graded)",
    className: "bg-violet-500",
  },
  {
    key: "restricted",
    label: "restricted (not yours to read)",
    className: STATUS_STYLES.restricted.dot,
  },
  {
    key: "pending",
    label: "probing…",
    className: STATUS_STYLES.probing.dot,
  },
  {
    key: "silent",
    label: "probed, not answering",
    className: "bg-sky-500",
  },
  {
    key: "claim",
    label: "built (claim)",
    className: COUNT_FILLS.claim,
  },
  {
    key: "unbuilt",
    label: "planned / not built",
    className: STATUS_STYLES["not-built"].dot,
  },
] as const;

type SegmentKey = (typeof SEGMENTS)[number]["key"];

function segmentValues(c: CoverageCounts): Record<SegmentKey, number> {
  return {
    live: c.live,
    served: c.served,
    restricted: c.restricted,
    pending: c.pending,
    silent: c.probed - c.live - c.pending - c.served - c.restricted,
    claim: c.manifestBuilt,
    unbuilt: c.planned + c.notBuilt,
  };
}

/** A proportional bar over every row; the labelled counts carry the meaning. */
function HonestyBar({ counts }: { counts: CoverageCounts }) {
  const values = segmentValues(counts);
  return (
    <div
      aria-hidden
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      {counts.total > 0 &&
        SEGMENTS.map(
          (s) =>
            values[s.key] > 0 && (
              <div
                key={s.key}
                className={s.className}
                style={{ width: `${(values[s.key] / counts.total) * 100}%` }}
                title={`${values[s.key]} ${s.label}`}
              />
            )
        )}
    </div>
  );
}

/**
 * The legend; the probing entry shows only while a probe is in flight, and the
 * restricted entry only when coord refused at least one probe.
 */
function HonestyLegend({
  probing,
  restricted,
}: {
  probing: boolean;
  restricted: boolean;
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {SEGMENTS.filter(
        (s) =>
          (probing || s.key !== "pending") &&
          (restricted || s.key !== "restricted")
      ).map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", s.className)} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function CountItem({
  label,
  value,
  of,
}: {
  label: string;
  /**
   * `"probing"` while the count has no verdict yet; `"none"` when there is no
   * count to show at all (every probe was refused), rendered as an em dash so
   * it never reads as a 0 that looks like "nothing answered".
   */
  value: number | "probing" | "none";
  of?: number;
}) {
  return (
    <div className="flex flex-col">
      {/* dt before dd in the DOM (a valid <dl>); the number reads first. */}
      <dt className="order-2 text-[11px] leading-tight text-muted-foreground">
        {label}
      </dt>
      <dd className="order-1 text-base font-semibold tabular-nums">
        {value === "probing" ? (
          <span className="text-xs font-normal text-muted-foreground">
            probing…
          </span>
        ) : value === "none" ? (
          <span className="font-normal text-muted-foreground">—</span>
        ) : (
          <>
            {value}
            {of !== undefined && (
              <span className="text-xs font-normal text-muted-foreground">
                /{of}
              </span>
            )}
          </>
        )}
      </dd>
    </div>
  );
}

/**
 * The three labelled counts every stage shows: live vs claim vs roadmap.
 * While a probe is in flight the live count has no verdict, so it reads
 * "probing…" rather than a "0/N" that would look like silence.
 */
function StageCounts({ counts }: { counts: CoverageCounts }) {
  const probing = counts.pending > 0;
  return (
    <dl className="grid grid-cols-3 gap-2">
      <CountItem
        label="live-probed"
        value={probing ? "probing" : counts.live}
        of={!probing && gradedOf(counts) > 0 ? gradedOf(counts) : undefined}
      />
      <CountItem label="built (claim)" value={counts.manifestBuilt} />
      <CountItem
        label="planned / not built"
        value={counts.planned + counts.notBuilt}
      />
    </dl>
  );
}

/** Say in words when nothing at a stage is live-verified. */
function liveProbeNote(counts: CoverageCounts): string | null {
  if (counts.probed === 0) {
    return "No live probe at this stage — every status here is a manifest claim.";
  }
  // While a probe is in flight the live-probed count itself reads "probing…".
  if (counts.pending > 0 || counts.live > 0) return null;
  // A served report beside it does not make a silent verdict probe answer.
  if (gradedOf(counts) > 0) return "No live probe answering at this stage.";
  if (counts.served === 0) {
    return "Every live probe at this stage is restricted for you.";
  }
  return null;
}

/** A twin card's live-probe count — in words while it has no verdict yet. */
function liveProbeSummary(counts: CoverageCounts): string {
  if (counts.pending > 0) return "probing…";
  if (counts.probed === 0) return "no live probe";
  // Nothing here can answer this operator with a verdict: say why, never "0/0".
  if (gradedOf(counts) === 0) {
    return counts.served > 0
      ? `${counts.served} served (not graded)`
      : "all restricted for you";
  }
  return `${counts.live}/${gradedOf(counts)} live-probed`;
}

interface StageSectionProps {
  stage: LifecycleStageInfo;
  /** 1-based position in the lifecycle. */
  position: number;
  rows: ResolvedSubspace[];
  counts: CoverageCounts;
  onSelect: (row: ResolvedSubspace) => void;
}

function StageSection({
  stage,
  position,
  rows,
  counts,
  onSelect,
}: StageSectionProps) {
  const uiId = `digital-twin-stage-${stage.id}`;
  // UI Bridge: one stable id per stage (e.g. `digital-twin-stage-verify`) so
  // automation can wait for the pipeline and address a single stage.
  const { ref } = useUIElement({
    id: uiId,
    label: `Digital Twin lifecycle stage: ${stage.label}`,
    type: "custom",
  });
  const headingId = `${uiId}-heading`;
  const note = liveProbeNote(counts);

  return (
    <li>
      <section
        ref={ref}
        data-testid={uiId}
        aria-labelledby={headingId}
        className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-card p-4 lg:grid-cols-[17rem_minmax(0,1fr)]"
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <h3
              id={headingId}
              className="flex items-baseline gap-2 text-sm font-semibold"
            >
              <span
                aria-hidden
                className="font-mono text-xs text-muted-foreground"
              >
                {position}
              </span>
              {stage.label}
            </h3>
            <p className="text-xs text-muted-foreground">{stage.description}</p>
          </div>

          <div className="space-y-1.5">
            <HonestyBar counts={counts} />
            <StageCounts counts={counts} />
            {note && (
              <p className="text-[11px] text-muted-foreground">{note}</p>
            )}
          </div>

          <p className="text-xs">
            <span className="font-medium">Human touchpoint: </span>
            <span className="text-muted-foreground">
              {stage.humanTouchpoint}
            </span>
          </p>

          {stage.consoleLinks.length > 0 && (
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">Console:</span>
              {stage.consoleLinks.map((link) => (
                // Plain text while presenting unless the page can be
                // presented (LensLink): no click leaves the lens.
                <LensLink
                  key={link.href}
                  href={link.href}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  textClassName="font-medium"
                >
                  {link.label}
                </LensLink>
              ))}
            </p>
          )}
        </div>

        {/* A row shows under every stage it observes, so its cell id is
            scoped by stage — UI Bridge ids must be unique among mounted
            elements (the matrix's `digital-twin-cell-<id>` is unmounted
            while this tab is open). The label names the stage too, so
            label-based targeting is as unambiguous as the id. */}
        <div className="grid grid-cols-1 content-start gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          {rows.map((row) => (
            <SubspaceCell
              key={row.id}
              row={row}
              onSelect={onSelect}
              uiId={`${uiId}-cell-${row.id}`}
              uiLabel={`Digital Twin sub-space cell: ${row.id} (${stage.label} stage)`}
            />
          ))}
        </div>
      </section>
    </li>
  );
}

/**
 * Lifecycle view — the twin of the software-development process: the
 * environment, process and intent twins laid over the lifecycle stages
 * (intent → plan → implement → verify → integrate → release → operate →
 * learn). Same data as the Completeness matrix (the manifest joined with the
 * live snapshot probe), organized by stage, and explicit at every stage about
 * what is live-probed versus only claimed by the manifest.
 */
export function LifecycleView() {
  const { data, isLoading, isError, error, dataUpdatedAt } =
    useDigitalTwinSubspaces();
  // coord's declaration of what the twin probes: the matrix joins the manifest
  // to it, so a row coord declares is live and one it does not is not.
  const { data: catalog } = useTwinCatalog();
  const [selected, setSelected] = useState<ResolvedSubspace | null>(null);

  const rows = useMemo(
    () => resolveSubspaces(data?.subspaces, isLoading, catalog),
    [data?.subspaces, isLoading, catalog]
  );
  const byStage = useMemo(() => stageSummary(rows), [rows]);
  const byTwin = useMemo(() => twinSummary(rows), [rows]);
  const probing = rows.some((r) => r.cellStatus === "probing");
  const anyRestricted = rows.some((r) => r.cellStatus === "restricted");

  // The whole-view notice only when EVERY probe was refused; a single refused
  // sub-space renders as its own `restricted` cell.
  if (allProbesRestricted(data)) return <TwinAccessRestricted />;

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="digital-twin-lifecycle-intro"
        className="space-y-4 rounded-lg border border-border bg-card p-4"
      >
        <div className="space-y-1">
          <h2
            id="digital-twin-lifecycle-intro"
            className="text-sm font-semibold"
          >
            The twin of the software-development process
          </h2>
          <p className="text-xs text-muted-foreground">
            Three coupled twins observe every stage, from intent to what was
            learned. Only the live-probed counts come from a probe this page
            runs; built (claim) counts are what the manifest says is built —
            claims, not live verdicts.
          </p>
          {/* The live counts' source and age, in presentation mode. */}
          <Provenance
            source={FIDELITY_SOURCE.probe}
            asOf={dataUpdatedAt > 0 ? dataUpdatedAt : null}
          />
        </div>

        <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {TWIN_PLANTS.map((plant) => {
            const counts = byTwin[plant.id];
            return (
              <li
                key={plant.id}
                className="space-y-2 rounded-md border border-border p-3"
              >
                <div className="space-y-0.5">
                  <span className="text-sm font-medium">{plant.label}</span>
                  <p className="text-xs text-muted-foreground">
                    {plant.description}
                  </p>
                </div>
                <HonestyBar counts={counts} />
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {liveProbeSummary(counts)} · {counts.manifestBuilt} built
                  (claim) · {counts.planned + counts.notBuilt} planned / not
                  built
                </p>
              </li>
            );
          })}
        </ul>

        <HonestyLegend probing={probing} restricted={anyRestricted} />
      </section>

      {isError && <CoordUnreachableBanner error={error} />}

      <ol className="space-y-4">
        {LIFECYCLE_STAGES.map((stage, index) => (
          <StageSection
            key={stage.id}
            stage={stage}
            position={index + 1}
            rows={rowsForStage(rows, stage.id)}
            counts={byStage[stage.id]}
            onSelect={setSelected}
          />
        ))}
      </ol>

      <SubspaceDetail
        row={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}
