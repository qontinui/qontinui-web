"use client";

/**
 * One group of measures on the Objectives page (plan
 * `2026-10-06-overview-objectives-view` D1): an initiative's objective, or
 * "Measures the initiative names", or "Other measures". A metric's first
 * appearance on the page is its card; any later one is a link to that card,
 * never a second copy. An objective no measure serves says so, never blank.
 */

import { metricAnchor, type GroupItem } from "../../_lib/objectives";
import type { MetricRead } from "../../_lib/objectives-api";
import { MetricCard, type CardEditing } from "./MetricCard";
import { ObjectiveCoverage } from "./ObjectiveCoverage";
import { MUTED, SERIF, TEXT_LINK, bridgeSafe } from "./ui";

function MetricLink({
  metric,
  uiBridgeId,
}: {
  metric: MetricRead;
  uiBridgeId: string;
}) {
  return (
    <p className={MUTED} data-ui-bridge-id={uiBridgeId}>
      Measured by{" "}
      <a
        href={`#${metricAnchor(metric.name)}`}
        className={TEXT_LINK}
        onClick={() => {
          // Move focus with the jump, so keyboard and screen-reader users
          // land on the card they asked for.
          requestAnimationFrame(() =>
            document.getElementById(metricAnchor(metric.name))?.focus()
          );
        }}
      >
        {metric.title}
      </a>
      , whose card appears once on this page.
    </p>
  );
}

export function ObjectiveGroup({
  heading,
  headingLevel,
  objectiveId,
  items,
  metrics,
  editing,
  empty,
  uiBridgeId,
}: {
  heading: string;
  /** h3 for an objective under its initiative; h2 for a page-level group. */
  headingLevel: 2 | 3;
  /** Set for an initiative objective: its coverage slot (D11). */
  objectiveId?: string;
  items: GroupItem[];
  metrics: ReadonlyMap<string, MetricRead>;
  editing: CardEditing;
  /** What an empty group says. */
  empty: string;
  uiBridgeId: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const headingClass =
    headingLevel === 2
      ? `${SERIF} text-[1.625rem] leading-snug text-foreground`
      : "text-[17px] font-medium leading-snug text-foreground";
  return (
    <section className="space-y-4" data-ui-bridge-id={uiBridgeId}>
      <Heading className={headingClass}>{heading}</Heading>
      {objectiveId && <ObjectiveCoverage objectiveId={objectiveId} />}
      {items.length === 0 ? (
        <p className={MUTED} data-ui-bridge-id={`${uiBridgeId}.empty`}>
          {empty}
        </p>
      ) : (
        items.map((item) => {
          const metric = metrics.get(item.name);
          if (!metric) return null;
          return item.primary ? (
            <MetricCard
              // A new version is a new card: its editor and text start over.
              key={`${item.name}@${metric.version}`}
              metric={metric}
              editing={editing}
              headingLevel={headingLevel === 2 ? 3 : 4}
            />
          ) : (
            <MetricLink
              key={item.name}
              metric={metric}
              uiBridgeId={`${uiBridgeId}.link-${bridgeSafe(item.name)}`}
            />
          );
        })
      )}
    </section>
  );
}
