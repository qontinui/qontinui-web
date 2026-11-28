/**
 * runnerReports — what only the RUNNER can see about its own machine, as
 * machine-row statuses.
 *
 * Plan `2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first`
 * Phase 8 (the operator readout), over coord's Phase 5 wire: each
 * `/fleet/health` device row now carries the runner's
 *
 * * `wedge_incidents` — its in-process wedge detector's incidents (G2: a
 *   runner that is wedged but still listening, which coord's liveness probe
 *   reads as `healthy`), and
 * * `capability` — the capability doctor's per-mechanism verdicts (G4: a
 *   fleet mechanism that silently does nothing on this box),
 *
 * plus `runner_reports`, the provenance of both, and — from plan
 * `2026-11-27-devops-runner-database-degraded-is-invisible-to-coord` Phase 6 —
 *
 * * `runner_database` — coord's verdict on whether the runner is running
 *   WITHOUT ITS DATABASE (`ok | degraded | unknown`), a sibling of the
 *   device's liveness `state` rather than a rung of it: a runner whose
 *   database arm is dead still heartbeats, so `state` alone reads `healthy`.
 *
 * Web's own `derivedStatus` is NOT a database signal (that plan's Phase 0
 * step 2): nothing here reads it, cross-checks against it, or derives the
 * database verdict from anything but coord's served block.
 *
 * ## The one rule this module exists to hold
 *
 * **A report coord could not serve is UNKNOWN, never "none".** `[]` is a
 * measurement — the runner looked and found no incident; `null` is not, and
 * coord says why in `runner_reports.<key>.absent_reason`. Rendering a `null`
 * as "no wedge incidents" is the exact shape G2 exists to close: a wedged
 * runner that looked fine because nothing said otherwise. So every `null` —
 * and every coord that predates the fields entirely — resolves to an
 * `unknown` view naming its reason, rendered "unknown — <reason>".
 *
 * A report that IS served but has gone STALE (coord has not re-received it
 * within `stale_after_secs`) is shown, but labelled stale: an incident list
 * from an hour ago is evidence about an hour ago. Coord already ages a stale
 * report's capability records to `UNKNOWN` (keeping the runner's verdict in
 * `reported_state`), so this module does not re-age them — it renders what
 * coord serves and says which records coord aged.
 *
 * ## Palettes (style guide R3 / §4.2)
 *
 * Two audited kind→attention tables, registered in
 * `console/consoleSurfaces.ts`:
 *
 * * {@link CAPABILITY_ATTENTION_BY_STATE} — `inoperative` is red (a mechanism
 *   is dead on this box and nothing on it will revive it), `degraded` amber
 *   (the mechanism's own next successful run rewrites its record — it clears
 *   itself), `unknown` amber by the ignorance floor, `operative` calm.
 * * {@link WEDGE_ATTENTION_BY_STATE} — `open` is red (the runner's own
 *   recovery has not cleared it, and a wedged runner strands every session on
 *   it), `ended` calm (history).
 * * {@link DATABASE_ATTENTION_BY_STATE} — `no_database` is red (coord's
 *   reason `boot_without_database` with a known onset and a sustain source —
 *   the breaker's `open_for_ms` or the report's `reported_at`: the runner
 *   booted onto
 *   the degraded arm and its breaker opened at boot; on that arm's
 *   placeholder-DSN boot paths
 *   it cannot recover in-process, while its two real-url boot paths recover
 *   once the database answers), `breaker_open` amber (a breaker that opened
 *   at runtime, on either arm, which the runner's own trial closes once the
 *   database answers), `unknown` amber by the ignorance floor, `ok` calm. The
 *   red/amber split follows the severity coord's `runner_database_degraded`
 *   alert carries: coord keys critical on the `boot_without_database` reason,
 *   and so does this kind, so the card and the queue agree on who must act.
 */

import {
  isLiveMachine,
  readMachineRoster,
  rosterCoversHealth,
  rosterCutHidesHealth,
  type RosterExclusions,
} from "@/components/admin/coord/machineHealth";
import type { AttentionMap } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
} from "@/components/console/statusRow";
import type { HealthBadge } from "@/components/console/HealthStrip";
import type {
  FleetHealthPayload,
  RunnerCapabilityRecord,
  RunnerDatabaseDegradedReason,
  RunnerDatabaseReading,
  RunnerDatabaseServed,
  RunnerDatabaseUnknownReason,
  RunnerDatabaseVerdict,
  RunnerReportMeta,
  RunnerReportsMeta,
  RunnerWedgeIncident,
} from "@/lib/api/operations/coordFleet";

// ============================================================================
// Capability — one row per mechanism
// ============================================================================

/**
 * The capability doctor's verdict vocabulary, lower-cased into palette keys.
 * `unknown` also absorbs a wire state this build has no entry for.
 */
export type CapabilityKind = "inoperative" | "degraded" | "unknown" | "operative";

/** Display order: the machine's dead mechanisms first (task contract). */
export const CAPABILITY_KIND_ORDER: readonly CapabilityKind[] = [
  "inoperative",
  "degraded",
  "unknown",
  "operative",
] as const;

/** The exact wire strings coord serves (`runner_reports::CapabilityState`). */
const CAPABILITY_WIRE: Record<string, CapabilityKind> = {
  "INOPERATIVE-ON-THIS-MACHINE": "inoperative",
  DEGRADED: "degraded",
  UNKNOWN: "unknown",
  OPERATIVE: "operative",
};

/**
 * The audited kind→attention table (§4.2). See the module header for why
 * each kind lands where it does.
 */
export const CAPABILITY_ATTENTION_BY_STATE: AttentionMap<CapabilityKind> = {
  inoperative: "author",
  degraded: "waiting",
  unknown: "waiting",
  operative: "none",
};

export const CAPABILITY_BADGE_CLASS: Record<CapabilityKind, string> = {
  inoperative: AUTHOR_RED,
  degraded: WAITING_AMBER,
  unknown: UNKNOWN_AMBER,
  operative: INERT,
};

export const CAPABILITY_AUTHOR_GLYPH_KINDS: ReadonlySet<CapabilityKind> =
  new Set<CapabilityKind>(["inoperative"]);

export const CAPABILITY_PALETTE: StatusPalette<CapabilityKind> = {
  badgeClass: CAPABILITY_BADGE_CLASS,
  authorGlyphKinds: CAPABILITY_AUTHOR_GLYPH_KINDS,
};

/** Operator words for each kind — the badge label. */
const CAPABILITY_LABEL: Record<CapabilityKind, string> = {
  inoperative: "inoperative",
  degraded: "degraded",
  unknown: "unknown",
  operative: "operative",
};

/** A mechanism's verdict, ready to render. */
export interface CapabilityStatus extends RowStatus<CapabilityKind> {
  mechanism: string;
  /** The runner's own verdict, when coord aged it to UNKNOWN. */
  reportedState?: string;
  writtenAt?: string | null;
}

/** Resolve one record. A state this build does not know renders `unknown`. */
export function capabilityStatus(
  record: RunnerCapabilityRecord
): CapabilityStatus {
  const kind: CapabilityKind = CAPABILITY_WIRE[record.state] ?? "unknown";
  const recognised = record.state in CAPABILITY_WIRE;
  const parts: string[] = [];
  if (record.reason) parts.push(record.reason);
  if (!recognised) {
    parts.push(
      `coord served state "${record.state}", which this build has no label for`
    );
  }
  if (record.reported_state) {
    parts.push(
      `coord aged the runner's last verdict (${record.reported_state}) to UNKNOWN: ` +
        "the record is too old to assert"
    );
  }
  return {
    kind,
    label: CAPABILITY_LABEL[kind],
    reason: parts.length > 0 ? parts.join("; ") : undefined,
    attention: CAPABILITY_ATTENTION_BY_STATE[kind],
    mechanism: record.mechanism,
    reportedState: record.reported_state,
    writtenAt: record.written_at,
  };
}

/** Capability rows grouped by kind, in {@link CAPABILITY_KIND_ORDER}. */
export interface CapabilityGroup {
  kind: CapabilityKind;
  rows: CapabilityStatus[];
}

/**
 * Group a served capability list by state, INOPERATIVE first, mechanisms
 * alphabetical within a group. Empty groups are dropped — a group is a
 * heading over rows, and "inoperative (0)" is noise beside a list that says
 * which mechanisms it DID read.
 */
export function groupCapability(
  records: readonly RunnerCapabilityRecord[]
): CapabilityGroup[] {
  const byKind = new Map<CapabilityKind, CapabilityStatus[]>();
  for (const record of records) {
    const status = capabilityStatus(record);
    const rows = byKind.get(status.kind) ?? [];
    rows.push(status);
    byKind.set(status.kind, rows);
  }
  return CAPABILITY_KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => ({
    kind,
    rows: (byKind.get(kind) ?? []).sort((a, b) =>
      a.mechanism.localeCompare(b.mechanism)
    ),
  }));
}

// ============================================================================
// Wedge incidents
// ============================================================================

export type WedgeKind = "open" | "ended";

export const WEDGE_ATTENTION_BY_STATE: AttentionMap<WedgeKind> = {
  open: "author",
  ended: "none",
};

export const WEDGE_BADGE_CLASS: Record<WedgeKind, string> = {
  open: AUTHOR_RED,
  ended: INERT,
};

export const WEDGE_AUTHOR_GLYPH_KINDS: ReadonlySet<WedgeKind> =
  new Set<WedgeKind>(["open"]);

export const WEDGE_PALETTE: StatusPalette<WedgeKind> = {
  badgeClass: WEDGE_BADGE_CLASS,
  authorGlyphKinds: WEDGE_AUTHOR_GLYPH_KINDS,
};

/** A wedge incident, ready to render. */
export interface WedgeStatus extends RowStatus<WedgeKind> {
  incident: RunnerWedgeIncident;
}

export function wedgeStatus(incident: RunnerWedgeIncident): WedgeStatus {
  const kind: WedgeKind = incident.ended_at === null ? "open" : "ended";
  const build = incident.build_id ? ` (build ${incident.build_id})` : "";
  const reason =
    kind === "open"
      ? `The runner's own detector reports ${incident.kind} and has not read clear since${build}.`
      : `Ended${incident.ended_by ? ` (${incident.ended_by})` : ""}${build}.`;
  return {
    kind,
    label: kind === "open" ? `wedged: ${incident.kind}` : incident.kind,
    reason,
    attention: WEDGE_ATTENTION_BY_STATE[kind],
    incident,
  };
}

// ============================================================================
// The reports, resolved
// ============================================================================

/**
 * One report's view. Either coord served it (`read`), or it did not and the
 * reason is carried (`unknown`) — there is no third "empty" arm, because an
 * empty served list IS a read.
 */
export type RunnerReportView<T> =
  | {
      state: "read";
      items: T;
      /** Coord has not re-received the report within its bound. */
      stale: boolean;
      receivedAt: string | null;
      /** Entries coord refused at ingest. */
      droppedEntries: number;
      /** Records the runner itself left out (capability only). */
      omittedByRunner: number;
    }
  | { state: "unknown"; reason: string; detail: string };

export interface ResolvedRunnerReports {
  wedge: RunnerReportView<{ open: WedgeStatus[]; ended: WedgeStatus[] }>;
  capability: RunnerReportView<CapabilityGroup[]>;
  /** Coord's runner-database verdict — see {@link resolveRunnerDatabase}. */
  database: DatabaseView;
}

/** Why a report is unknown when its own meta cannot say (the operator's words). */
const REASON_READ_FAILED = "runner-report read failed";
/** An `unknown` database verdict that came with a `null` reason. */
const REASON_DB_NO_REASON = "coord named no reason";
/** A database verdict outside `ok | degraded | unknown`; the value is in the detail. */
const REASON_DB_UNRECOGNISED_VERDICT =
  "coord served a verdict this build has no label for";
const REASON_NOT_SERVED_BY_COORD = "coord does not serve runner reports";
const REASON_NO_PROVENANCE = "no runner-report provenance";
/** Why the database verdict is unknown when coord served no block at all. */
const REASON_DB_NOT_SERVED_BY_COORD =
  "coord does not serve the database verdict";
const REASON_DB_NO_VERDICT = "no database verdict";

/**
 * An unknown report's reason in words an outsider reads (plan
 * `2026-10-23-console-presentation-spaces` Phase 7). The operator reads
 * coord's own token (`no_publisher`, `build_nameable_key_absent`) or this
 * module's summary of a missing read; neither is vocabulary for someone
 * outside the fleet. A token this table does not know is said in fixed words,
 * never shown: an allowlist, so a new coord token cannot reach an outsider
 * untranslated.
 */
const PRESENTED_REASON: Readonly<Record<string, string>> = {
  build_nameable_key_absent:
    "this machine's runner version does not send this report",
  no_publisher: "nothing on this machine sends this report",
  malformed: "the machine sent this report in a form that could not be read",
  publisher_error: "the machine could not check, and said so",
  stale_report: "the machine's last report is too old to trust",
  unstamped: "the report arrived without a time",
  breaker_unreported: "the report did not say whether the database answers",
  read_failed: "the reports could not be read on the latest check",
  runner_unobserved: "the machine could not confirm its database answers",
  since_in_future:
    "the machine's report is dated ahead of when the coordination service received it",
  [REASON_DB_NO_REASON]: "the check did not say why it is unknown",
  [REASON_DB_UNRECOGNISED_VERDICT]:
    "this version cannot read the check's answer",
  [REASON_DB_NOT_SERVED_BY_COORD]:
    "the coordination service does not provide this check yet",
  [REASON_DB_NO_VERDICT]: "no database check arrived for this machine",
  [REASON_READ_FAILED]: "the reports could not be read on the latest check",
  [REASON_NOT_SERVED_BY_COORD]:
    "the coordination service does not provide these reports yet",
  [REASON_NO_PROVENANCE]: "no report time came with this machine's reports",
};

/** What a reason {@link PRESENTED_REASON} does not know reads as. */
export const PRESENTED_REASON_FALLBACK = "no report arrived for this machine";

/** An unknown report's reason, as presentation mode says it. */
export function presentedUnknownReason(reason: string): string {
  return PRESENTED_REASON[reason] ?? PRESENTED_REASON_FALLBACK;
}

/** Operator-facing explanation per `absent_reason` (the reason itself is shown verbatim). */
const ABSENCE_DETAIL: Record<string, string> = {
  build_nameable_key_absent:
    "Coord can name this machine's running build, and that build published no such report — most likely it predates the publisher.",
  no_publisher:
    "Coord has heard nothing on this machine that could publish this report.",
  malformed: "The runner published this report in a shape coord could not read.",
  publisher_error: "The runner could not look, and said so.",
};

/** What a row's join can offer. Every field may be absent. */
export interface RunnerReportsInput {
  wedge_incidents?: RunnerWedgeIncident[] | null;
  capability?: RunnerCapabilityRecord[] | null;
  runner_reports?: RunnerReportsMeta | null;
  runner_reports_scrape_up?: boolean;
  runner_database?: RunnerDatabaseServed | null;
}

/**
 * Why a report is unknown when its own meta cannot say — coord's read failed,
 * or this coord predates the fields.
 */
function unknownWithoutMeta(
  input: RunnerReportsInput
): { reason: string; detail: string } {
  if (input.runner_reports_scrape_up === false) {
    return {
      reason: REASON_READ_FAILED,
      detail:
        "Coord could not read the runner reports on this poll. This is not 'no incidents' — it is no measurement.",
    };
  }
  if (input.runner_reports === undefined) {
    return {
      reason: REASON_NOT_SERVED_BY_COORD,
      detail:
        "This coord predates the runner-report fields, so nothing about this machine's wedges or capabilities reached the console.",
    };
  }
  return {
    reason: REASON_NO_PROVENANCE,
    detail:
      "Coord served no provenance for this machine's runner reports, so their absence cannot be read as 'none'.",
  };
}

function resolveOne<W, T>(
  value: W[] | null | undefined,
  meta: RunnerReportMeta | undefined,
  input: RunnerReportsInput,
  shape: (items: W[]) => T
): RunnerReportView<T> {
  if (meta === undefined) {
    // No provenance at all: even a served list cannot be dated, and a null
    // cannot be explained. A list is still shown, labelled stale — it is
    // evidence of SOMETHING — but an absent one is unknown.
    if (Array.isArray(value)) {
      return {
        state: "read",
        items: shape(value),
        stale: true,
        receivedAt: null,
        droppedEntries: 0,
        omittedByRunner: 0,
      };
    }
    return { state: "unknown", ...unknownWithoutMeta(input) };
  }
  if (!Array.isArray(value)) {
    const reason = meta.absent_reason ?? "not served";
    const base =
      ABSENCE_DETAIL[reason] ??
      "Coord served no report for this machine and named no reason this build knows.";
    return {
      state: "unknown",
      reason,
      detail: meta.error ? `${base} Runner said: ${meta.error}` : base,
    };
  }
  return {
    state: "read",
    items: shape(value),
    // `stale: null` alongside a served list is coord declining to date it;
    // an undatable report is not fresh.
    stale: meta.stale !== false,
    receivedAt: meta.received_at,
    droppedEntries: meta.dropped_entries,
    omittedByRunner: meta.omitted_by_runner ?? 0,
  };
}

/**
 * Resolve a machine row's runner reports. Pure; the only place a `null`
 * report is turned into words.
 */
export function resolveRunnerReports(
  input: RunnerReportsInput
): ResolvedRunnerReports {
  const meta = input.runner_reports ?? undefined;
  return {
    wedge: resolveOne(
      input.wedge_incidents,
      meta?.wedge_incidents,
      input,
      (incidents) => {
        const all = incidents.map(wedgeStatus);
        return {
          open: all.filter((w) => w.kind === "open"),
          ended: all.filter((w) => w.kind === "ended"),
        };
      }
    ),
    capability: resolveOne(
      input.capability,
      meta?.capability,
      input,
      groupCapability
    ),
    database: resolveRunnerDatabase(input),
  };
}

// ============================================================================
// Runner database — coord's verdict, beside `state`
// ============================================================================

/**
 * The database row's palette kinds. Coord's verdict is three-valued; the two
 * `degraded` kinds split it by who must act (style guide R3):
 *
 * * `no_database` — a `degraded` verdict with coord's reason
 *   `boot_without_database`, a known `since`, and a sustain source (the
 *   breaker's `open_for_ms`, or else the reading's `reported_at`): the runner
 *   booted onto the
 *   degraded arm and its breaker opened at boot. On the arm's placeholder-DSN
 *   boot paths it cannot recover in-process; its two real-url boot paths hold
 *   a real URL and recover once the database answers. Red on exactly the
 *   reason coord keys its CRITICAL (paged) alert on. Coord never fires on a
 *   `degraded` verdict with no `since` (`runner_reports.rs`
 *   `runner_database_firing`; plan D4: "it holds and never fires"), nor on
 *   one with no sustain source to measure against, so neither is red here.
 * * `breaker_open` — a `degraded` verdict with reason `breaker_open`, on
 *   either arm: the breaker opened at runtime, and its own trial closes it
 *   once the database answers, so it clears itself (coord's alert: warning,
 *   never paged). That includes a degraded-arm runner that recovered and then
 *   failed again; its cause line still names the arm.
 * * `unknown` — no verdict: coord says why in `reason`, or served no block.
 *   Two `degraded` verdicts are this kind too, because who must act on them
 *   is unknown (style guide R3): a reason this build has no label for (coord
 *   pages only on `boot_without_database`), and a `boot_without_database`
 *   with no `since` or no sustain source, which coord holds without ever
 *   paging. Presentation mode says it is not working, not how serious.
 * * `ok` — coord's `ok`: a fresh report whose breaker is closed and whose
 *   runner observed the database reachable, in an observation that is not
 *   stale (`runner_reports.rs` `verdict_of_reading`).
 */
export type DatabaseKind = "no_database" | "breaker_open" | "unknown" | "ok";

/** The audited kind→attention table (§4.2). See the module header. */
export const DATABASE_ATTENTION_BY_STATE: AttentionMap<DatabaseKind> = {
  no_database: "author",
  breaker_open: "waiting",
  unknown: "waiting",
  ok: "none",
};

export const DATABASE_BADGE_CLASS: Record<DatabaseKind, string> = {
  no_database: AUTHOR_RED,
  breaker_open: WAITING_AMBER,
  unknown: UNKNOWN_AMBER,
  ok: INERT,
};

export const DATABASE_AUTHOR_GLYPH_KINDS: ReadonlySet<DatabaseKind> =
  new Set<DatabaseKind>(["no_database"]);

export const DATABASE_PALETTE: StatusPalette<DatabaseKind> = {
  badgeClass: DATABASE_BADGE_CLASS,
  authorGlyphKinds: DATABASE_AUTHOR_GLYPH_KINDS,
};

/** The runner arm a runner boots onto without its database (`RUNNER_DATABASE_ARM_DEGRADED`). */
const ARM_DEGRADED = "degraded";

/**
 * Operator words for a `degraded` reason coord serves — the cause line's head.
 * `breaker_open` is not here: its head is the breaker's own state.
 * `satisfies` makes a degraded reason added to
 * `RUNNER_DATABASE_DEGRADED_REASONS` without words fail tsc; the annotation
 * keeps lookups by any served string.
 */
const DEGRADED_REASON_WORDS: Readonly<Record<string, string>> = {
  boot_without_database: "booted without its database",
} satisfies Record<
  Exclude<RunnerDatabaseDegradedReason, "breaker_open">,
  string
>;

/**
 * Operator-facing explanation per `unknown` reason (the reason itself is shown
 * verbatim). `satisfies` checks it covers every reason coord's
 * `DbVerdictReason` serves for `unknown` (`RUNNER_DATABASE_UNKNOWN_REASONS`)
 * plus this module's own read-failed reason; the annotation keeps lookups by
 * any served string.
 */
const DATABASE_UNKNOWN_DETAIL: Readonly<Record<string, string>> = {
  build_nameable_key_absent:
    "Coord can name this machine's running build, and that build sent no database report — most likely the runner build predates the report. This is not 'database ok'.",
  no_publisher:
    "Coord has heard nothing on this machine that could send a database report. This is not 'database ok'.",
  stale_report:
    "The runner's last database report is older than coord's freshness bound, so it is no longer evidence either way.",
  unstamped:
    "Coord holds a database report with no receipt time, so its age — and with it the verdict — is unknown.",
  malformed:
    "The runner sent a database report coord could not read (not an object, or a breaker state outside closed / open / half_open).",
  publisher_error:
    "The runner could not build its database report, and said so.",
  breaker_unreported:
    "The runner's report carries no breaker, and a missing breaker is never read as closed.",
  read_failed:
    "Coord's own device-status read failed on this poll. This is no measurement — not 'database ok'.",
  runner_unobserved:
    "The runner's breaker is closed, but its own probe could not confirm the database is reachable, or that observation is stale. This is not 'database ok'.",
  since_in_future:
    "The breaker's onset or the report's own time is more than 60 s ahead of coord's receipt of it, so the verdict is unknown. Clock skew between the machine and coord is likely.",
  [REASON_READ_FAILED]:
    "Coord's runner-report read failed on this poll, so no database verdict reached the console. This is not 'database ok'.",
  [REASON_DB_NO_REASON]:
    "Coord served an unknown database verdict and named no reason for it. This is not 'database ok'.",
} satisfies Record<
  | RunnerDatabaseUnknownReason
  | typeof REASON_READ_FAILED
  | typeof REASON_DB_NO_REASON,
  string
>;

/**
 * The database row, resolved. `unknown` has the same shape as a
 * {@link RunnerReportView}'s unknown arm, so the section renders all three
 * reports' unknowns through one line.
 */
export type DatabaseView =
  | {
      state: "ok";
      status: RowStatus<DatabaseKind>;
    }
  | {
      state: "degraded";
      status: RowStatus<DatabaseKind>;
      /** Coord's reason and the breaker's own cause, in operator words. */
      cause: string;
      /**
       * The onset coord judged — the served `since`. It is the breaker's
       * `since` unless that runs more than 60 s ahead of the onset
       * `open_for_ms` dates, in which case coord serves the dated onset.
       * Read from the served field, never `reading.breaker.since`. `null` =
       * the report named no onset.
       */
      since: string | null;
      /**
       * The breaker's last connect error. Carried ONLY on this arm: it
       * survives a breaker close, so beside `ok` it would be a stale error
       * presented as current.
       */
      lastError: string | null;
    }
  | { state: "unknown"; reason: string; detail: string };

/**
 * An unknown database view. `detail` is the operator's hover text only — the
 * presentation lens never renders it — and it never carries `last_error`.
 */
function databaseUnknown(
  reason: string,
  meta: RunnerReportMeta | undefined,
  staleAfterSecs: number | undefined,
  reading: RunnerDatabaseReading | null = null
): DatabaseView {
  let detail =
    DATABASE_UNKNOWN_DETAIL[reason] ??
    "Coord served no database verdict for this machine and named no reason this build knows. This is not 'database ok'.";
  if (reason === "stale_report" && staleAfterSecs !== undefined) {
    detail += ` (bound: ${staleAfterSecs}s)`;
  }
  // Coord serves a stale report's reading "so its last words stay visible":
  // say what they were — the breaker state and the arm, never `last_error` —
  // without letting them stand as a current verdict.
  if (reason === "stale_report" && reading) {
    const said = reading.breaker?.state
      ? `breaker ${reading.breaker.state}`
      : "no breaker state";
    const arm = reading.arm ? ` on the ${reading.arm} arm` : "";
    detail += ` The last (stale) report said ${said}${arm}.`;
  }
  if (meta?.received_at) detail += ` Last received ${meta.received_at}.`;
  if (meta?.error) detail += ` Runner said: ${meta.error}`;
  return { state: "unknown", reason, detail };
}

/**
 * Resolve a machine row's runner-database verdict. Pure; the only place the
 * served block is turned into words.
 *
 * * absent / `null` block → `unknown` (never `ok`): a coord predating the
 *   field, coord's own read failing, or a path that does not join it;
 * * `ok` → the badge alone — never the reading, never `last_error`;
 * * `degraded` → the cause (coord's reason plus the breaker's state, cause
 *   class and failed trials) and the since-time;
 * * `unknown`, or a verdict this build has no label for → `unknown` with the
 *   reason verbatim.
 */
export function resolveRunnerDatabase(input: RunnerReportsInput): DatabaseView {
  const served: RunnerDatabaseServed | null | undefined = input.runner_database;
  const meta = input.runner_reports?.runner_database;
  const staleAfterSecs = input.runner_reports?.stale_after_secs;
  if (served === undefined || served === null) {
    if (input.runner_reports_scrape_up === false) {
      return databaseUnknown(REASON_READ_FAILED, meta, staleAfterSecs);
    }
    return {
      state: "unknown",
      reason:
        served === undefined
          ? REASON_DB_NOT_SERVED_BY_COORD
          : REASON_DB_NO_VERDICT,
      detail:
        served === undefined
          ? "This coord predates the runner-database verdict, so nothing about whether this machine's runner has its database reached the console. This is not 'database ok'."
          : "Coord served no runner-database verdict for this machine on this poll. This is not 'database ok'.",
    };
  }
  if (served.verdict === "ok") {
    return {
      state: "ok",
      status: {
        kind: "ok",
        label: "ok",
        reason:
          "the runner's database breaker is closed and it reads the database reachable",
        attention: DATABASE_ATTENTION_BY_STATE.ok,
      },
    };
  }
  if (served.verdict === "degraded") {
    const reading = served.reading;
    const breaker = reading?.breaker ?? null;
    // Red on exactly the reason coord keys critical on, and only when coord
    // could fire on it — never on the arm alone. Coord fires only on a known
    // `since` AND a sustain source (`open_for_ms`, else `reported_at`); a
    // `boot_without_database` missing either is held without paging (plan
    // D4), so it reads amber unknown. `!= null` also covers a coord
    // predating `open_for_ms`, which does not serve the key.
    const sustainKnown =
      breaker?.open_for_ms != null || reading?.reported_at != null;
    const kind: DatabaseKind =
      served.reason === "boot_without_database"
        ? served.since !== null && sustainKnown
          ? "no_database"
          : "unknown"
        : served.reason === "breaker_open"
          ? "breaker_open"
          : "unknown";
    // A `breaker_open` reason's head IS the breaker's state, so a half-open
    // breaker reads "breaker half_open", never "breaker open · breaker
    // half_open". Any other reason keeps its own head and appends a non-open
    // state.
    const head =
      served.reason === "breaker_open"
        ? `breaker ${breaker?.state ?? "open"}`
        : served.reason === null
          ? "coord named no reason"
          : DEGRADED_REASON_WORDS[served.reason] ||
            `coord reason "${served.reason}", which this build has no label for`;
    const parts: string[] = [head];
    if (
      served.reason !== "breaker_open" &&
      breaker?.state &&
      breaker.state !== "open"
    ) {
      parts.push(`breaker ${breaker.state}`);
    }
    if (breaker?.cause_class) parts.push(breaker.cause_class);
    if (
      typeof breaker?.failed_trials === "number" &&
      breaker.failed_trials > 0
    ) {
      parts.push(`${breaker.failed_trials} failed retries`);
    }
    // Name the arm. Only `boot_without_database` already says it (that
    // reason means the degraded arm); an amber `breaker_open` on the degraded
    // arm — a runner that booted without its database, recovered, and failed
    // again at runtime — still reads "degraded arm", so it is not mistaken
    // for an external-arm blip.
    if (
      reading?.arm &&
      !(
        reading.arm === ARM_DEGRADED &&
        served.reason === "boot_without_database"
      )
    ) {
      parts.push(`${reading.arm} arm`);
    }
    // An amber degraded row of the unknown kind says why it is amber, so its
    // cause never reads like the red row's.
    if (kind === "unknown") {
      parts.push(
        served.reason === "boot_without_database"
          ? "coord cannot date or sustain it, so it will not page"
          : "this build cannot rank how serious it is"
      );
    }
    const cause = parts.join(" · ");
    return {
      state: "degraded",
      status: {
        kind,
        label: "degraded",
        reason: cause,
        attention: DATABASE_ATTENTION_BY_STATE[kind],
      },
      cause,
      since: served.since,
      lastError: breaker?.last_error ?? null,
    };
  }
  if (served.verdict === "unknown") {
    return databaseUnknown(
      served.reason ?? REASON_DB_NO_REASON,
      meta,
      staleAfterSecs,
      served.reading
    );
  }
  return {
    state: "unknown",
    reason: REASON_DB_UNRECOGNISED_VERDICT,
    detail: `Coord served verdict "${served.verdict}", which this build has no label for. A verdict this build does not know is never read as 'database ok'.`,
  };
}

/**
 * Each verdict's place in the tally label, worst first. `satisfies` makes a
 * verdict added to `RUNNER_DATABASE_VERDICTS` without a place fail tsc.
 */
const TALLY_RANK = {
  degraded: 0,
  unknown: 1,
  ok: 2,
} as const satisfies Record<RunnerDatabaseVerdict, number>;

/** The fleet tally's keys, worst first; any other key coord serves follows them. */
const TALLY_ORDER: readonly string[] = (
  Object.keys(TALLY_RANK) as RunnerDatabaseVerdict[]
).sort((a, b) => TALLY_RANK[a] - TALLY_RANK[b]);

/**
 * What coord's withheld devices do to the tally, in fixed words — no coord
 * token and never coord's `excluded_error` text, because the strip is shown
 * while presenting — or null when coord says it withheld none.
 */
function withheldWords(
  e: RosterExclusions
): { label: string; sentence: string } | null {
  switch (e.kind) {
    case "none_withheld":
      return null;
    case "withheld": {
      const n = e.unbound + e.boundToOtherTenant;
      return {
        label: "coord withheld machines",
        sentence: `Coord withheld ${n} ${n === 1 ? "machine" : "machines"} from its roster (no binding, or bound to another tenant), so these counts do not cover every machine.`,
      };
    }
    case "withheld_unmeasured":
      return {
        label: "coord's withheld machines uncounted",
        sentence:
          "Coord could not count the machines it withheld from its roster, so these counts may not cover every machine.",
      };
    case "not_stated":
      return {
        label: "coord's withheld machines uncounted",
        sentence:
          "Coord does not say whether it withheld any machines from its roster, so these counts may not cover every machine.",
      };
  }
}

/**
 * The Dev Ops strip's runner-database badge, over coord's `by_runner_database`
 * tally.
 *
 * Label shapes:
 * * `runner database 1 degraded · 2 unknown · 6 ok` — every count shown, and
 *   `unknown` always its own count (never folded into `ok`). The tally is
 *   sparse, so an absent key beside a served tally is a measured 0. A key this
 *   build does not know follows verbatim for the operator; in presentation
 *   mode such keys are folded into one `N other` count, so a new coord token
 *   never reaches an outsider untranslated.
 * * `runner database — no live machine to judge` — coord served a tally
 *   that counts nothing: no row is a live machine (each is a placeholder or
 *   abandoned, or the roster is empty). Not when coord's roster cannot vouch
 *   for every machine (`rosterCoversHealth`, below): there may be live
 *   machines it did not serve, so the zero counts show, amber.
 * * `… — coord withheld machines` / `… — coord's withheld machines
 *   uncounted` — appended to the counts when coord withheld devices from the
 *   roster, could not count what it withheld, or does not say.
 * * `… — coord's roster cut short` — appended instead when coord withheld
 *   nothing but its cut hides rows that could be degrading
 *   (`rosterCutHidesHealth`). `… — coord's roster may be cut short` when
 *   that cut is only inferred (`may_be_cut`: no usable `truncated` flag at
 *   coord's row limit), so the label never states a cut nothing observed. A
 *   cut coord says was only the dead tail adds nothing. Either suffix comes
 *   before ` (stale)`.
 * * `runner database unknown — <reason>` — coord's device-status read failed
 *   (`null`), this coord does not serve the tally (absent), or the
 *   fleet-health read has not answered.
 *
 * The COUNTS are coord's, over its JUDGED population
 * (`fleet_health.rs` `DeviceHealthSnapshot::in_judged_population`: the same
 * predicate as `isLiveMachine`). A placeholder or an abandoned row serves an
 * `unknown` block but is in no count, so every counted unknown is a live
 * machine coord could not judge. The TONE reads the live device rows and those
 * counts (style guide R3):
 * * red (`attention`) when a live device's verdict resolves to the
 *   `no_database` kind;
 * * amber (`waiting`) when a live device is anything but `ok` — a breaker
 *   its own trial closes, or an unknown — or when coord's tally counts
 *   anything but `ok`. Coord builds the device list and the tally from the
 *   same rows in one body (`fleet_health.rs`: `"devices": snaps` beside
 *   `by_runner_database` over `snaps`), so the two never disagree; each term
 *   is defensive against the other, and the counted one also holds a verdict
 *   newer than this build;
 * * amber too when coord's roster cannot vouch for every machine —
 *   `!rosterCoversHealth`, BOTH halves, the predicate `fleetLiveness.ts`
 *   reads for the strip's liveness headline beside this badge:
 *   * the cut: `degradable_dropped > 0`, or a cut coord did not say was only
 *     the dead tail (`rosterCutHidesHealth`);
 *   * the exclusions: devices coord withheld (`excluded`: no binding, or
 *     bound to another tenant), could not count (`excluded: null` beside
 *     `excluded_error`), or does not say it withheld none (no `excluded`).
 *   Either way those rows are in neither the device list nor the counts. A
 *   binding fault that withholds every device serves an empty tally, which
 *   would otherwise read "no live machine to judge" in calm grey while the
 *   headline beside it is amber;
 * * amber too when the latest read failed and the counts are a retained
 *   body's, unless the rule above is red: a count that may be out of date is
 *   never read calm;
 * * calm (`muted`) otherwise. A placeholder or abandoned row never moves it:
 *   it is in neither the live rows nor coord's counts.
 *
 * The strip and the card SHARE ONE RESOLVER ({@link resolveRunnerDatabase}),
 * so they judge one device the same way. They can still show different
 * things: FleetOverview folds coord devices that share a hostname onto one
 * card (last writer wins, `FleetOverview.tsx` `buildMachineGroups`) while the
 * strip reads every device; and the card is red the moment coord serves a
 * `boot_without_database` it could fire on, while coord's
 * `runner_database_degraded` alert waits out its sustain (600 s by default)
 * before it fires.
 *
 * A failed latest read over a retained body keeps coord's counts, marks the
 * label `(stale)` and says in the title which read they come from — the same
 * rule as `faultToVisibilityBadge`.
 *
 * Its title carries no coord token, so it is safe in presentation mode.
 */
export function runnerDatabaseTallyBadge(
  body: FleetHealthPayload | null,
  fleetError: string | null,
  options: { presenting?: boolean } = {}
): HealthBadge {
  const base = {
    key: "runner-database",
    "data-testid": "coord-devops-runner-database-badge",
  };
  const unknown = (reason: string, title: string): HealthBadge => ({
    ...base,
    label: `runner database unknown — ${reason}`,
    tone: "waiting",
    title,
  });
  if (!body) {
    return unknown(
      fleetError ?? "not read yet",
      "Whether each machine's runner has its database. The fleet-health read has not answered, so this is UNKNOWN."
    );
  }
  const tally = body.by_runner_database;
  if (tally === undefined) {
    return unknown(
      "coord does not serve it",
      "This coord predates the runner-database verdict. That is no measurement — not 'every database ok'."
    );
  }
  if (tally === null) {
    return unknown(
      "the device read failed",
      "Coord could not read the machines' reports on this poll, so no machine has a database verdict. That is no measurement — not 'every database ok'."
    );
  }
  const count = (k: string) => tally[k] ?? 0;
  const extra = Object.keys(tally)
    .filter((k) => !TALLY_ORDER.includes(k))
    .sort();
  const otherN = extra.reduce((n, k) => n + count(k), 0);
  const parts = TALLY_ORDER.map((k) => `${count(k)} ${k}`);
  if (options.presenting) {
    if (extra.length > 0) parts.push(`${otherN} other`);
  } else {
    parts.push(...extra.map((k) => `${count(k)} ${k}`));
  }
  const liveViews = (body.devices ?? [])
    .filter(isLiveMachine)
    .map((d) => resolveRunnerDatabase({ runner_database: d.runner_database }));
  const anyNoDatabase = liveViews.some(
    (v) => v.state === "degraded" && v.status.kind === "no_database"
  );
  const liveNotOk = liveViews.some((v) => v.state !== "ok");
  const stale = fleetError !== null;
  const roster = readMachineRoster(body.devices ?? [], body);
  const coversHealth = rosterCoversHealth(roster);
  const cutHidesHealth = rosterCutHidesHealth(roster.cut);
  const withheld = withheldWords(roster.exclusions);
  const counted = TALLY_ORDER.reduce((n, k) => n + count(k), 0) + otherN;
  const asOf = body.as_of ? ` (as of ${body.as_of})` : "";
  const staleMark = stale ? " (stale)" : "";
  // A roster at coord's row limit with no usable `truncated` flag MAY be cut
  // (`may_be_cut`): nothing observed the cut, so the words say "may", as the
  // strip's liveness badge says "list may be cut".
  const cutUnobserved = roster.cut.kind === "may_be_cut";
  // Why the roster cannot vouch, in fixed words: a binding fault names
  // itself first, else a cut that hides health.
  const rosterMark = withheld
    ? ` — ${withheld.label}`
    : cutHidesHealth
      ? cutUnobserved
        ? " — coord's roster may be cut short"
        : " — coord's roster cut short"
      : "";
  return {
    ...base,
    label:
      counted === 0 && coversHealth
        ? `runner database — no live machine to judge${staleMark}`
        : `runner database ${parts.join(" · ")}${rosterMark}${staleMark}`,
    tone: anyNoDatabase
      ? "attention"
      : stale ||
          !coversHealth ||
          liveNotOk ||
          count("degraded") + count("unknown") + otherN > 0
        ? "waiting"
        : "muted",
    title: [
      "Whether each live machine's runner has its database, as coord judged it from the runner's own report. Degraded: the runner is running without its database. Unknown: coord could not judge that machine's database from a current report (often a runner version that does not send one) and it is never counted as ok. Counted over live machines; abandoned and never-seen rows are not counted.",
      cutHidesHealth
        ? cutUnobserved
          ? "Coord's roster may have been cut off at its row limit, so these counts may not cover every machine."
          : "Coord's roster left out machines that could be degrading, so these counts do not cover every machine."
        : "",
      withheld?.sentence ?? "",
      stale
        ? `The latest read failed (${fleetError}); these counts are from the last read that answered${asOf}.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
