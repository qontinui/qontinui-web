"use client";

/**
 * `objective-checkpoints metric=<name>` — a success measure's checkpoint
 * results, from the objectives read (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3, D9;
 * the read is plan `2026-11-07-overview-objectives-view-web-half-lands-by-successor`).
 *
 * That read is not served by every backend yet, and the block keeps the two
 * kinds of failure apart:
 *
 * - **404** — a backend that predates the objectives read: "not available
 *   yet". Only a 404 says this.
 * - **anything else** — a 5xx, a refusal, a dropped connection, an answer in
 *   a form this page cannot read: "can't be read right now". Never "not
 *   available yet", which would claim the feature is missing when the read
 *   merely failed.
 *
 * When it serves, the block shows each checkpoint of the named measure: its
 * name, its due date and the tally of its criteria. The shape is read
 * defensively, field by field, because the objectives view's own types land
 * with that plan; a measure the read does not return is "no measure named …"
 * only when the read says its document list is complete.
 */

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { describeFailure } from "@/components/overview/LoadFailure";
import {
  ResourceError,
  fetchObjectives,
} from "@/components/overview/editing/api";
import { Provenance } from "@/components/presentation/Provenance";
import { useOverviewProject } from "@/app/(app)/overview/_hooks/useOverviewProject";
import { formatDay } from "@/app/(app)/overview/_lib/timeline";
import type { DataBlockProps, ObjectiveCheckpointsArgs } from "./blockArgs";
import { BlockFrame, BlockNotice } from "./blockChrome";

const SOURCE = "the project's success measures";

type ObjectivesRead =
  | { state: "loading" }
  | { state: "not-served" }
  | { state: "failed"; message: string }
  | { state: "ready"; body: unknown };

interface Checkpoint {
  id: string;
  label: string | null;
  due: string | null;
  statusReason: string | null;
  tally: { met: number; missed: number; unknown: number };
}

type Lookup =
  | {
      kind: "found";
      title: string;
      checkpoints: Checkpoint[];
      asOf: string | null;
    }
  | { kind: "absent" }
  | { kind: "uncertain" }
  | { kind: "unreadable" };

function useObjectives(
  projectId: string | null,
  hold: boolean
): ObjectivesRead {
  const [read, setRead] = useState<ObjectivesRead>({ state: "loading" });
  useEffect(() => {
    if (hold) return;
    let live = true;
    setRead({ state: "loading" });
    fetchObjectives<unknown>().then(
      (body) => live && setRead({ state: "ready", body }),
      (err: unknown) => {
        if (!live) return;
        if (err instanceof ResourceError && err.status === 404) {
          setRead({ state: "not-served" });
        } else {
          setRead({
            state: "failed",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    );
    return () => {
      live = false;
    };
  }, [projectId, hold]);
  return read;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const textOrNull = (v: unknown): string | null | undefined =>
  v === null ? null : typeof v === "string" ? v : undefined;
const count = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;

function readCheckpoint(raw: unknown): Checkpoint | null {
  if (!isObject(raw) || typeof raw.id !== "string") return null;
  const label = textOrNull(raw.label);
  const due = textOrNull(raw.due);
  const statusReason = textOrNull(raw.status_reason);
  const tally = isObject(raw.tally) ? raw.tally : null;
  const met = count(tally?.met);
  const missed = count(tally?.missed);
  const unknown = count(tally?.unknown);
  if (
    label === undefined ||
    due === undefined ||
    statusReason === undefined ||
    met === undefined ||
    missed === undefined ||
    unknown === undefined
  ) {
    return null;
  }
  return {
    id: raw.id,
    label,
    due,
    statusReason,
    tally: { met, missed, unknown },
  };
}

/** The named measure in the objectives read, read field by field. */
export function lookUpMeasure(body: unknown, name: string): Lookup {
  if (!isObject(body) || !Array.isArray(body.metrics)) {
    return { kind: "unreadable" };
  }
  const metric = body.metrics.find((m) => isObject(m) && m.name === name);
  if (!isObject(metric)) {
    // A list the read could not vouch for may be missing this measure.
    return body.document_list_complete === true
      ? { kind: "absent" }
      : { kind: "uncertain" };
  }
  if (!Array.isArray(metric.checkpoint_results)) return { kind: "unreadable" };
  const checkpoints = metric.checkpoint_results.map(readCheckpoint);
  if (checkpoints.some((c) => c === null)) return { kind: "unreadable" };
  return {
    kind: "found",
    title:
      typeof metric.title === "string" && metric.title ? metric.title : name,
    checkpoints: checkpoints as Checkpoint[],
    asOf: typeof body.generated_at === "string" ? body.generated_at : null,
  };
}

function tallyWords({ met, missed, unknown }: Checkpoint["tally"]): string {
  return `${met} met, ${missed} missed, ${unknown} not measured`;
}

function Body({ metric, uiBridgeId }: { metric: string; uiBridgeId: string }) {
  const { projectId, hold, tenantsError } = useOverviewProject();
  const read = useObjectives(projectId, hold);
  const cantRead = (detail: string) => (
    <BlockNotice
      tone="problem"
      title="Checkpoint results can't be read right now."
      detail={detail}
      uiBridgeId={`${uiBridgeId}.error`}
    />
  );
  if (tenantsError) return cantRead(describeFailure(tenantsError));
  if (read.state === "loading") {
    return (
      <div
        className="space-y-2"
        aria-hidden
        data-ui-bridge-id={`${uiBridgeId}.loading`}
      >
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }
  if (read.state === "not-served") {
    return (
      <BlockNotice
        title="Checkpoint results are not available yet"
        detail="This project's overview doesn't serve its success measures' checkpoints yet. When it does, this block will show them."
        uiBridgeId={`${uiBridgeId}.not-available`}
      />
    );
  }
  if (read.state === "failed") return cantRead(describeFailure(read.message));
  const found = lookUpMeasure(read.body, metric);
  if (found.kind === "unreadable") {
    return cantRead("The answer came back in a form this page can't read.");
  }
  if (found.kind !== "found") {
    return (
      <BlockNotice
        tone="problem"
        title={
          <>
            No measure named <code>{metric}</code>{" "}
            {found.kind === "absent" ? "in this project" : "was returned"}
          </>
        }
        detail={
          found.kind === "absent"
            ? "Check the measure's name in this block's settings."
            : "The list of measures may be incomplete right now, so it may still exist."
        }
        uiBridgeId={`${uiBridgeId}.missing`}
      />
    );
  }
  return (
    <>
      <h3 className="font-medium text-foreground">
        {found.title}: checkpoints
      </h3>
      {found.checkpoints.length === 0 ? (
        <p className="mt-1 text-muted-foreground">
          This measure declares no checkpoints.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {found.checkpoints.map((c) => (
            <li
              key={c.id}
              className="border-t border-border/60 pt-2"
              data-ui-bridge-id={`${uiBridgeId}.checkpoint.${c.id}`}
            >
              <p className="text-foreground">
                {c.label ?? c.id}
                <span className="ml-2 text-xs text-muted-foreground">
                  {c.due
                    ? `due ${formatDay(c.due) ?? c.due}`
                    : "no due date given"}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {tallyWords(c.tally)}
              </p>
              {c.statusReason && (
                <p className="text-xs text-muted-foreground">
                  {c.statusReason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2">
        <Provenance persistent source={SOURCE} asOf={found.asOf} />
      </div>
    </>
  );
}

export function ObjectiveCheckpoints({
  args,
}: DataBlockProps<ObjectiveCheckpointsArgs>) {
  const uiBridgeId = `overview.block.objective-checkpoints.${args.metric}`;
  return (
    <BlockFrame
      name="objective-checkpoints"
      uiBridgeId={uiBridgeId}
      label="Success measure checkpoints"
    >
      <Body metric={args.metric} uiBridgeId={uiBridgeId} />
    </BlockFrame>
  );
}
