/**
 * Pure derivation for the agent text-unit console — R8 of
 * `frontend/docs/console-ui-style-guide.md`: the status a row shows, the
 * colour it shows it in, the health strip above the list (R1) and the filter
 * counts beside it (R6) are all computed here, with zero JSX, so they can be
 * tested exhaustively and reused by the next surface.
 *
 * The one semantic decision this module owns is **which layer a unit actually
 * resolves from**, across the runner's three-layer chain
 * `account override → fleet default → embedded default`. Only the first two
 * are stored in qontinui-web; the third is an absence, and is rendered as one.
 *
 * R3/§4.2 contract: `ATTENTION_BY_KIND` below is the authored, audited
 * kind→attention table, `STATUS_BADGE_CLASS` is keyed off it, and
 * `unitRows.test.ts` asserts the two agree.
 */

import type { AgentTextUnit } from "@/lib/api/agent-text-units";
import {
  entrypointFor,
  isCopySourceName,
  type UnitKindConfig,
  type UnitLayer,
  type UnitRow,
} from "../types";

// =============================================================================
// Status kinds + the attention table
// =============================================================================

/** Who has to do something about a row. */
export type Attention = "author" | "waiting" | "none";

/**
 * The status a row can carry. One per resolution outcome, plus the one
 * genuinely defective outcome (`account-pinned`).
 */
export type UnitStatusKind =
  | "account-pinned"
  | "account-override"
  | "fleet-default"
  | "embedded-only";

/**
 * **The single source of truth for severity on this surface** (style guide
 * §4.2). One row per kind, each with the reason it lands where it does.
 * Colour is chosen by looking up attention here — never by re-reading the kind
 * name — and `unitRows.test.ts` asserts the palette agrees.
 *
 * Three of the four are `"none"` on purpose. This is an AUTHORING surface, not
 * a monitoring one: an account override is a normal thing to have, a fleet
 * default is the intended steady state, and an embedded-only unit is simply a
 * unit nobody has customized. Manufacturing an alarm for those would be the
 * exact "a red badge on a benign state trains the eye to ignore red" bug §4
 * exists to prevent.
 *
 * * `account-pinned` — **author**. The account override and the fleet default
 *   carry byte-identical files, so the override changes nothing today and
 *   silently pins this account to a snapshot: the next fleet edit will not
 *   reach it. Nothing else clears this; only deleting the override does. It is
 *   the one state on this page that defeats the whole point of a fleet layer.
 * * `account-override` — **none**. A real, intentional divergence from the
 *   fleet default. That is what the layer is for.
 * * `fleet-default` — **none**. Fleet-wide text with no local override. The
 *   steady state.
 * * `embedded-only` — **none**. No stored row at either layer, so the runner
 *   serves the copy compiled into its binary. An absence, not a fault.
 */
export const ATTENTION_BY_KIND: Record<UnitStatusKind, Attention> = {
  "account-pinned": "author",
  "account-override": "none",
  "fleet-default": "none",
  "embedded-only": "none",
};

/** Someone must act now. Nothing else on this surface may mint a red. */
const AUTHOR_RED = "bg-red-500/15 text-red-200 border-red-500/35";
/** Calm in-flight hues — nobody is blocked. */
const ACCOUNT_BLUE = "bg-blue-500/15 text-blue-200 border-blue-500/30";
const FLEET_EMERALD = "bg-emerald-500/15 text-emerald-200 border-emerald-500/30";
const INERT = "bg-muted text-muted-foreground border-border";

/** Keyed off `ATTENTION_BY_KIND`, asserted by the agreement test. */
export const STATUS_BADGE_CLASS: Record<UnitStatusKind, string> = {
  "account-pinned": AUTHOR_RED,
  "account-override": ACCOUNT_BLUE,
  "fleet-default": FLEET_EMERALD,
  "embedded-only": INERT,
};

/**
 * Colourblind-safe glyph rule: red ⇔ `✕`. Every `"author"` kind carries it and
 * no other kind does — asserted, not conventional.
 */
export const AUTHOR_GLYPH_KINDS: ReadonlySet<UnitStatusKind> = new Set([
  "account-pinned",
]);

export const STATUS_LABEL: Record<UnitStatusKind, string> = {
  "account-pinned": "Pinned copy",
  "account-override": "Account override",
  "fleet-default": "Fleet default",
  "embedded-only": "Embedded default",
};

export interface UnitStatus {
  kind: UnitStatusKind;
  label: string;
  /** Plain language, no internal vocabulary (R8). Shown as the native title. */
  reason: string;
  attention: Attention;
}

/** The status of one row, derived from the two stored layers. */
export function statusOf(row: UnitRow): UnitStatus {
  const kind: UnitStatusKind = row.pinsFleet
    ? "account-pinned"
    : row.account
      ? "account-override"
      : row.fleet
        ? "fleet-default"
        : "embedded-only";

  const reason =
    kind === "account-pinned"
      ? "This account's override is identical to the fleet default, so it changes nothing today — but it will keep serving this snapshot after the fleet default is edited. Delete the override to follow the fleet again."
      : kind === "account-override"
        ? row.shadowsFleet
          ? "This account stores its own text, which hides the fleet default. Fleet edits will not reach this account until the override is deleted."
          : "This account stores its own text. No fleet default exists for this name, so the account layer is the only stored copy."
        : kind === "fleet-default"
          ? "Served from the fleet default — every account without an override of its own gets this text."
          : "No stored text at either layer, so sessions get the copy embedded in the runner binary. qontinui-web holds no copy of that text.";

  return { kind, label: STATUS_LABEL[kind], reason, attention: ATTENTION_BY_KIND[kind] };
}

/** R4 — a row needing attention gets a 2px left edge, never a tinted body. */
export function rowAccentClass(status: Pick<UnitStatus, "attention">): string {
  if (status.attention === "author") return "border-l-2 border-l-red-500/80";
  if (status.attention === "waiting") return "border-l-2 border-l-amber-500/80";
  return "";
}

// =============================================================================
// Row construction
// =============================================================================

/**
 * Merge the two stored layers into the display rows.
 *
 * `accountUnits` is the account layer alone and `fleetUnits` the
 * `organization_id IS NULL` layer alone — deliberately NOT the server's
 * resolved view, which drops a fleet default the account has overridden. That
 * dropped row is the whole `shadowsFleet` / `pinsFleet` signal.
 *
 * `config.knownEmbedded` contributes rows for units the runner is known to
 * ship with no stored copy at either layer. It is a display seed only: a name
 * outside it behaves identically once stored.
 */
export function buildUnitRows(
  config: UnitKindConfig,
  accountUnits: AgentTextUnit[],
  fleetUnits: AgentTextUnit[]
): UnitRow[] {
  const account = new Map<string, AgentTextUnit>();
  for (const unit of accountUnits) {
    if (unit.kind === config.kind) account.set(unit.name, unit);
  }
  const fleet = new Map<string, AgentTextUnit>();
  for (const unit of fleetUnits) {
    if (unit.kind === config.kind) fleet.set(unit.name, unit);
  }

  const names = new Set<string>([
    ...config.knownEmbedded,
    ...account.keys(),
    ...fleet.keys(),
  ]);

  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const accountUnit = account.get(name) ?? null;
      const fleetUnit = fleet.get(name) ?? null;
      const resolved = accountUnit ?? fleetUnit;
      const layer: UnitLayer = accountUnit
        ? "account"
        : fleetUnit
          ? "fleet"
          : "embedded";
      // Both layers checksum their `files` map with the same canonical
      // `agent-text-unit-files/v1` digest, so equal checksums mean equal text.
      // A null checksum on either side is UNKNOWN, never "equal".
      const pinsFleet =
        accountUnit !== null &&
        fleetUnit !== null &&
        accountUnit.checksum !== null &&
        accountUnit.checksum === fleetUnit.checksum;

      return {
        kind: config.kind,
        name,
        layer,
        account: accountUnit,
        fleet: fleetUnit,
        resolved,
        shadowsFleet: accountUnit !== null && fleetUnit !== null,
        pinsFleet,
        // An unstored unit inherits the name rule: a leading underscore marks a
        // copy-source spec, and the DB CHECK guarantees a stored one agrees.
        isInvocable: resolved
          ? resolved.is_invocable
          : !isCopySourceName(name),
      } satisfies UnitRow;
    });
}

/** The entrypoint path for a row — the server's value when stored, the kind's
 *  convention when the unit does not exist yet. */
export function entrypointOf(row: UnitRow, kind: string): string {
  return row.resolved?.entrypoint ?? entrypointFor(kind, row.name);
}

// =============================================================================
// Health strip (R1)
// =============================================================================

export type HealthLevel = "ok" | "attention" | "unknown";

export interface CorpusHealth {
  level: HealthLevel;
  headline: string;
  detail: string | null;
  badges: Array<{ label: string; value: number | string }>;
}

/**
 * One derived traffic-light row over the data the page already holds — never a
 * second fetch. `loaded === false` renders every count as `–`, because an
 * unfetched count is UNKNOWN, not zero (R6).
 */
export function deriveCorpusHealth(
  config: UnitKindConfig,
  rows: UnitRow[],
  loaded: boolean
): CorpusHealth {
  if (!loaded) {
    return {
      level: "unknown",
      headline: "Loading the corpus…",
      detail: null,
      badges: [
        { label: "account", value: "–" },
        { label: "fleet", value: "–" },
        { label: "embedded", value: "–" },
        { label: "pinned", value: "–" },
      ],
    };
  }

  const counts = countByStatus(rows);
  const pinned = counts["account-pinned"];
  const level: HealthLevel = pinned > 0 ? "attention" : "ok";

  const headline =
    rows.length === 0
      ? `No ${config.label.toLowerCase()} stored at either layer.`
      : pinned > 0
        ? `${pinned} ${pinned === 1 ? "override is" : "overrides are"} a pinned copy of the fleet default.`
        : `${rows.length} ${rows.length === 1 ? config.singular : `${config.singular}s`} resolve cleanly.`;

  const detail =
    rows.length === 0
      ? "Nothing here yet — sessions fall through to whatever the runner has embedded."
      : pinned > 0
        ? "A pinned override serves the same text today and stops serving it the moment the fleet default changes."
        : null;

  return {
    level,
    headline,
    detail,
    badges: [
      { label: "account", value: counts["account-override"] + pinned },
      { label: "fleet", value: counts["fleet-default"] },
      { label: "embedded", value: counts["embedded-only"] },
      { label: "pinned", value: pinned },
    ],
  };
}

export function countByStatus(rows: UnitRow[]): Record<UnitStatusKind, number> {
  const counts: Record<UnitStatusKind, number> = {
    "account-pinned": 0,
    "account-override": 0,
    "fleet-default": 0,
    "embedded-only": 0,
  };
  for (const row of rows) counts[statusOf(row).kind] += 1;
  return counts;
}

// =============================================================================
// Filters (R6)
// =============================================================================

export type UnitFilterId =
  | "all"
  | "account"
  | "fleet"
  | "embedded"
  | "pinned"
  | "copy-source";

export const UNIT_FILTERS: ReadonlyArray<{ id: UnitFilterId; label: string }> = [
  { id: "all", label: "All" },
  { id: "account", label: "Account" },
  { id: "fleet", label: "Fleet" },
  { id: "embedded", label: "Embedded" },
  { id: "pinned", label: "Pinned" },
  { id: "copy-source", label: "Copy-source" },
];

export function matchesFilter(row: UnitRow, filter: UnitFilterId): boolean {
  switch (filter) {
    case "all":
      return true;
    case "account":
      return row.account !== null;
    case "fleet":
      return row.layer === "fleet";
    case "embedded":
      return row.layer === "embedded";
    case "pinned":
      return row.pinsFleet;
    case "copy-source":
      return !row.isInvocable;
  }
}

/** Substring match over the name and every stored file path. */
export function matchesQuery(row: UnitRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (row.name.toLowerCase().includes(needle)) return true;
  const files = row.resolved?.files ?? {};
  return Object.keys(files).some((path) => path.toLowerCase().includes(needle));
}

export function filterCounts(
  rows: UnitRow[]
): Record<UnitFilterId, number> {
  const counts = {} as Record<UnitFilterId, number>;
  for (const { id } of UNIT_FILTERS) {
    counts[id] = rows.filter((row) => matchesFilter(row, id)).length;
  }
  return counts;
}

// =============================================================================
// File-map comparison
// =============================================================================

export interface FileSetDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
  /** Every path in either side, sorted — the file picker's option list. */
  all: string[];
}

/**
 * Compare two `files` maps path by path.
 *
 * Content comparison is CR-stripped, matching the canonical
 * `agent-text-unit-files/v1` digest: the text crosses Postgres, JSON and a
 * Windows filesystem, and a lone CRLF hop must not report an unchanged file as
 * changed.
 */
export function diffFileSets(
  left: Record<string, string>,
  right: Record<string, string>
): FileSetDiff {
  const all = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const diff: FileSetDiff = {
    added: [],
    removed: [],
    changed: [],
    unchanged: [],
    all,
  };
  for (const path of all) {
    const inLeft = path in left;
    const inRight = path in right;
    if (!inLeft) diff.added.push(path);
    else if (!inRight) diff.removed.push(path);
    else if (stripCr(left[path] ?? "") !== stripCr(right[path] ?? ""))
      diff.changed.push(path);
    else diff.unchanged.push(path);
  }
  return diff;
}

function stripCr(text: string): string {
  return text.replace(/\r/g, "");
}

/** Total UTF-8 size of a files map, for the editor's budget line. */
export function totalBytes(files: Record<string, string>): number {
  const encoder = new TextEncoder();
  return Object.values(files).reduce(
    (sum, text) => sum + encoder.encode(text).length,
    0
  );
}
