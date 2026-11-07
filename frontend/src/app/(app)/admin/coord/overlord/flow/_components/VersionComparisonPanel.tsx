"use client";

/**
 * Do the flow numbers move when the overlord changes? One line per overlord
 * version (every script, the `/next-move` brief and the runner build) that ran
 * in the window, from coord's `group_by=overlord_version` groups — the reason
 * the ledger records versions at all (the plan's "whether any of those numbers
 * moves when the overlord changes").
 */

import { GitCompare } from "lucide-react";
import { CollapsiblePanel } from "@/components/console";
import {
  CAPPED_READ_NOTE,
  NO_DATA,
  countWords,
  durationWords,
  metricTitle,
  metricValue,
  percentWords,
  versionChanges,
  versionMapWords,
  groupVersionWords,
  type Metric,
  type VersionGroup,
} from "../_lib/overlordFlowStatus";

const UNKNOWN = "–";

/**
 * A `0` needs passes that could have shown one: unchanged takes this many census
 * passes in a row, so fewer can only ever read zero. A count above zero is its
 * own proof. A zero whose census count did not arrive is unknown, not too few.
 */
function unchangedState(
  g: VersionGroup,
  minPasses: number | undefined
): "count" | "too-few" | "unknown" {
  if (g.unchanged !== 0) return "count";
  if (minPasses === undefined || g.censusPasses === undefined) return "unknown";
  return g.censusPasses >= minPasses ? "count" : "too-few";
}

/** Title for a version cell: its map, or why there is none. */
function versionTitle(g: VersionGroup): string {
  if (g.version === null) {
    return "unknown version — these passes recorded none, or missed reading one their runner had read before";
  }
  return (
    versionMapWords(g.versions) ??
    `${g.version} — coord did not say which versions this is over`
  );
}

/** What changed since the previous version, in words. */
function ChangedCell({
  groups,
  index,
}: {
  groups: VersionGroup[];
  index: number;
}) {
  const changed = versionChanges(groups, index);
  return (
    <td
      className="py-1 pr-3 font-mono"
      data-testid="overlord-flow-versions-changed"
      title={
        changed === null
          ? "nothing to compare against: the first version with a readable map, an unknown version, or a map coord did not serve"
          : "entries that differ from the previous version; one that only one side recorded may differ"
      }
    >
      {changed === null
        ? UNKNOWN
        : changed.length === 0
          ? "same map"
          : changed.join(", ")}
    </td>
  );
}

function MetricCell({
  m,
  format,
  noData,
}: {
  m: Metric;
  format: (n: number) => string;
  noData: string;
}) {
  return (
    <td className="py-1 pr-3 tabular-nums" title={metricTitle(m, noData)}>
      {metricValue(m, format) ?? UNKNOWN}
    </td>
  );
}

function CountCell({
  n,
  cut,
}: {
  n: number | undefined;
  /** The count is of a list coord cut, or did not say it kept whole: a floor. */
  cut?: boolean;
}) {
  return (
    <td
      className="py-1 pr-3 tabular-nums"
      title={
        n === undefined
          ? "unknown — coord's answer did not carry this number"
          : cut
            ? "at least this many — coord cut this list, or did not say it kept all of it"
            : undefined
      }
    >
      {n === undefined ? UNKNOWN : countWords(n, cut === true)}
    </td>
  );
}

export function VersionComparisonPanel({
  groups,
  reading,
  capped,
  unchangedMinPasses,
}: {
  /** The threshold coord applied, which a version needs to show an unchanged row. */
  unchangedMinPasses: number | undefined;
  /** `null` = the groups have not been read, or could not be: unknown, not none. */
  groups: VersionGroup[] | null;
  /** No read has answered yet, so `groups === null` says nothing about coord. */
  reading: boolean;
  /** coord's `truncated`: the passes behind this table were themselves capped. */
  capped: boolean;
}) {
  return (
    <CollapsiblePanel
      title="By overlord version"
      titleAs="h2"
      icon={
        <GitCompare className="h-4 w-4 text-muted-foreground" aria-hidden />
      }
      summary={
        <span
          className="text-xs normal-case tracking-normal text-muted-foreground"
          data-testid="overlord-flow-versions-summary"
        >
          {reading
            ? "reading…"
            : groups === null
              ? "not read — unknown"
              : `${groups.length} ${groups.length === 1 ? "version" : "versions"}`}
        </span>
      }
      storageKey="coord-overlord-flow-versions-open"
      data-testid="overlord-flow-versions"
    >
      {reading ? (
        <p
          className="text-sm text-muted-foreground m-0"
          data-testid="overlord-flow-versions-reading"
        >
          Reading the pass ledger…
        </p>
      ) : groups === null ? (
        <p
          className="text-sm text-muted-foreground italic m-0"
          data-testid="overlord-flow-versions-unknown"
        >
          No readable per-version numbers from coord — this is unknown, not an
          overlord that never changed.
        </p>
      ) : groups.length === 0 ? (
        <p
          className="text-sm text-muted-foreground italic m-0"
          data-testid="overlord-flow-versions-empty"
        >
          No triage pass in this window, so there is no version to compare.
        </p>
      ) : (
        <div className="space-y-1">
          {capped && (
            <p
              className="text-xs text-muted-foreground m-0"
              data-testid="overlord-flow-versions-capped"
            >
              {CAPPED_READ_NOTE}
            </p>
          )}
          {/* Focusable: on a narrow screen the keyboard must reach the columns. */}
          <div
            className="overflow-x-auto"
            role="region"
            aria-label="Flow numbers per overlord version"
            tabIndex={0}
          >
            <table
              className="w-full text-left text-xs"
              data-testid="overlord-flow-versions-table"
            >
              <caption className="sr-only">
                Flow numbers per overlord version, oldest version first
              </caption>
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="font-normal pb-1 pr-3">
                    version
                  </th>
                  <th scope="col" className="font-normal pb-1 pr-3">
                    changed
                  </th>
                  <th scope="col" className="font-normal pb-1 pr-3">
                    passes
                  </th>
                  <th scope="col" className="font-normal pb-1 pr-3">
                    census
                  </th>
                  <th scope="col" className="font-normal pb-1 pr-3">
                    closed
                  </th>
                  <th scope="col" className="font-normal pb-1 pr-3">
                    median
                  </th>
                  <th scope="col" className="font-normal pb-1 pr-3">
                    p90
                  </th>
                  <th scope="col" className="font-normal pb-1 pr-3">
                    nudged
                  </th>
                  <th scope="col" className="font-normal pb-1 pr-3">
                    progressed
                  </th>
                  <th scope="col" className="font-normal pb-1 pr-3">
                    finished
                  </th>
                  <th scope="col" className="font-normal pb-1 pr-3">
                    unchanged
                  </th>
                  <th scope="col" className="font-normal pb-1">
                    unknown, latest
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, i) => (
                  <tr
                    key={g.version === null ? "no-version" : `v:${g.version}`}
                    data-testid="overlord-flow-versions-row"
                  >
                    <th
                      scope="row"
                      className="font-mono font-normal py-1 pr-3"
                      title={versionTitle(g)}
                    >
                      {groupVersionWords(g.version)}
                    </th>
                    <ChangedCell groups={groups} index={i} />
                    <CountCell n={g.passes} />
                    <CountCell n={g.censusPasses} />
                    <CountCell n={g.closed} />
                    <MetricCell
                      m={g.medianSecs}
                      format={durationWords}
                      noData="no session closed within this version's passes"
                    />
                    <MetricCell
                      m={g.p90Secs}
                      format={durationWords}
                      noData="no session closed within this version's passes"
                    />
                    <CountCell n={g.nudged} />
                    <MetricCell
                      m={g.progressRate}
                      format={percentWords}
                      noData="no nudge under this version has a progress measurement"
                    />
                    <MetricCell
                      m={g.finishRate}
                      format={percentWords}
                      noData="no nudge under this version has been measured"
                    />
                    {unchangedState(g, unchangedMinPasses) === "too-few" ? (
                      <td
                        className="py-1 pr-3"
                        title={`no data — fewer than ${unchangedMinPasses} census passes, too few to show an unchanged session`}
                      >
                        {NO_DATA}
                      </td>
                    ) : (
                      <CountCell
                        n={
                          unchangedState(g, unchangedMinPasses) === "unknown"
                            ? undefined
                            : g.unchanged
                        }
                        cut={g.unchangedTruncated !== false}
                      />
                    )}
                    <MetricCell
                      m={g.latestUnknownShare}
                      format={percentWords}
                      noData="this version's latest pass screened no terminal"
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p
            className="text-[11px] text-muted-foreground m-0"
            data-testid="overlord-flow-versions-caption"
          >
            A version is a digest over every script, the /next-move brief and
            the runner build a pass recorded, oldest first; hover it for the
            shas, and &ldquo;changed&rdquo; names what differs from the version
            before. &ldquo;not read&rdquo; is an unknown version: a pass that
            recorded none, or missed one its runner had read before. Each line
            is worked out from that version&apos;s own passes as if no others
            ran, so a stop or close seen under another version does not count
            here. A session that stopped before this version ran and closed
            under it can show a shorter time than its real one, or none. An
            unchanged 0 is per version too: it does not prove every runner ran
            enough passes. &ldquo;no data&rdquo; means coord had nothing to
            measure for that version, a dash means the number did not arrive or
            is a cut list with no rows, and a ≥ means a list coord cut, so the
            count is a floor.
          </p>
        </div>
      )}
    </CollapsiblePanel>
  );
}
