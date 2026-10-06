"use client";

/**
 * Project Overview — Objectives: what the project is aiming for, and how each
 * measure of success is doing (plan `2026-10-06-overview-objectives-view`).
 *
 * Organised by objective — the live initiative's `in_scope` items, each with
 * the measures that serve it — then "Measures the initiative names", then
 * "Other measures". Everything comes from one server-side read
 * (`GET /api/v1/overview/objectives`); the page parses no prose and no YAML,
 * and it never states a verdict the measurer did not.
 *
 * Every gap in what could be read is said in its own words. An unreadable
 * source is never shown as "no results".
 */

import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { useCanEdit } from "@/components/overview/editing/permissions";
import { useObjectives } from "../_hooks/useObjectives";
import { useOverviewProject } from "../_hooks/useOverviewProject";
import {
  groupObjectives,
  hiddenCopy,
  shortDay,
  sourceNotices,
  type InitiativeGroupModel,
} from "../_lib/objectives";
import type { MetricRead, ObjectivesRead } from "../_lib/objectives-api";
import { ObjectiveGroup } from "./_components/ObjectiveGroup";
import type { CardEditing } from "./_components/MetricCard";
import { DISCLOSURE, MUTED, NOTICE, SERIF, bridgeSafe } from "./_components/ui";

const NO_MEASURE = "No measure declared for this objective yet.";

function period(group: InitiativeGroupModel): string | null {
  const from = shortDay(group.initiative.starts);
  const to = shortDay(group.initiative.ends);
  if (from && to) return `${from} to ${to}`;
  return from ? `From ${from}` : to ? `Until ${to}` : null;
}

function InitiativeBlock({
  group,
  metrics,
  editing,
}: {
  group: InitiativeGroupModel;
  metrics: ReadonlyMap<string, MetricRead>;
  editing: CardEditing;
}) {
  const { initiative } = group;
  const base = `overview.objectives.initiative.${bridgeSafe(initiative.name)}`;
  const when = period(group);
  return (
    <section className="space-y-8" data-ui-bridge-id={base}>
      <div>
        <h2 className={`${SERIF} text-[1.625rem] leading-snug text-foreground`}>
          {initiative.title}
        </h2>
        <p className={MUTED}>
          {initiative.live
            ? "Live"
            : (initiative.status ?? "Status not declared")}
          {when ? ` · ${when}` : ""}
        </p>
        {initiative.missing_metric_names.length > 0 && (
          <p
            className={`mt-1 ${MUTED}`}
            data-ui-bridge-id={`${base}.missing-measures`}
          >
            It names{" "}
            {initiative.missing_metric_names.length === 1
              ? "a measure"
              : "measures"}{" "}
            with no readable document:{" "}
            {initiative.missing_metric_names.join(", ")}.
          </p>
        )}
      </div>
      {group.objectives.length === 0 ? (
        <p className={MUTED} data-ui-bridge-id={`${base}.no-objectives`}>
          This initiative declares no objectives.
        </p>
      ) : (
        group.objectives.map((objective) => (
          <ObjectiveGroup
            key={objective.id}
            heading={objective.text}
            headingLevel={3}
            objectiveId={objective.id}
            items={objective.items}
            metrics={metrics}
            editing={editing}
            empty={NO_MEASURE}
            uiBridgeId={`${base}.objective.${bridgeSafe(objective.id)}`}
          />
        ))
      )}
    </section>
  );
}

function Notices({ read }: { read: ObjectivesRead }) {
  // The objectives-unreadable banner already carries the documents' reason;
  // a second notice for the same failure would say it twice.
  const notices = sourceNotices(read).filter(
    (n) => read.objectives_readable || n.key !== "intent_documents"
  );
  const hidden = hiddenCopy(read);
  return (
    <>
      {!read.objectives_readable && (
        <div
          role="status"
          className={NOTICE}
          data-ui-bridge-id="overview.objectives.objectives-unreadable"
        >
          <p className="text-[15px] leading-relaxed text-foreground">
            The project&rsquo;s objectives can&rsquo;t be read.
          </p>
          {read.sources.intent_documents.reason && (
            <p className={`mt-1 ${MUTED}`}>
              {read.sources.intent_documents.reason}
            </p>
          )}
        </div>
      )}
      {notices.map((n) => (
        <div
          key={n.key}
          role="status"
          className={NOTICE}
          data-ui-bridge-id={`overview.objectives.source.${n.key}`}
          data-status={read.sources[n.key].status}
        >
          <p className="text-[15px] leading-relaxed text-foreground">
            {n.text}
          </p>
          {n.detail && (
            <details className="mt-1 text-xs text-muted-foreground">
              <summary className={DISCLOSURE}>Technical details</summary>
              <p className="mt-1 break-words font-mono">{n.detail}</p>
            </details>
          )}
        </div>
      ))}
      {hidden.map((line, i) => (
        <p
          key={line}
          className={MUTED}
          data-ui-bridge-id={`overview.objectives.hidden.${i}`}
        >
          {line}
        </p>
      ))}
    </>
  );
}

function Objectives({
  read,
  editing,
}: {
  read: ObjectivesRead;
  editing: CardEditing;
}) {
  const model = groupObjectives(read);
  const metrics = new Map(read.metrics.map((m) => [m.name, m]));
  const documentsUnknown = read.sources.intent_documents.status !== "ok";
  return (
    <div className="space-y-12">
      <div className="space-y-3">
        <Notices read={read} />
      </div>
      {model.live.map((group) => (
        <InitiativeBlock
          key={group.initiative.name}
          group={group}
          metrics={metrics}
          editing={editing}
        />
      ))}
      {model.earlier.length > 0 && (
        <details data-ui-bridge-id="overview.objectives.earlier">
          <summary className={DISCLOSURE}>
            Earlier and other initiatives (
            {read.earlier_initiatives_count || model.earlier.length})
          </summary>
          <div className="mt-6 space-y-12">
            {model.earlier.map((group) => (
              <InitiativeBlock
                key={group.initiative.name}
                group={group}
                metrics={metrics}
                editing={editing}
              />
            ))}
          </div>
        </details>
      )}
      {model.named.length > 0 && (
        <ObjectiveGroup
          heading="Measures the initiative names"
          headingLevel={2}
          items={model.named}
          metrics={metrics}
          editing={editing}
          empty=""
          uiBridgeId="overview.objectives.named"
        />
      )}
      {model.other.length > 0 && (
        <ObjectiveGroup
          heading="Other measures"
          headingLevel={2}
          items={model.other}
          metrics={metrics}
          editing={editing}
          empty=""
          uiBridgeId="overview.objectives.other"
        />
      )}
      {read.metrics.length === 0 && (
        <p
          className={MUTED}
          data-ui-bridge-id="overview.objectives.no-measures"
        >
          {documentsUnknown
            ? "Whether the project has measures of success is unknown: its documents couldn't be fully read."
            : "No measures of success have been written yet. Add one from the Summary."}
        </p>
      )}
    </div>
  );
}

export default function OverviewObjectivesPage() {
  const { projectId, hold, tenantsError, viewerId } = useOverviewProject();
  // The served permission for the project on screen — never `isCoordAdmin`.
  const canEdit = useCanEdit("intent_documents");
  const { objectives } = useObjectives(projectId, hold);
  const editing: CardEditing = { canEdit, projectId, viewerId };

  // A link to one card (`#metric-<name>`, from the Summary) lands on it once
  // the cards exist: the browser's own jump ran before they were rendered.
  const ready = objectives.state === "ready";
  useEffect(() => {
    if (!ready) return;
    let id = window.location.hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // A malformed escape: look the raw hash up instead.
    }
    if (!id) return;
    const card = document.getElementById(id);
    if (!card) return;
    card.scrollIntoView({ block: "start" });
    card.focus({ preventScroll: true });
  }, [ready]);

  if (tenantsError) {
    return (
      <LoadFailure
        what="the list of projects"
        message={tenantsError}
        uiBridgeId="overview.objectives.tenants.error"
      />
    );
  }

  return (
    <div
      className="max-w-[48rem] space-y-10"
      data-ui-bridge-id="overview.objectives"
      aria-busy={objectives.state === "loading"}
    >
      <p className="text-[15px] leading-relaxed text-muted-foreground">
        What the project is aiming for, and how each measure is doing. A verdict
        here is the one its measurer reported, with the date it was measured;
        &ldquo;unknown&rdquo; means nobody could say, not that a target was
        missed.
      </p>
      {objectives.state === "loading" && (
        <div className="space-y-3" aria-hidden>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {objectives.state === "error" && (
        <LoadFailure
          what="the project's objectives and measures"
          message={objectives.message}
          uiBridgeId="overview.objectives.error"
        />
      )}
      {objectives.state === "ready" && (
        <Objectives read={objectives.read} editing={editing} />
      )}
    </div>
  );
}
