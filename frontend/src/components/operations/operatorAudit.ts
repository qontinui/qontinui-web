/**
 * The operator audit feed — plan
 * `2026-08-20-fleet-page-runner-enable-disable-switch` Phase 5.
 *
 * ## Why this exists at all
 *
 * Coord has written `coord.operator_audit` since long before this plan, and
 * mounts `GET /admin/coord/audit/recent` behind its admin router. qontinui-web
 * had no proxy, so the table was **written and unreadable from the console**.
 * The plan's §1 is the case for closing that: `msi-wsl` was delabelled by hand
 * on 2026-08-20 and the delabel was later reversed, and nothing in coord, in
 * the repos, or in any log records who did either. The plan's §7 metric —
 * "the action is auditable: who, when, which repos, and how to reverse it" —
 * is not met by writing the row. It is met when somebody can read it.
 *
 * ## Blast radius is per-action, and is NEVER normalised away
 *
 * `metadata` has no fixed schema and must not be given one. `operator_disable`
 * computes `affected_tenant_ids` before stamping; the merge kill switch stamps
 * `affected_repos`; `fleet.drain.set` stamps `device_id`, `until`, `drained`
 * and the policy `version`. This module RECOGNISES the known blast-radius keys
 * and promotes them, and leaves everything else intact for the raw view — so a
 * writer that starts computing a new one shows up in the console without a
 * change here.
 *
 * The distinction that matters is `unstated`: a row whose metadata carries no
 * blast-radius key at all has an UNKNOWN blast radius, not a zero one. Those
 * two must not render the same, or the feed quietly reassures.
 *
 * ## The nil-operator signature
 *
 * A row whose `operator_id` is all zeroes is the fingerprint of a coord writer
 * that used `resolve_operator_id(&headers)` — which reads an
 * `X-Qontinui-Operator-Id` header qontinui-web never sends and falls back to
 * `Uuid::nil()` — instead of `ctx.operator_id`. `audit_mutation` swallows the
 * resulting FK violation in a fire-and-forget warn, so the failure is silent at
 * write time and only visible here. It is a coord defect to report, not an
 * operator, and the feed says so rather than rendering a plausible-looking id.
 */

/** All-zero UUID: the `resolve_operator_id(&headers)` fallback. */
export const NIL_OPERATOR_ID = "00000000-0000-0000-0000-000000000000";

/** One `coord.operator_audit` row, as coord serves it. */
export interface AuditRow {
  audit_id: string;
  operator_id: string | null;
  action: string;
  resource_kind: string | null;
  resource_key: string | null;
  metadata: unknown;
  occurred_at: string;
}

export interface AuditPayload {
  audit?: AuditRow[];
  count?: number;
}

/** The feed, as far as the page got. A failed read is never an empty feed. */
export type AuditRead =
  | { state: "loading" }
  | { state: "ok"; rows: AuditRow[] }
  | { state: "unavailable"; reason: string };

/**
 * The action filters offered.
 *
 * `fleet.*` is the default because this panel sits under the machine list and
 * the question it answers is "who took this host out". `All actions` is one
 * click away and is labelled, so nobody concludes the fleet actions are the
 * whole audit trail.
 */
export interface AuditFilter {
  id: string;
  label: string;
  /** Sent as coord's `action` param; `null` means no filter. */
  action: string | null;
  /** Rendered under the picker so the filter's reach is never guessed at. */
  hint: string;
}

export const AUDIT_FILTERS: readonly AuditFilter[] = [
  {
    id: "fleet",
    label: "Fleet actions",
    action: "fleet.*",
    hint: "Machine drains and releases, and anything else coord stamps under fleet.*",
  },
  {
    id: "merge",
    label: "Merge actions",
    action: "pr_merge.*",
    hint: "Kill switch, merge enablement, and the rest of the merge-train writes.",
  },
  {
    id: "all",
    label: "All actions",
    action: null,
    hint: "Every operator_audit row for this tenant, newest first.",
  },
];

export const DEFAULT_AUDIT_FILTER_ID = "fleet";

/** Total by construction, and it falls back to the NARROWEST filter — showing
 * fewer rows than asked for is recoverable; showing more is a surprise. */
export function resolveAuditFilter(id: string): AuditFilter {
  return (
    AUDIT_FILTERS.find((f) => f.id === id) ?? (AUDIT_FILTERS[0] as AuditFilter)
  );
}

/** One promoted blast-radius fact. */
export interface BlastRadiusItem {
  key: string;
  label: string;
  value: string;
}

export interface BlastRadius {
  items: BlastRadiusItem[];
  /**
   * True when the row's metadata named no blast-radius key at all.
   *
   * The writer did not compute one — which is not the same as "this action
   * affected nothing", and the view must not let the two look alike.
   */
  unstated: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatList(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return "none";
  return value.map((v) => String(v)).join(", ");
}

/**
 * The blast-radius keys this console knows how to promote.
 *
 * Ordered widest-first: an operator scanning the feed should meet "every tenant
 * this reached" before "the one device it named".
 */
const BLAST_RADIUS_KEYS: readonly {
  key: string;
  label: string;
  format: (v: unknown) => string | null;
}[] = [
  {
    key: "affected_tenant_ids",
    label: "Tenants reached",
    format: (v) => {
      const list = formatList(v);
      if (list === null) return null;
      const n = Array.isArray(v) ? v.length : 0;
      return n === 0 ? "none" : `${n} — ${list}`;
    },
  },
  {
    key: "affected_repos",
    label: "Repos affected",
    format: (v) => {
      const list = formatList(v);
      if (list === null) return null;
      const n = Array.isArray(v) ? v.length : 0;
      return n === 0 ? "none" : `${n} — ${list}`;
    },
  },
  { key: "device_id", label: "Device", format: (v) => String(v) },
  {
    key: "target_operator_id",
    label: "Target operator",
    format: (v) => String(v),
  },
  { key: "scope", label: "Scope", format: (v) => String(v) },
  {
    key: "drained",
    label: "Dispatch",
    format: (v) => (v === true ? "paused" : v === false ? "released" : null),
  },
  { key: "until", label: "Expires", format: (v) => String(v) },
  { key: "version", label: "Policy version", format: (v) => String(v) },
];

/**
 * Promote the blast-radius fields a row's metadata carries.
 *
 * Unknown keys are deliberately NOT dropped — they stay in `metadata`, which
 * the detail panel renders raw. This function decides what gets a label, never
 * what survives.
 */
export function blastRadiusOf(row: AuditRow): BlastRadius {
  const meta = asRecord(row.metadata);
  if (!meta) return { items: [], unstated: true };
  const items: BlastRadiusItem[] = [];
  for (const spec of BLAST_RADIUS_KEYS) {
    if (!(spec.key in meta)) continue;
    const value = meta[spec.key];
    if (value === null || value === undefined) continue;
    const formatted = spec.format(value);
    if (formatted === null) continue;
    items.push({ key: spec.key, label: spec.label, value: formatted });
  }
  return { items, unstated: items.length === 0 };
}

/** The row's stated reason, when it carried one. */
export function reasonOf(row: AuditRow): string | null {
  const meta = asRecord(row.metadata);
  const reason = meta?.["reason"];
  return typeof reason === "string" && reason.trim() ? reason : null;
}

/**
 * True when the acting operator is coord's nil-UUID fallback rather than a
 * person. See the module doc — this is a coord defect, and the plan's §6
 * guardrail exists because it fails SILENTLY at write time.
 */
export function isNilOperator(row: AuditRow): boolean {
  return row.operator_id === NIL_OPERATOR_ID;
}

/**
 * Parse a response body into the read union.
 *
 * A body that is not an object, or whose `audit` is not a list, is
 * `unavailable` — never an empty feed. "Nobody has done anything" and "we could
 * not look" are the two answers this panel exists to keep apart.
 */
export function parseAuditPayload(payload: unknown): AuditRead {
  const body = asRecord(payload);
  if (!body) {
    return {
      state: "unavailable",
      reason: "the audit feed did not come back as an object.",
    };
  }
  if (body["audit"] !== undefined && !Array.isArray(body["audit"])) {
    return {
      state: "unavailable",
      reason: "the audit feed's `audit` field was not a list.",
    };
  }
  const rows = (body["audit"] as AuditRow[] | undefined) ?? [];
  return { state: "ok", rows };
}
