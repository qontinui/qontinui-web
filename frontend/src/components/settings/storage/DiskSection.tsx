"use client";

/**
 * Disk section of `/settings/storage` — free space for this device plus a
 * read-only preview of what could be reclaimed.
 *
 * Plan: `2026-08-07-product-disk-monitoring-and-cleanup.md` Phase 2 step 4.
 *
 * Two data paths, both of which can fail independently and must SAY SO
 * independently:
 *
 * 1. **Free space** — Phase 1's per-device route
 *    (`GET /operations/devices/{id}/volumes`, via `deviceVolumesUrl()`), read
 *    through the backend proxy. This section is that route's first consumer;
 *    Phase 1 shipped it deliberately unwired.
 * 2. **Reclaim candidates** — the runner's own loopback survey
 *    (`GET :9876/disk/reclaimable`), which classifies cargo target roots and
 *    reports bytes per class.
 *
 * ## The honesty contract, restated where it is rendered
 *
 * - A read that FAILED and a population that is genuinely EMPTY never render
 *   the same. Every failure path lands on an explicit "could not read" with
 *   the reason attached.
 * - `census_status: "pending"` (the runner has not finished a census walk
 *   since boot) renders as NOT READY, never as "nothing to clean".
 * - Missing byte counts render "unknown" via `formatBytes`, never `0`, and
 *   `volumeSeverity` returns `null` for a non-finite reading so it is never
 *   banded green.
 * - **Preview is read-only and is gated on nothing.** It is disabled only
 *   while its own request is in flight. There is no delete verb in this phase.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  HardDrive,
  HelpCircle,
  Hourglass,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { httpClient } from "@/services/service-factory";
import { runnerFetch, RunnerApiError, useDeviceInfo } from "@/lib/runner-api";
import {
  deviceVolumesUrl,
  formatBytes,
  percentFree,
  readingAgeMs,
  relativeTime,
  VOLUME_STALE_AFTER_MS,
  volumeSeverity,
} from "@/components/operations/utils";
import {
  DEVICE_VOLUMES_NOT_YET_READ,
  parseDeviceVolumes,
  resolveDeviceVolumes,
  type DeviceVolumesFetch,
} from "@/components/operations/fleetVolumes";
import type {
  MachineVolumes,
  VolumeReading,
} from "@/components/operations/types";
import {
  aggregateByClass,
  bucketTotals,
  canClaimNothingToReclaim,
  DISK_SURVEY_PATH,
  measuredZeroBuckets,
  parseDiskSurvey,
  readErrorsSeen,
  reportOnlyDisagreement,
  rollupDisagreement,
  SURVEY_NOT_YET_READ,
  surveyDisagreement,
  type DiskClassTotals,
  type DiskSurvey,
  type DiskSurveyFetch,
} from "./diskSurvey";

// ---------------------------------------------------------------------------
// Small shared renderers
// ---------------------------------------------------------------------------

/**
 * An in-flight read. Distinct from {@link UnknownPanel} on purpose: a request
 * that has not answered YET is not a request that failed, and rendering the
 * failure copy over a pending fetch is the same determinacy error this feature
 * exists to remove, pointed the other way.
 */
function PendingPanel({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 p-3"
      data-disk-pending
    >
      <Loader2 className="size-4 animate-spin text-muted-foreground shrink-0" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

/** An explicit "we do not know" panel. Never rendered as a zero or a zero-state. */
function UnknownPanel({
  headline,
  detail,
  icon: Icon = HelpCircle,
}: {
  headline: string;
  detail: string;
  icon?: typeof HelpCircle;
}) {
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/30 p-3"
      data-disk-unknown
    >
      <Icon className="size-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">
          Unknown — {headline}
        </p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

/**
 * One volume's free space.
 *
 * A non-finite `free_bytes` has NO severity (`volumeSeverity` returns `null`)
 * and renders muted with "unknown" text rather than a green zero bar.
 */
function VolumeRow({ reading }: { reading: VolumeReading }) {
  const severity = volumeSeverity(reading.free_bytes);
  const pct = percentFree(reading.free_bytes, reading.total_bytes);
  const ageMs = readingAgeMs(reading.observed_at);
  const stale = ageMs === null || ageMs > VOLUME_STALE_AFTER_MS;

  const barColor =
    severity === "critical"
      ? "bg-red-500"
      : severity === "warn"
        ? "bg-amber-500"
        : severity === "ok"
          ? "bg-green-500"
          : "bg-muted-foreground/40";
  const textColor =
    severity === "critical"
      ? "text-red-500"
      : severity === "warn"
        ? "text-amber-600 dark:text-amber-500"
        : severity === "ok"
          ? "text-foreground"
          : "text-muted-foreground";

  return (
    <div className="space-y-1" data-disk-volume={reading.volume}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-mono text-foreground">{reading.volume}</span>
        <span className={textColor}>
          {formatBytes(reading.free_bytes)} free
          <span className="text-muted-foreground">
            {" "}
            of {formatBytes(reading.total_bytes)}
          </span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        {/* A percentage that could not be computed draws NO bar — a
            zero-width bar and a genuinely full disk would look identical. */}
        {pct === null ? null : (
          <div
            className={`h-full rounded-full ${barColor}`}
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {pct === null ? "percentage unknown" : `${pct}% free`}
        {" · "}
        {reading.observed_at === null
          ? "no timestamp — age unknown"
          : `measured ${relativeTime(reading.observed_at)}${
              stale ? " (stale)" : ""
            }`}
      </p>
    </div>
  );
}

/**
 * Bytes plus an explicit lower-bound qualifier.
 *
 * Two independent reasons a total can be a floor rather than a measurement:
 * roots whose size could not be read AT ALL (`unknownItems`, excluded from the
 * sum), and roots the runner sized only partially (`partialItems`, included but
 * itself a floor). Either one makes "at least" the honest prefix.
 */
function ByteTotal({
  bytes,
  unknownItems,
  partialItems = 0,
}: {
  bytes: number;
  unknownItems: number;
  partialItems?: number;
}) {
  const qualifiers: string[] = [];
  if (unknownItems > 0) qualifiers.push(`${unknownItems} of unknown size`);
  if (partialItems > 0) qualifiers.push(`${partialItems} sized only partly`);
  const lowerBound = qualifiers.length > 0;
  return (
    <>
      {lowerBound ? "at least " : ""}
      {formatBytes(bytes)}
      {lowerBound ? (
        <span className="text-xs font-normal text-muted-foreground">
          {" "}
          ({qualifiers.join(", ")})
        </span>
      ) : null}
    </>
  );
}

function BucketTile({
  title,
  bytes,
  unknownItems,
  partialItems = 0,
  itemCount,
  detail,
  tone,
}: {
  title: string;
  bytes: number;
  unknownItems: number;
  partialItems?: number;
  itemCount: number;
  detail: string;
  tone: "actionable" | "report-only" | "unrecognised";
}) {
  const accent =
    tone === "actionable"
      ? "text-foreground"
      : tone === "report-only"
        ? "text-amber-600 dark:text-amber-500"
        : "text-muted-foreground";
  return (
    <div
      className="rounded-md border border-border p-3 space-y-1"
      data-disk-bucket={tone}
    >
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <p className={`text-xl font-semibold ${accent}`}>
        <ByteTotal
          bytes={bytes}
          unknownItems={unknownItems}
          partialItems={partialItems}
        />
      </p>
      <p className="text-xs text-muted-foreground">
        {itemCount} target dir{itemCount === 1 ? "" : "s"} · {detail}
      </p>
    </div>
  );
}

function ClassBadge({ verb }: { verb: DiskClassTotals["verb"] }) {
  if (verb === "v1") return <Badge variant="secondary">cleanup verb</Badge>;
  if (verb === "deferred-v2")
    return <Badge variant="warning">report-only</Badge>;
  return <Badge variant="outline">unrecognised class</Badge>;
}

// ---------------------------------------------------------------------------
// Free space (Phase 1 data path — deviceVolumesUrl's first consumer)
// ---------------------------------------------------------------------------

function FreeSpaceBlock({
  volumes,
  skippedRows,
}: {
  volumes: MachineVolumes;
  /**
   * Rows coord returned for THIS device that could not be read while others
   * could. `resolveDeviceVolumes` reports the count only when NO row survived,
   * so without this the partly-readable case renders as a complete list — and
   * the volume that is actually full can be the one silently dropped.
   */
  skippedRows: number;
}) {
  return (
    <div className="space-y-3" data-disk-free-space={volumes.state}>
      {volumes.state === "reported" && skippedRows > 0 ? (
        <Alert variant="warning" data-disk-volumes-partial>
          <AlertTriangle className="size-4" />
          <AlertTitle>
            {skippedRows} volume row{skippedRows === 1 ? "" : "s"} could not be
            read
          </AlertTitle>
          <AlertDescription>
            Coord returned rows for this device that this page could not parse,
            so the list below is INCOMPLETE. A volume missing from it has not
            been measured — its absence is not evidence that it is healthy.
          </AlertDescription>
        </Alert>
      ) : null}
      {volumes.state === "reported" ? (
        volumes.volumes.map((v, i) => (
          <VolumeRow key={`${i}-${v.volume}`} reading={v} />
        ))
      ) : volumes.state === "never_reported" ? (
        <UnknownPanel
          headline="this device has never reported disk telemetry"
          detail={
            "The read succeeded and returned no volume rows for this device, " +
            "so nothing has been measured yet. That is not zero free space " +
            "and not a healthy disk — it is an absence of measurement. The " +
            "runner publishes free space on a 60s tick once it is running a " +
            "build that carries the volume publisher."
          }
        />
      ) : (
        <UnknownPanel
          headline="disk telemetry could not be read"
          detail={volumes.reason}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reclaim survey
// ---------------------------------------------------------------------------

/** "42s ago" / "7m ago" / "3h ago" / "2d ago". `null` stays unknown. */
function formatAge(secs: number | null): string | null {
  if (secs === null) return null;
  if (secs < 90) return `${Math.round(secs)}s ago`;
  const minutes = secs / 60;
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function CensusFreshness({ survey }: { survey: DiskSurvey }) {
  const age = formatAge(survey.censusAgeSecs);

  if (survey.censusStatus === "unavailable") {
    return (
      <Alert variant="destructive" data-disk-census="unavailable">
        <AlertTriangle className="size-4" />
        <AlertTitle>The survey could not run</AlertTitle>
        <AlertDescription>
          The runner reports that it could not compute this preview at all.
          {survey.censusNote
            ? ` It says: ${survey.censusNote}`
            : " It gave no reason."}{" "}
          Nothing below is a measurement of this disk, and an empty list here is
          not evidence that there is nothing to reclaim.
        </AlertDescription>
      </Alert>
    );
  }
  if (survey.censusStatus === "pending") {
    return (
      <Alert variant="warning" data-disk-census="pending">
        <Hourglass className="size-4" />
        <AlertTitle>Not ready — no census has completed yet</AlertTitle>
        <AlertDescription>
          The runner has not finished a disk census since it started, so it does
          not yet KNOW what can be reclaimed. This is not &quot;nothing to
          clean&quot;: the list below is empty because the measurement has not
          run, not because there is nothing there. Press Preview to start a
          walk; it takes minutes on a large tree.
          {survey.censusRefreshing
            ? " A walk IS running right now — this panel will keep saying" +
              " 'not ready' until it finishes."
            : ""}
          {survey.censusNote ? ` ${survey.censusNote}` : ""}
        </AlertDescription>
      </Alert>
    );
  }
  if (survey.censusStatus === "unknown") {
    return (
      <Alert variant="warning" data-disk-census="unknown">
        <HelpCircle className="size-4" />
        <AlertTitle>Freshness unknown</AlertTitle>
        <AlertDescription>
          The runner did not report a census status this build recognises
          {survey.censusStatusRaw
            ? ` (it sent "${survey.censusStatusRaw}")`
            : ""}
          , so the age of these figures is unknown. They must not be read as
          current.
          {survey.censusNote ? ` ${survey.censusNote}` : ""}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <p
      className="text-xs text-muted-foreground"
      data-disk-census={survey.censusStatus}
    >
      {survey.censusStatus === "stale"
        ? `Snapshot is STALE — measured ${age ?? "at an unknown time"}. Shown with its age rather than hidden.`
        : `Measured ${age ?? "at an unknown time"}.`}
      {survey.censusRefreshing ? " A refresh walk is running now." : ""}
      {survey.censusNote ? ` ${survey.censusNote}` : ""}
    </p>
  );
}

function ClassTable({ totals }: { totals: DiskClassTotals[] }) {
  return (
    <Table data-disk-class-table>
      <TableHeader>
        <TableRow>
          <TableHead>Class</TableHead>
          <TableHead className="text-right">Reclaimable</TableHead>
          <TableHead className="text-right">Blocked</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {totals.map((t) => (
          <TableRow key={t.classId ?? "__unclassified__"}>
            <TableCell className="align-top">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t.label}</span>
                <ClassBadge verb={t.verb} />
              </div>
              <p className="text-xs text-muted-foreground mt-1 max-w-prose">
                {t.note}
              </p>
            </TableCell>
            <TableCell className="text-right align-top whitespace-nowrap">
              <ByteTotal
                bytes={t.reclaimableBytes}
                unknownItems={t.reclaimableUnknownByteItems}
                partialItems={t.reclaimablePartialByteItems}
              />
              <div className="text-xs text-muted-foreground">
                {t.reclaimableCount} dir{t.reclaimableCount === 1 ? "" : "s"}
              </div>
            </TableCell>
            <TableCell className="text-right align-top whitespace-nowrap">
              {t.blockedCount === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <>
                  {/* Its OWN unknown/partial counts — the blocked total is the
                      one missing bytes when a blocked root could not be
                      sized, and the reclaimable column's qualifier says
                      nothing about it. */}
                  <ByteTotal
                    bytes={t.blockedBytes}
                    unknownItems={t.blockedUnknownByteItems}
                    partialItems={t.blockedPartialByteItems}
                  />
                  <div className="text-xs text-muted-foreground">
                    {t.blockedCount} dir{t.blockedCount === 1 ? "" : "s"}
                  </div>
                </>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Up to 8 candidates the runner refused, with the reason it gave for each.
 *
 * The heading says "not removable", not "blocked by a guard": every
 * report-only root arrives with `status: "blocked"` too, and for those nothing
 * is holding anything — there is simply no verb. Each row carries the runner's
 * own `reason_detail`, so the distinction is legible per item as well.
 */
function BlockedList({ survey }: { survey: DiskSurvey }) {
  const blocked = survey.items.filter((i) => i.status === "blocked");
  if (blocked.length === 0) return null;
  const shown = blocked.slice(0, 8);
  return (
    <div className="space-y-2" data-disk-blocked-list>
      <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Not removable right now ({blocked.length})
      </h4>
      <ul className="space-y-1">
        {shown.map((item, i) => (
          // `id` falls back to `path` and is not guaranteed unique, so the
          // index disambiguates rather than risking a React key collision.
          <li key={`${i}-${item.id}`} className="text-xs">
            <span className="font-mono break-all text-foreground">
              {item.path ?? item.id}
            </span>
            <span className="text-muted-foreground">
              {" — "}
              {item.reasonDetail ??
                item.reason ??
                "the runner gave no reason for the block"}
              {" · "}
              {/* A partially-sized root is a FLOOR. Printing it bare would
                  present a lower bound as a measurement -- the same class of
                  lie as a fabricated zero, one item at a time. (`bytes` that
                  never arrived is already handled: `formatBytes` says
                  "unknown".) */}
              {item.bytesPartial && Number.isFinite(item.bytes)
                ? `at least ${formatBytes(item.bytes)} (sized only partly)`
                : formatBytes(item.bytes)}
            </span>
          </li>
        ))}
      </ul>
      {blocked.length > shown.length ? (
        <p className="text-xs text-muted-foreground">
          {blocked.length - shown.length} more not listed; their bytes are
          included in the totals above.
        </p>
      ) : null}
    </div>
  );
}

function SurveyBody({ survey }: { survey: DiskSurvey }) {
  const totals = aggregateByClass(survey);
  const buckets = bucketTotals(totals);
  const disagreement = surveyDisagreement(survey);

  // A bucket with no items is a MEASURED zero only on positive evidence:
  // `measuredZeroBuckets` takes the runner's own headline total when it is an
  // explicit `0`, and otherwise a rollup that is FULLY readable and reports
  // `roots: 0` for every class in the bucket. Trusting the rollup's mere
  // presence would let one saying "40 roots, 1.1 TB" authorise a `0 B` tile
  // computed from a short item list -- a fabricated zero produced by the
  // anti-fabrication check. That function is the ONLY implementation of this
  // rule; a second copy of a safety check is how the two drift apart.
  const measuredZero = measuredZeroBuckets(survey);
  // Two independent reasons to show a tile, because either one alone is a way
  // to hide real bytes:
  //
  // - the bucket HAS roots. This is the per-item fact, and it is what the
  //   class-level test missed: a root the runner marked reclaimable WITH a
  //   verb is actionable even if its class is one this build cannot place, and
  //   hiding its tile printed "no candidates" over the exact population this
  //   feature exists to surface.
  // - the class exists but every one of its roots is held. Gating on the
  //   bucket alone would then report "no candidates" for a class whose bytes
  //   are visible in the table two elements below.
  const hasV1Class = totals.some((t) => t.verb === "v1");
  const hasReportOnlyClass = totals.some((t) => t.verb === "deferred-v2");
  const showActionable =
    buckets.actionableItems > 0 || hasV1Class || measuredZero.actionable;
  const showReportOnly =
    buckets.reportOnlyItems > 0 ||
    hasReportOnlyClass ||
    measuredZero.reportOnly;

  const absentBuckets: string[] = [];
  if (!showActionable) {
    absentBuckets.push(
      "the classes the cleanup verb covers (worktree, container and non-git target roots)"
    );
  }
  if (!showReportOnly) {
    absentBuckets.push("in-repo target dirs (the report-only class)");
  }

  const rollupMismatch = rollupDisagreement(survey);
  const reportOnlyMismatch = reportOnlyDisagreement(
    survey,
    buckets.reportOnlyBytes
  );

  // Two DIFFERENT shortfalls, rendered as two different sentences:
  // `scan.truncated` means the LIST is a prefix; `bytes_incomplete` means the
  // listed rows are under-sized. Collapsing them tells an operator "these
  // numbers are a bit low" when the truth is "you are not seeing the list".
  const truncatedWalk = survey.scan?.truncated === true;
  // NEVER `readErrors.length`: the runner caps that array at 100 entries and
  // sends the real figure in `read_errors_total`, so counting the list turned a
  // locked subtree's thousands of failures into a flat "100 directories" — a
  // silent under-report on the one panel built to make under-reports visible.
  const readErrorCount = readErrorsSeen(survey.scan);
  const incompleteWalk = truncatedWalk || survey.bytesIncomplete;
  const dirsVisited = survey.scan?.dirsVisited ?? null;
  const afterNDirs =
    dirsVisited === null
      ? ""
      : ` after ${dirsVisited.toLocaleString()} directories`;

  return (
    <div className="space-y-4">
      <CensusFreshness survey={survey} />

      {disagreement ? (
        <Alert variant="warning" data-disk-disagreement>
          <AlertTriangle className="size-4" />
          <AlertTitle>The survey disagrees with itself</AlertTitle>
          <AlertDescription>{disagreement}</AlertDescription>
        </Alert>
      ) : null}

      {reportOnlyMismatch ? (
        <Alert variant="warning" data-disk-report-only-mismatch>
          <AlertTriangle className="size-4" />
          <AlertTitle>
            The runner&apos;s report-only headline differs from its item list
          </AlertTitle>
          <AlertDescription>{reportOnlyMismatch}</AlertDescription>
        </Alert>
      ) : null}

      {rollupMismatch ? (
        <Alert variant="warning" data-disk-rollup-mismatch>
          <AlertTriangle className="size-4" />
          <AlertTitle>The item list is shorter than the rollup</AlertTitle>
          <AlertDescription>{rollupMismatch}</AlertDescription>
        </Alert>
      ) : null}

      {survey.skippedItems > 0 ? (
        <Alert variant="warning" data-disk-skipped-items>
          <AlertTriangle className="size-4" />
          <AlertTitle>
            {survey.skippedItems} candidate
            {survey.skippedItems === 1 ? "" : "s"} could not be read
          </AlertTitle>
          <AlertDescription>
            The runner returned entries this page could not parse, so the totals
            below are INCOMPLETE by an unknown amount. They are a lower bound,
            not a measurement.
          </AlertDescription>
        </Alert>
      ) : null}

      {survey.items.length === 0 ? (
        canClaimNothingToReclaim(survey) ? (
          <p
            className="text-sm text-muted-foreground"
            data-disk-empty="measured"
          >
            Nothing to reclaim. The census completed and found no cargo target
            roots that qualify — this is a measured answer, not a missing one.
          </p>
        ) : incompleteWalk ? (
          // An empty list from a walk the RUNNER says was short is the one
          // shape that most looks like a clean disk and is not one. It gets
          // its own panel because the generic "not a measurement" copy below
          // does not say the thing an operator needs to hear: the walk stopped
          // early, so it may never have reached the roots that are there.
          <div
            className="flex items-start gap-2 rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 p-3"
            data-disk-empty="incomplete"
          >
            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-500">
                Unknown — the walk stopped short and found nothing on the way
              </p>
              <p className="text-xs text-muted-foreground">
                The census returned no candidates, but the runner also reports
                that this walk was INCOMPLETE
                {truncatedWalk
                  ? ` — it hit its visit ceiling${afterNDirs}, so the list is a` +
                    " prefix of a population it never finished enumerating"
                  : readErrorCount > 0
                    ? ` — ${readErrorCount} director${
                        readErrorCount === 1 ? "y" : "ies"
                      } could not be read`
                    : " (a truncated walk, or a subtree it could not read)"}
                . An empty list from a walk that stopped early says nothing
                about what is on this disk: the roots may simply be somewhere
                the walk never reached. Press Preview to run a fresh census.
              </p>
            </div>
          </div>
        ) : (
          <UnknownPanel
            headline="the candidate list is empty, but that is not a measurement"
            detail={
              "The runner answered without any readable candidates while its " +
              "census was not in a completed state (or every row it sent was " +
              "unreadable). Nothing here says the disk is clean."
            }
          />
        )
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* A bucket with no items gets NO tile. Rendering "0 B" there
                would claim the runner scanned that class and found nothing —
                and this page cannot tell that apart from a runner that does
                not survey the class at all. The absent buckets are named
                below instead. */}
            {showActionable ? (
              <BucketTile
                tone="actionable"
                title="Covered by the cleanup verb"
                bytes={buckets.actionableBytes}
                unknownItems={buckets.actionableUnknownByteItems}
                partialItems={buckets.actionablePartialByteItems}
                itemCount={buckets.actionableItems}
                detail="worktree, container and non-git target roots"
              />
            ) : null}
            {showReportOnly ? (
              <BucketTile
                tone="report-only"
                title="Report-only — no cleanup verb"
                bytes={buckets.reportOnlyBytes}
                unknownItems={buckets.reportOnlyUnknownByteItems}
                partialItems={buckets.reportOnlyPartialByteItems}
                itemCount={buckets.reportOnlyItems}
                detail="in-repo target dirs; deferred to a later phase"
              />
            ) : null}
            {buckets.unrecognisedItems > 0 ? (
              <BucketTile
                tone="unrecognised"
                title="Class not recognised here"
                bytes={buckets.unrecognisedBytes}
                unknownItems={buckets.unrecognisedUnknownByteItems}
                partialItems={buckets.unrecognisedPartialByteItems}
                itemCount={buckets.unrecognisedItems}
                detail="this page cannot say whether a verb covers them"
              />
            ) : null}
            {/* Report-only roots are NOT counted here. They arrive `blocked`
                only because no verb exists for their class, so calling them
                guard-held would attribute ~47 % of the bytes on this box to a
                live build that does not exist -- and would count them twice,
                since the report-only tile carries the whole class. */}
            {buckets.blockedItems > 0 ? (
              <BucketTile
                tone="unrecognised"
                title="Blocked by a guard"
                bytes={buckets.blockedBytes}
                unknownItems={buckets.blockedUnknownByteItems}
                partialItems={buckets.blockedPartialByteItems}
                itemCount={buckets.blockedItems}
                detail="the runner refused these: a live build, a pin, a dirty tree, another engine that owns the path, or a check that could not confirm nothing does"
              />
            ) : null}
          </div>

          {absentBuckets.length > 0 ? (
            <p
              className="text-xs text-muted-foreground"
              data-disk-absent-buckets
            >
              The survey reported no candidates for {absentBuckets.join(" or ")}
              . That is shown as ABSENT rather than as 0 B: this page cannot
              tell a runner that scanned those classes and found nothing apart
              from a runner that does not survey them at all.
            </p>
          ) : null}

          {showReportOnly ? (
            <Alert variant="warning" data-disk-report-only-explainer>
              <ShieldAlert className="size-4" />
              <AlertTitle>Why the report-only bytes have no button</AlertTitle>
              <AlertDescription>
                In-repo <code className="font-mono">target/</code> dirs are the
                largest class by bytes on this kind of machine, but cleaning
                them means pruning INSIDE a directory a running build may be
                using — a different and stricter guard than removing a whole
                orphaned root. That guard is deliberately not shipped yet, so
                these bytes are REPORTED and not offered for deletion. Showing
                them without a button is the honest option; hiding them would
                understate the disk by the single biggest number on the page.
              </AlertDescription>
            </Alert>
          ) : null}

          {truncatedWalk ? (
            <p
              className="text-xs text-amber-600 dark:text-amber-500"
              data-disk-scan-truncated
            >
              The walk hit its visit ceiling{afterNDirs}, so the list below is a
              PREFIX of the population, not all of it. Roots the walk never
              reached are missing entirely — they are unvisited, not absent, and
              no total here is a measurement of this machine.
            </p>
          ) : null}

          {survey.bytesIncomplete ? (
            <p
              className="text-xs text-muted-foreground"
              data-disk-bytes-incomplete
            >
              {`${
                truncatedWalk ? "Separately: at least" : "At least"
              } one byte total above is a LOWER BOUND — a subtree could not be read, or a root could not be sized${
                readErrorCount > 0
                  ? ` (${readErrorCount} director${
                      readErrorCount === 1 ? "y" : "ies"
                    } failed to read)`
                  : ""
              }. The real figure is larger by an unknown amount. This is about the roots that ARE listed; whether the LIST is complete is a separate question.`}
            </p>
          ) : null}

          <ClassTable totals={totals} />
          <BlockedList survey={survey} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function DiskSection() {
  const {
    data: deviceInfo,
    isLoading: deviceLoading,
    error: deviceError,
    isOffline: deviceOffline,
  } = useDeviceInfo();
  const deviceId = deviceInfo?.device_id ?? null;

  const [volumes, setVolumes] = useState<DeviceVolumesFetch>(
    DEVICE_VOLUMES_NOT_YET_READ
  );
  const [survey, setSurvey] = useState<DiskSurveyFetch>(SURVEY_NOT_YET_READ);
  const [busy, setBusy] = useState(false);
  const [volumesInFlight, setVolumesInFlight] = useState(false);
  const [surveyInFlight, setSurveyInFlight] = useState(false);

  // Request-generation guards. Two reads can be in flight at once (the mount
  // fetch and a Preview click, or a `deviceId` that changed), and without a
  // generation check the SLOWER one wins by resolving last — silently
  // replacing a refreshed answer with a stale snapshot. They also stop a
  // late response calling setState after unmount.
  const volumesSeq = useRef(0);
  const surveySeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadVolumes = useCallback(async (id: string) => {
    const seq = ++volumesSeq.current;
    const current = () => mounted.current && seq === volumesSeq.current;
    setVolumesInFlight(true);
    const settle = (next: DeviceVolumesFetch) => {
      if (!current()) return;
      setVolumes(next);
      setVolumesInFlight(false);
    };
    const url = deviceVolumesUrl(id);
    let response: Response;
    try {
      response = await httpClient.fetch(url);
    } catch (err) {
      settle({
        state: "unavailable",
        reason:
          `The request to ${url} failed: ` +
          `${err instanceof Error ? err.message : "unknown error"}. Nothing ` +
          `here describes this disk.`,
      });
      return;
    }
    if (!response.ok) {
      // The status is named rather than guessed at: 401/403 is an expired
      // session, 422 is a device id the backend would not accept as a UUID,
      // 502/504 is coord. Attributing all of them to "coord may be down"
      // would send the reader after the wrong thing.
      const hint =
        response.status === 401 || response.status === 403
          ? "This session is not authorised for the operations API -- signing in again is the likely fix."
          : response.status === 404 || response.status === 422
            ? "The backend did not accept this device id, or does not serve the per-device volumes route."
            : "Coord may be unreachable (502/504), or the volumes route may not be deployed yet.";
      settle({
        state: "unavailable",
        reason:
          `The per-device volumes read returned HTTP ${response.status}. ` +
          `${hint} This is a failed read, not an empty disk.`,
      });
      return;
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      settle({
        state: "unavailable",
        reason: `The per-device volumes response was not valid JSON: ${
          err instanceof Error ? err.message : "parse error"
        }`,
      });
      return;
    }
    const parsed = parseDeviceVolumes(payload);
    if (parsed.state === "unparseable") {
      settle({ state: "unavailable", reason: parsed.reason });
      return;
    }
    settle({
      state: "ok",
      deviceId: parsed.deviceId,
      volumes: parsed.volumes,
      skippedRows: parsed.skippedRows,
    });
  }, []);

  const loadSurvey = useCallback(async (refresh: boolean) => {
    const seq = ++surveySeq.current;
    setSurveyInFlight(true);
    const settle = (next: DiskSurveyFetch) => {
      if (!mounted.current || seq !== surveySeq.current) return;
      setSurvey(next);
      setSurveyInFlight(false);
    };
    const path = refresh ? `${DISK_SURVEY_PATH}?refresh=1` : DISK_SURVEY_PATH;
    let raw: unknown;
    try {
      // The survey answers from a cached census snapshot, but a cold runner
      // may block briefly waiting for one — a longer budget than the 5s
      // default, still bounded.
      raw = await runnerFetch<unknown>(path, { timeoutMs: 20_000 });
    } catch (err) {
      if (err instanceof RunnerApiError && err.status === 404) {
        settle({
          state: "unavailable",
          reason:
            `The runner does not serve ${DISK_SURVEY_PATH} (HTTP 404). This ` +
            `build predates the disk-reclaim survey, so it cannot answer the ` +
            `question — which is NOT the same as answering "nothing to ` +
            `reclaim". Nothing here describes what is on this disk.`,
        });
        return;
      }
      settle({
        state: "unavailable",
        reason:
          `The disk survey request failed: ` +
          `${err instanceof Error ? err.message : "unknown error"}. This is a ` +
          `failed read, not an empty result.`,
      });
      return;
    }
    const parsed = parseDiskSurvey(raw);
    if (parsed.state === "unparseable") {
      settle({ state: "unavailable", reason: parsed.reason });
      return;
    }
    settle({ state: "ok", survey: parsed.survey });
  }, []);

  // First read on mount, without asking for a refresh walk: a page visit must
  // not kick a minutes-long filesystem census. The button does that.
  useEffect(() => {
    if (!deviceId) return;
    void loadVolumes(deviceId);
  }, [deviceId, loadVolumes]);

  useEffect(() => {
    void loadSurvey(false);
  }, [loadSurvey]);

  // Preview is READ-ONLY and gated on nothing — no arming flag, no config, no
  // threshold. The only reason it is ever disabled is that its own request is
  // already in flight.
  const handlePreview = useCallback(async () => {
    setBusy(true);
    try {
      await Promise.all([
        loadSurvey(true),
        deviceId ? loadVolumes(deviceId) : Promise.resolve(),
      ]);
    } finally {
      setBusy(false);
    }
  }, [deviceId, loadSurvey, loadVolumes]);

  // Three different reasons there is no device id, and only ONE of them is a
  // fact about the machine. A read that failed or never answered cannot
  // support "the runner did not report a device id" — that is a determinate
  // negative drawn from a non-answer.
  const deviceUnresolved: string | null = deviceId
    ? null
    : deviceLoading
      ? "loading"
      : deviceError || deviceOffline
        ? "The runner could not be asked which coord device this machine is" +
          `${deviceError ? ` (${deviceError})` : " -- it is not reachable"}. ` +
          "That is a failed read, not a machine without a device id."
        : "The runner answered without a coord device id for this machine, " +
          "so its free-space telemetry could not be looked up. Nothing here " +
          "says the disk is fine or full — only that the machine could not " +
          "be identified.";

  const resolvedVolumes: MachineVolumes = deviceId
    ? resolveDeviceVolumes(volumes, deviceId)
    : {
        state: "unknown",
        reason: deviceUnresolved ?? "",
      };
  const volumesSkipped = volumes.state === "ok" ? volumes.skippedRows : 0;
  // Nothing has answered yet — neither a result nor a failure.
  const volumesPending =
    deviceUnresolved === "loading" ||
    (volumesInFlight && volumes === DEVICE_VOLUMES_NOT_YET_READ);
  const surveyPending = surveyInFlight && survey === SURVEY_NOT_YET_READ;

  return (
    <div className="rounded-lg border border-border" data-disk-section>
      <div className="px-4 py-3 border-b border-border bg-muted/50 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium flex items-center gap-2">
            <HardDrive className="size-4" />
            Disk
          </h3>
          <p className="text-xs text-muted-foreground">
            Free space on this machine, and what its build caches are holding
          </p>
        </div>
        <Button
          onClick={handlePreview}
          disabled={busy}
          variant="outline"
          size="sm"
          data-disk-preview-button
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Preview
        </Button>
      </div>

      <div className="p-4 space-y-6">
        <div className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Free space
          </h4>
          {volumesPending ? (
            <PendingPanel label="Reading this machine's free space..." />
          ) : (
            <FreeSpaceBlock
              volumes={resolvedVolumes}
              skippedRows={volumesSkipped}
            />
          )}
        </div>

        <div className="space-y-3">
          <div>
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Reclaimable build caches
            </h4>
            <p className="text-xs text-muted-foreground mt-1">
              Cargo target directories, surveyed by the runner on this machine.
              Preview is read-only: this phase ships no delete button, and
              nothing on this page removes a build cache.
            </p>
          </div>
          {surveyPending ? (
            <PendingPanel label="Asking the runner what it can reclaim..." />
          ) : survey.state === "ok" ? (
            <SurveyBody survey={survey.survey} />
          ) : (
            <UnknownPanel
              headline="the reclaim survey could not be read"
              detail={survey.reason}
              icon={AlertTriangle}
            />
          )}
        </div>
      </div>
    </div>
  );
}
