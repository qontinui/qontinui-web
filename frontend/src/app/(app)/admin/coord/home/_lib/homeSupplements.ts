/**
 * The reads `/admin/coord/home` makes BESIDE coord's project state, and what
 * each one may say (the 2026-10-31 UX pass; plan
 * `2026-10-23-console-presentation-spaces` Phase 2 follow-up). Pure: the
 * polling is `_hooks/useHomeSupplements.ts`.
 *
 * - **Machine health** — coord's `/fleet/health` roster, the source the
 *   `Dev Ops ▾` nav badge counts "unhealthy" from (`useFleetAlarmBadge`).
 *   Coord's project state reads the same roster and already serves a
 *   degradation row per machine it counts as degrading (`machineHealth.ts`
 *   says which states those are). This read is what lets the Degrading
 *   section say what the nav counts that coord does not call a degradation
 *   (abandoned, no verdict), name machines with no verdict as UNKNOWN, and
 *   still show a degrading machine when the project state's degradation list
 *   was not read — without counting a listed machine twice.
 * - **What needs the operator** — until coord's project state serves its
 *   `needs_me` block, the two counts the Gates and Questions pages read: open
 *   operator-approval gates addressed to the operator (`GET
 *   /admin-dev/overview`, the Gates page's read), and pending agent questions
 *   addressed to the operator (`GET /operations/agent-questions/pending`, the
 *   Questions page's default read). The gate predicate is the one coord's own
 *   `needs_me` source names ("open operator_approval, clearance_audience
 *   operator").
 *
 * Every reading has a state, and only `read` carries a number: a source that
 * could not be read, or answered with a body this page does not recognise, is
 * UNKNOWN — never a zero.
 */

import type { DevOverview } from "@/services/admin-dev-service";
import type { FleetHealthPayload } from "@/lib/api/operations/coordFleet";
import {
  summarizeMachineHealth,
  type MachineHealthCounts,
} from "@/components/admin/coord/machineHealth";

/** How one supplementary read went. */
export type SupplementState = "read" | "could_not_read" | "unknown";

export interface MachineHealthView {
  /** `unknown`: not read yet; `could_not_read`: the latest read failed and none ever landed. */
  state: SupplementState;
  /** Present only when `state` is `read`. */
  counts: MachineHealthCounts | null;
  /** Coord's `as_of` for the roster; null when it sent none. */
  asOf: string | null;
  /** A later read failed; these are the last good counts. */
  stale: boolean;
}

export const MACHINES_NOT_READ: MachineHealthView = {
  state: "unknown",
  counts: null,
  asOf: null,
  stale: false,
};

/** The roster's counts, or null for a body that carried no device list. */
export function parseMachineHealth(
  body: FleetHealthPayload | null | undefined
): { counts: MachineHealthCounts; asOf: string | null } | null {
  if (!body || !Array.isArray(body.devices)) return null;
  return {
    counts: summarizeMachineHealth(body.devices),
    asOf: typeof body.as_of === "string" ? body.as_of : null,
  };
}

/**
 * Whether a machine reading lets the page say nothing is degrading there:
 * read, current, no machine degrading and none without a verdict. An
 * abandoned machine is a decision, not a degradation, so it does not stand
 * in the way.
 */
export function machinesAllHealthy(m: MachineHealthView): boolean {
  return (
    m.state === "read" &&
    !m.stale &&
    m.counts !== null &&
    m.counts.degrading === 0 &&
    m.counts.noVerdict === 0
  );
}

/** "1 machine" / "3 machines". */
function machines(n: number): string {
  return `${n} machine${n === 1 ? "" : "s"}`;
}

/**
 * The Degrading section's machine line, in coord's project-state terms:
 * how many machines are degrading (and whether coord's list above already
 * shows them), how many have no verdict, out of the roster. An unread roster
 * is UNKNOWN, in words. `listed` is how many degrading machines the open
 * degradation rows already list; null when no list was served.
 */
export function machineHealthSentence(
  m: MachineHealthView,
  listed: number | null = null
): string {
  if (m.state !== "read" || m.counts === null) {
    return m.state === "could_not_read"
      ? "Machine health could not be read — unknown, so this view cannot say no machine is degrading."
      : "Machine health has not been read yet — unknown.";
  }
  const { total, healthy, degrading, noVerdict } = m.counts;
  if (total === 0) return "Coord lists no machines.";
  const parts: string[] = [];
  if (degrading > 0) {
    let where = "";
    if (listed !== null) {
      where =
        listed >= degrading
          ? " — listed above"
          : listed > 0
            ? ` — ${listed} listed above, ${degrading - listed} not in coord's list`
            : " — not in coord's list above";
    }
    parts.push(
      `${degrading} of ${machines(total)} ${degrading === 1 ? "is" : "are"} in a degrading state${where}`
    );
  }
  if (noVerdict > 0) {
    parts.push(
      `${noVerdict}${parts.length === 0 ? ` of ${machines(total)}` : ""} ${noVerdict === 1 ? "has" : "have"} no health verdict, so ${noVerdict === 1 ? "its" : "their"} health is unknown`
    );
  }
  if (parts.length > 0) return `${parts.join("; ")}.`;
  return healthy === total
    ? `All ${machines(total)} report healthy.`
    : `${healthy} of ${machines(total)} report healthy; none is degrading.`;
}

// ---------------------------------------------------------------------------
// What needs the operator — counts from the Gates and Questions pages' reads
// ---------------------------------------------------------------------------

export interface QueueCount {
  state: SupplementState;
  /** Present only when `state` is `read`. */
  count: number | null;
  /** `count` is the whole queue; false: at least `count`, more may exist. */
  exact: boolean;
  /** When the figure was produced: coord's `generated_at`, or the read's time. */
  asOf: string | null;
  /** A later read failed; this is the last good count. */
  stale: boolean;
}

export const QUEUE_NOT_READ: QueueCount = {
  state: "unknown",
  count: null,
  exact: false,
  asOf: null,
  stale: false,
};

/** The page size the questions read asks for — the Questions page's own. */
export const QUESTIONS_PAGE_SIZE = 50;

/** The page size the gates read asks for — coord's maximum. */
export const GATES_PAGE_SIZE = 500;

const asNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/**
 * Pending agent questions addressed to the operator, from one page of the
 * Questions page's read at offset 0. Coord's `total` is an exact pre-limit
 * count riding on the returned rows, so it is OMITTED when no row came back —
 * which at offset 0 is an empty queue, a real zero. With rows but no total
 * (an older build), the page length is the count only when coord says the
 * page was not truncated; otherwise it is a lower bound. Null for a body
 * with no `questions` array: not a reading.
 */
export function countPendingOperatorQuestions(
  body: unknown
): { count: number; exact: boolean } | null {
  const rows = Array.isArray(body)
    ? body
    : body && typeof body === "object"
      ? (body as { questions?: unknown }).questions
      : undefined;
  if (!Array.isArray(rows)) return null;
  const env =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const total = asNumber(env.total);
  if (total !== null) return { count: total, exact: true };
  if (rows.length === 0) return { count: 0, exact: true };
  return { count: rows.length, exact: env.truncated === false };
}

/** An open gate the operator must clear — coord's `needs_me` predicate. */
function isOpenOperatorApproval(g: DevOverview["gates"][number]): boolean {
  return (
    g.verdict === "open" &&
    g.clearance_audience === "operator" &&
    (g.predicate as { kind?: unknown } | null)?.kind === "operator_approval"
  );
}

/**
 * Open operator-approval gates, from the Gates page's read filtered to open
 * gates. Coord's `counts.open` is tenant-wide, so the page holds EVERY open
 * gate when it is at least that long (or shorter than the limit asked for);
 * otherwise the count is a lower bound. Null when the web proxy answered with
 * its cold-start envelope (`coord_error` with no kept data) or a body with no
 * gate list: not a reading. A kept (`coord_reconnecting`) envelope is a
 * reading, marked stale by the caller.
 */
export function countOpenOperatorGates(
  overview: DevOverview | null | undefined
): { count: number; exact: boolean; kept: boolean } | null {
  if (!overview || !Array.isArray(overview.gates)) return null;
  if (overview.coord_error && !overview.coord_reconnecting) return null;
  const rows = overview.gates;
  const open = asNumber(overview.counts?.open);
  const complete =
    rows.length < GATES_PAGE_SIZE || (open !== null && rows.length >= open);
  return {
    count: rows.filter(isOpenOperatorApproval).length,
    exact: complete,
    kept: overview.coord_reconnecting === true,
  };
}

/** A queue count in words: "3", "at least 50", or UNKNOWN. */
export function queueCountText(q: QueueCount): string {
  if (q.state !== "read" || q.count === null) return "UNKNOWN";
  return q.exact ? String(q.count) : `at least ${q.count}`;
}

// ---------------------------------------------------------------------------
// Provenance — each supplementary figure names its own read
// ---------------------------------------------------------------------------

export const MACHINES_SOURCE = "coord's machine health";
export const GATES_SOURCE = "coord's open gates";
export const QUESTIONS_SOURCE = "coord's pending questions";

/** A supplementary reading's chip: its source (", last read" when kept) and time. */
export function supplementSource(
  source: string,
  reading: { stale: boolean; asOf: string | null }
): { key: string; source: string; asOf: string | null } {
  return {
    key: source,
    source: reading.stale ? `${source}, last read` : source,
    asOf: reading.asOf,
  };
}
