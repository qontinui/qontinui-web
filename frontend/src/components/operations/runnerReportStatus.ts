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
 * plus `runner_reports`, the provenance of both.
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
 */

import type { AttentionMap } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
} from "@/components/console/statusRow";
import type {
  RunnerCapabilityRecord,
  RunnerReportMeta,
  RunnerReportsMeta,
  RunnerWedgeIncident,
} from "./useFleetHealth";

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
// The two reports, resolved
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
      reason: "runner-report read failed",
      detail:
        "Coord could not read the runner reports on this poll. This is not 'no incidents' — it is no measurement.",
    };
  }
  if (input.runner_reports === undefined) {
    return {
      reason: "coord does not serve runner reports",
      detail:
        "This coord predates the runner-report fields, so nothing about this machine's wedges or capabilities reached the console.",
    };
  }
  return {
    reason: "no runner-report provenance",
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
  };
}
