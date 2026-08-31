/**
 * Coord's mirror of the self-hosted CI runners — plan
 * `2026-08-20-fleet-page-runner-enable-disable-switch` Phase 2.
 *
 * ## This is a data-path module, not a second renderer
 *
 * `CiRunnerBadge` has rendered label chips since the self-hosted CI runners
 * plan; what was missing is the labels reaching it. Everything here exists to
 * get coord's mirrored `ci_runner_labels` as far as that component and to say
 * honestly how old they are. Writing a second label renderer would be the
 * duplicate-abstraction defect the owning plan's §0 was written to prevent.
 *
 * ## Why the labels come from a coord route rather than the device read
 *
 * The GitHub-side runners are in `coord.devices` — coord's
 * `ci_runner_registrar` writes them through the same `register_device` a Tauri
 * runner uses, labels included. But it registers with `user_id = None` and
 * never sets `capability_user_paired`, while this service's own device read
 * requires `user_id == current_user.id AND capability_user_paired IS TRUE`. So
 * those rows are structurally invisible to `GET /operations/fleet`, and its
 * `ci_runners` map is dead surface for the GitHub fleet. Loosening that filter
 * would break the thing it is actually for (keeping one tenant's workstations
 * out of another's list), so the labels come from a route on coord instead.
 *
 * ## A mirror is not GitHub
 *
 * Nothing on this page reads GitHub. Coord's registrar polls
 * `GET /repos/{repo}/actions/runners` roughly every 60 s and this shows what
 * that poll last wrote. The UI labels that — a page that implies live routing
 * truth is a page that will one day tell an operator a host is routable while
 * GitHub disagrees.
 *
 * ### `freshness_secs` is a WINDOW, not an age. Read coord before believing it.
 *
 * `fleet_ci_runners.rs` calls it "the freshness window the query was executed
 * under, in seconds", and it comes from
 * `merge_scheduler::ci_runner_freshness_secs()` —
 * `COORD_CI_RUNNER_FRESHNESS_SECS`, **a configured constant, default 180**. The
 * response means: these are the runners coord heard from in
 * `(as_of - freshness_secs, as_of]`.
 *
 * Rendering it as "180s old" would print a fixed number as if it were a
 * measurement, for a mirror that might be two seconds old — the exact defect
 * this module claims to exist to prevent. It is therefore modelled as
 * `windowSecs`, named for what it is, and the real per-row age is computed from
 * `as_of - last_seen_at`, which coord does send.
 *
 * Every failure lands on `unavailable` WITH the reason. A read that did not
 * answer is never rendered as "this host has no labels", which would be a claim
 * about the host rather than about the request
 * (`[policy: silent-empty-is-unknown]`).
 */

import type { CiRunnersByHost, CiRunnerStatus } from "./types";

/**
 * The labels a job's `runs-on: [self-hosted, qontinui]` matches against.
 *
 * GitHub treats `runs-on` as an AND over labels, so a host draws fleet CI only
 * while it carries BOTH. `qontinui` is the custom one and the only removable
 * one — deleting it is the lever the owning plan's Phase 4 is about.
 *
 * Deliberately NOT a host list. Every written description of the pool in the
 * tree has been stale at some point (the plan's §2 measured three hosts against
 * documents naming two), so this names the ROUTING CONTRACT, which lives in
 * `qontinui-coord/.github/workflows/ci.yml`, and the host set is always read
 * live from the mirror.
 */
export const CI_ROUTING_LABELS: readonly string[] = ["self-hosted", "qontinui"];

/** One row of coord's `GET /coord/fleet/ci-runners`. */
export interface CoordCiRunnerRow {
  device_id: string;
  hostname: string;
  /** `idle` / `busy` / `offline` as coord last mirrored it; `null` if unset. */
  ci_runner_status: string | null;
  ci_runner_labels: string[];
  last_seen_at: string | null;
}

/** The response body. Every field optional — a coord that omits one must
 * degrade to "unknown", not to a wrong number. */
export interface CoordCiRunnersPayload {
  runners?: CoordCiRunnerRow[];
  as_of?: string | null;
  freshness_secs?: number | null;
}

/**
 * The mirror, as far as this page got.
 *
 * `loading` and `unavailable` are separate from an empty `ok` on purpose: a
 * read that has not answered says nothing about how many runners are
 * registered, and an `ok` with zero rows is a real measurement.
 */
export type CiRunnerMirrorRead =
  | { state: "loading" }
  | {
      state: "ok";
      byHostname: Map<string, CoordCiRunnerRow>;
      /** When coord ran the read — the anchor the window is measured back
       * from. `null` when it did not say. */
      asOf: string | null;
      /**
       * Coord's SELECTION WINDOW in seconds, not an age: every row here was
       * seen within `windowSecs` of `asOf`. A configured constant
       * (`COORD_CI_RUNNER_FRESHNESS_SECS`, default 180), so it says nothing
       * about how old any particular row is — use `mirrorRowAgeSecs` for that.
       */
      windowSecs: number | null;
      /**
       * Rows coord sent that could not be indexed, because they named no
       * hostname or collided with one already claimed. Surfaced rather than
       * swallowed: the page shows a roster and must be able to say the roster
       * is partial.
       */
      skippedRows: number;
    }
  | { state: "unavailable"; reason: string };

/**
 * Coord's `ci_runner_status` string, narrowed — with an explicit `unknown`.
 *
 * A status coord did not report, or reported as a value this build does not
 * know, must NOT collapse into `offline`: "coord says this runner is offline"
 * and "nobody told us" are different facts and the second one is the one that
 * gets acted on wrongly. `unknown` exists so the badge can say which it is.
 */
export function normalizeCiRunnerStatus(
  raw: string | null | undefined
): CiRunnerStatus {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "idle":
      return "idle";
    case "busy":
      return "busy";
    case "offline":
      return "offline";
    default:
      return "unknown";
  }
}

/**
 * Case-insensitive membership — GitHub matches runner labels that way.
 *
 * Exported because the badge needs the same comparison to decide which chips to
 * emphasise, and two case-folding rules for one question is how a chip ends up
 * highlighted on one row and not the next.
 */
export function hasLabel(labels: readonly string[], want: string): boolean {
  const target = want.toLowerCase();
  return labels.some((l) => l.trim().toLowerCase() === target);
}

/** True when `label` is one of the two GitHub matches `runs-on` against. */
export function isRoutingLabel(label: string): boolean {
  return hasLabel(CI_ROUTING_LABELS, label);
}

/**
 * The routing labels this host is MISSING, in `CI_ROUTING_LABELS` order.
 *
 * Empty means GitHub will match `[self-hosted, qontinui]` here. Non-empty is
 * the state the owning plan's incident was about, and the page has to render it
 * visibly differently from a host that has them.
 */
export function missingRoutingLabels(labels: readonly string[]): string[] {
  return CI_ROUTING_LABELS.filter((want) => !hasLabel(labels, want));
}

/** True when GitHub will route fleet CI jobs to this host. */
export function matchesFleetRouting(labels: readonly string[]): boolean {
  return missingRoutingLabels(labels).length === 0;
}

/**
 * Index a mirror payload by hostname, rejecting anything unindexable.
 *
 * A row with no hostname cannot be attached to a machine card, so it is
 * DROPPED and counted rather than guessed at; the count rides in
 * `skippedRows` so the page can say the list it is showing is partial instead
 * of quietly under-reporting.
 */
export function indexCiRunners(payload: CoordCiRunnersPayload): {
  byHostname: Map<string, CoordCiRunnerRow>;
  skippedRows: number;
} {
  const byHostname = new Map<string, CoordCiRunnerRow>();
  let skippedRows = 0;
  for (const row of payload.runners ?? []) {
    const hostname = typeof row?.hostname === "string" ? row.hostname : "";
    if (!hostname) {
      skippedRows += 1;
      continue;
    }
    // A COLLISION is counted too, and the first row wins. One host can hold a
    // separate GitHub registration per repo, so two rows sharing a hostname is
    // a real shape — and silently overwriting would show one registration's
    // labels while the operator believes they are looking at the host.
    if (byHostname.has(hostname)) {
      skippedRows += 1;
      continue;
    }
    byHostname.set(hostname, {
      device_id: row.device_id,
      hostname,
      ci_runner_status: row.ci_runner_status ?? null,
      ci_runner_labels: Array.isArray(row.ci_runner_labels)
        ? row.ci_runner_labels
        : [],
      last_seen_at: row.last_seen_at ?? null,
    });
  }
  return { byHostname, skippedRows };
}

/**
 * Parse a response body into the read union.
 *
 * A body that is not an object, or whose `runners` is not an array, is
 * `unavailable` — not an empty fleet. The two look identical on screen unless
 * something says so here.
 */
export function parseCiRunnersPayload(payload: unknown): CiRunnerMirrorRead {
  if (typeof payload !== "object" || payload === null) {
    return {
      state: "unavailable",
      reason:
        "The CI-runner mirror did not come back as an object, so no host " +
        "could be matched to a label set.",
    };
  }
  const body = payload as CoordCiRunnersPayload;
  // An ABSENT `runners` key is unavailable, not an empty fleet. A response that
  // never mentioned the roster has told us nothing about it, and "ok with zero
  // rows" would put that on screen as a successful measurement — the same
  // unknown-as-empty conflation this module refuses everywhere else.
  if (!Array.isArray(body.runners)) {
    return {
      state: "unavailable",
      reason:
        body.runners === undefined
          ? "The CI-runner mirror's response carried no `runners` field, so it " +
            "stated nothing about the roster."
          : "The CI-runner mirror's `runners` field was not a list, so no host " +
            "could be matched to a label set.",
    };
  }
  const { byHostname, skippedRows } = indexCiRunners(body);
  return {
    state: "ok",
    byHostname,
    skippedRows,
    asOf: typeof body.as_of === "string" ? body.as_of : null,
    windowSecs:
      typeof body.freshness_secs === "number" &&
      Number.isFinite(body.freshness_secs)
        ? body.freshness_secs
        : null,
  };
}

/**
 * How long ago coord last heard from this host, in seconds — the number
 * `freshness_secs` is NOT.
 *
 * `null` when either end is missing or unparseable, which is UNKNOWN and must
 * render as such. A negative result (a `last_seen_at` after `as_of`, i.e. clock
 * skew) clamps to 0 rather than rendering a host as seen in the future.
 */
export function mirrorRowAgeSecs(
  asOf: string | null,
  lastSeenAt: string | null | undefined
): number | null {
  if (!asOf || !lastSeenAt) return null;
  const a = Date.parse(asOf);
  const b = Date.parse(lastSeenAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((a - b) / 1000));
}

/**
 * The one sentence the page must show beside the labels.
 *
 * It never claims the labels are current, and it never dresses coord's
 * SELECTION WINDOW up as an age (see the module doc — `freshness_secs` is a
 * configured constant). What it states is exactly what coord answered: the
 * window the rows were selected under, and when the read ran.
 */
export function describeMirrorFreshness(read: CiRunnerMirrorRead): string {
  if (read.state === "loading") {
    return "Reading coord's CI-runner mirror…";
  }
  if (read.state === "unavailable") {
    return `Label state unknown — ${read.reason}`;
  }
  const window =
    read.windowSecs != null
      ? `coord heard from within the last ${Math.max(
          0,
          Math.round(read.windowSecs)
        )}s`
      : "coord heard from inside an unreported freshness window";
  const stamp = read.asOf ? `, read at ${read.asOf}` : "";
  const partial =
    read.skippedRows > 0
      ? ` ${read.skippedRows} row(s) coord sent could not be placed on a host ` +
        `and are NOT shown, so this roster is partial.`
      : "";
  return (
    `Rows are the CI runners ${window}${stamp}. Their labels are what ` +
    `coord's ~60s registrar poll last mirrored from GitHub — not a live read ` +
    `of GitHub.${partial}`
  );
}

/**
 * Merge the two sources of per-host CI-runner facts into one map.
 *
 * The device-registry map (`GET /operations/fleet`'s `ci_runners`) covers this
 * caller's own paired devices; the coord mirror covers the GitHub fleet, whose
 * rows that read cannot see at all. They are not competing views of one
 * population — for the fleet's actual CI hosts, only the mirror has anything.
 *
 * Where both do carry a host, **the mirror wins for status and labels**: it is
 * the copy derived from GitHub's own listing, which is what the routing verdict
 * has to be computed from. `lastJobAt` is kept from the device-registry entry,
 * because coord's route does not carry it and dropping it would lose a fact for
 * no gain.
 *
 * A read that has not answered (or failed) contributes nothing and removes
 * nothing — the device-registry entries stand on their own, unlabelled as
 * mirrored, so no routing verdict is rendered for them.
 */
export function mergeCiRunners(
  fromDeviceRegistry: CiRunnersByHost,
  mirror: CiRunnerMirrorRead
): CiRunnersByHost {
  const merged: CiRunnersByHost = {};
  for (const [hostname, info] of Object.entries(fromDeviceRegistry)) {
    merged[hostname] = {
      ...info,
      status: normalizeCiRunnerStatus(info.status),
      labels: info.labels ?? [],
      source: "device-registry",
    };
  }
  if (mirror.state !== "ok") return merged;
  for (const [hostname, row] of mirror.byHostname) {
    merged[hostname] = {
      status: normalizeCiRunnerStatus(row.ci_runner_status),
      labels: row.ci_runner_labels,
      lastJobAt: merged[hostname]?.lastJobAt ?? null,
      // Carried, not dropped. Without it every mirror-sourced host renders the
      // badge's `lastJobAt`-derived tooltip — "No jobs run yet" — which is a
      // positive claim about a host made from a field the mirror does not
      // carry at all. `last_seen_at` is what the mirror DOES carry, and it is
      // the only honest recency this row has.
      lastSeenAt: row.last_seen_at,
      mirrorAsOf: mirror.asOf,
      source: "coord-mirror",
    };
  }
  return merged;
}
