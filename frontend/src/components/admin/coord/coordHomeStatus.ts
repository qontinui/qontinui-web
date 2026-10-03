/**
 * coordHomeStatus — everything `/admin/coord/home` DERIVES from coord's
 * project-state door, as pure functions, plus R3's audited severity table for
 * the surface.
 *
 * Plan
 * `2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen`
 * Phase 4. The page answers the operator's three questions — *is this on
 * track, is it correct, does it need me* — from ONE read,
 * `GET /api/v1/operations/project-state`, a plain proxy of coord's
 * `GET /coord/project-state`. The same shared core serves the
 * `coord_project_state` MCP tool, so what the operator sees is what an agent
 * reads.
 *
 * ## Wire shape source
 *
 * Field names follow coord's `crates/coord/src/project_state.rs` (the Phase 1–2
 * door: `on_track`, `degradations`, `correctness`, `does_not_know`), and the
 * plan's Phase 3 wire shape for `needs_me`, which coord serves as
 * `{state: "not_implemented"}` until that phase lands.
 *
 * ## Every block's `state` is the gate
 *
 * Coord serves `state ∈ {read, could_not_read, stale, not_implemented,
 * unknown}` on every block, DISTINCT from its counts. A block that is not
 * `read` carries no counts — with ONE exception: a `stale` degradations block
 * still carries its `open` / `declared` / `recently_cleared` ROWS (below). The
 * parser holds the same line on this side of the wire:
 *
 * - counts are taken ONLY from a `read` block — a count on any other state is
 *   dropped, never trusted;
 * - a missing or non-numeric count is `null` (rendered `–`), never `0`
 *   (`[policy: silent-empty-is-unknown]`);
 * - an unrecognised state string reads `unknown`, never `read`.
 *
 * The one deliberate exception is degradation ROWS on a `stale` block: coord
 * serves them because *"a positive fact survives a stale watcher"*. Their rows
 * render (they are true), but no COUNT is shown for them — not the strip badge
 * and not the recently-cleared tally — because the rows are not known to be
 * all of them.
 *
 * ## A failed latest poll forces amber (style guide R6)
 *
 * The page keeps the last good view when a poll fails, and
 * {@link deriveHomeStrip} is told so (`stale`): the strip is then amber at the
 * least, its headline says the reading is "at the last good read (T)", and the
 * two calm empty states ("Nothing needs you", "Nothing is degrading") are
 * worded in the past tense at T rather than as a present fact.
 *
 * ## R8 — no internal vocabulary on the primary surface
 *
 * Wire keys never reach the screen. `waiting_on_gate` renders "waiting on a
 * condition", `off_vocabulary` "status not recognised", and **`stalled`
 * renders "no recorded change in N days"** — served policy `ux-priorities`
 * `a-label-names-one-referent-and-a-quantity-names-its-unit` ("A label may not
 * assert a judgement the data does not carry"): the class is a mechanical
 * absence-of-recorded-history measure and "stalled" is a verdict it does not
 * compute. The wire key stays `stalled`; this is a rendering rule, pinned by
 * `coordHomeStatus.test.ts`.
 *
 * ## The strip is never green over what it does not know
 *
 * {@link deriveHomeStrip} escalates across the blocks with
 * `escalateAttention`: an operator fork on the list is red (someone must act
 * now), an open degradation is amber, and ANY block that is not `read` — or any
 * `does_not_know` source that is not `read` — floors the strip at amber
 * "cannot tell" (style guide R3, "amber also covers we do not know"; served
 * policy `ux-priorities` `a-status-signal-must-observe-the-state-it-names`).
 * Green is reachable only when every block was read, nothing needs the
 * operator and nothing is degrading.
 */

import {
  escalateAttention,
  type Attention,
} from "@/components/console/attention";
import type { HealthStripLevel } from "@/components/console/HealthStrip";
import { absoluteTime } from "@/components/console/time";
import type { StatusPalette } from "@/components/console/statusRow";
import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
} from "@/components/console/statusRow";

/** The web proxy of coord's operator route. */
export const PROJECT_STATE_API = "/api/v1/operations/project-state";

/** Poll cadence — the profile's "the right altitude, not the fastest feed". */
export const PROJECT_STATE_POLL_MS = 60_000;

// ---------------------------------------------------------------------------
// Block states
// ---------------------------------------------------------------------------

export const BLOCK_STATES = [
  "read",
  "could_not_read",
  "stale",
  "not_implemented",
  "unknown",
] as const;

export type BlockState = (typeof BLOCK_STATES)[number];

/** An unrecognised or absent state is `unknown` — never `read`. */
export function parseBlockState(raw: unknown): BlockState {
  return typeof raw === "string" &&
    (BLOCK_STATES as readonly string[]).includes(raw)
    ? (raw as BlockState)
    : "unknown";
}

/** Plain words for a state that is not `read`, for the strip and the list. */
export const BLOCK_STATE_PHRASE: Readonly<Record<BlockState, string>> = {
  read: "read",
  could_not_read: "could not be read",
  stale: "incomplete or stale",
  not_implemented: "not built yet",
  unknown: "unknown",
};

// ---------------------------------------------------------------------------
// Defensive field readers — an absent or wrong-typed field is null, never 0
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function obj(v: unknown): Json | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Json)
    : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function arr(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

// ---------------------------------------------------------------------------
// on_track
// ---------------------------------------------------------------------------

/** The door's closed, exhaustive work-unit class set, in its report order. */
export const UNIT_CLASSES = [
  "shipped",
  "in_flight",
  "stalled",
  "blocked_on_dependency",
  "waiting_on_gate",
  "not_started",
  "closed_other",
  "off_vocabulary",
  "unset",
] as const;

export type UnitClass = (typeof UNIT_CLASSES)[number];

/** Per class: a count, or `null` when coord did not serve one. */
export type ClassCounts = Readonly<Record<UnitClass, number | null>>;

/** Coord's compiled stall window (14 days) — used only when the wire omits it. */
export const DEFAULT_STALL_WINDOW_SECS = 14 * 24 * 3600;

/** Whole days in a stall window, for the label. */
export function stallWindowDays(windowSecs: number | null): number {
  return Math.round((windowSecs ?? DEFAULT_STALL_WINDOW_SECS) / 86_400);
}

/**
 * The on-screen label per class (R8). `stalled` is worded as the measurement
 * it is — see the module doc; the word "stalled" never reaches the screen.
 */
export function unitClassLabel(
  cls: UnitClass,
  windowSecs: number | null
): string {
  switch (cls) {
    case "shipped":
      return "shipped";
    case "in_flight":
      return "in flight";
    case "stalled":
      return `no recorded change in ${stallWindowDays(windowSecs)} days`;
    case "blocked_on_dependency":
      return "waiting on other work";
    case "waiting_on_gate":
      return "waiting on a condition";
    case "not_started":
      return "not started";
    case "closed_other":
      return "closed without shipping";
    case "off_vocabulary":
      return "status not recognised";
    case "unset":
      return "no status set";
  }
}

/**
 * R8 for coord's own free text (an `exclusion_reason`, a `headline_reason`):
 * those sentences are written for agents and may name the `stalled` class by
 * its wire key. The page words that class as the measurement it is, so the
 * word is replaced here, in the one place every such sentence passes through.
 */
export function withoutVerdictWords(text: string): string {
  return text
    .replace(/\bjudged stalled\b/gi, "judged as having no recorded change")
    .replace(/\bstalled\b/gi, "without recorded change");
}

function parseClassCounts(raw: unknown): ClassCounts {
  const o = obj(raw);
  const out = {} as Record<UnitClass, number | null>;
  for (const c of UNIT_CLASSES) out[c] = o ? num(o[c]) : null;
  return out;
}

export interface NamedUnit {
  slug: string;
  title: string | null;
  firstInProgressAt: string | null;
  lastRecordedChangeAt: string | null;
  ageSecs: number | null;
  /** `last_recorded_change` or `first_in_progress` — what `ageSecs` counts from. */
  ageBasis: string | null;
}

export interface NamedList {
  units: NamedUnit[];
  /** How many more units of this class the door did not name; null = unknown. */
  omitted: number | null;
}

function parseNamedList(raw: unknown): NamedList | null {
  const o = obj(raw);
  if (!o) return null;
  const units = (arr(o.units) ?? []).flatMap((u): NamedUnit[] => {
    const r = obj(u);
    const slug = r ? str(r.slug) : null;
    if (!r || !slug) return [];
    return [
      {
        slug,
        title: str(r.title),
        firstInProgressAt: str(r.first_in_progress_at),
        lastRecordedChangeAt: str(r.last_recorded_change_at),
        ageSecs: num(r.age_secs),
        ageBasis: str(r.age_basis),
      },
    ];
  });
  return { units, omitted: num(o.omitted) };
}

export interface RepoGroup {
  /** The repo name, or null for the unattributed group. */
  key: string | null;
  kind: "repo" | "unattributed_repo" | "unknown";
  rowCount: number | null;
  classes: ClassCounts;
  named: { stalled: NamedList | null; waitingOnGate: NamedList | null };
}

function parseGroup(raw: unknown): RepoGroup | null {
  const o = obj(raw);
  if (!o) return null;
  const kindRaw = str(o.kind);
  const kind =
    kindRaw === "repo" || kindRaw === "unattributed_repo" ? kindRaw : "unknown";
  const named = obj(o.named);
  return {
    key: str(o.key),
    kind,
    rowCount: num(o.row_count),
    classes: parseClassCounts(o.classes),
    named: {
      stalled: parseNamedList(named?.stalled),
      waitingOnGate: parseNamedList(named?.waiting_on_gate),
    },
  };
}

/** Work attributed to an initiative item (or a bucket), as coord counts it. */
export interface AttributedUnits {
  total: number | null;
  inFlight: number | null;
  shipped: number | null;
}

function parseAttributed(raw: unknown): AttributedUnits | null {
  const o = obj(raw);
  return o
    ? {
        total: num(o.total),
        inFlight: num(o.in_flight),
        shipped: num(o.shipped),
      }
    : null;
}

export interface InitiativeItem {
  text: string;
  key: string | null;
  /**
   * Units whose `metadata.initiative_item` equals this item's key — served
   * only when coord's alignment is `read`; null otherwise (not attributable
   * yet), never a zero.
   */
  units: AttributedUnits | null;
}

export interface InitiativeView {
  /** `read`, `could_not_read`, … or `unparseable` (malformed frontmatter). */
  state: BlockState | "unparseable";
  status: string | null;
  starts: string | null;
  ends: string | null;
  /** `unknown` (no declared link yet), `no_live_initiative`, … */
  alignment: string | null;
  reason: string | null;
  inScope: InitiativeItem[] | null;
  /** Units carrying no initiative link; null = not counted. */
  unattributed: AttributedUnits | null;
  /** Units whose link names no in-scope item, with those keys. */
  unknownKey: (AttributedUnits & { keys: string[] }) | null;
  error: string | null;
}

/** "N units, X in flight, Y shipped" — each unknown part a dash. */
export function attributedText(u: AttributedUnits): string {
  const n = (v: number | null) => (v === null ? "–" : String(v));
  return `${n(u.total)} unit${u.total === 1 ? "" : "s"}, ${n(u.inFlight)} in flight, ${n(u.shipped)} shipped`;
}

/**
 * How much in-flight work is attributed to the initiative (plan question 8).
 * Only an alignment of `read` carries counts; `unknown` (no declared link, or
 * the unit read failed) is "not yet attributable", never a zero.
 */
export function initiativeAttributionPhrase(i: InitiativeView): string {
  if (i.alignment !== "read") {
    return i.alignment === "unknown" || i.alignment === null
      ? "work attributed to it: not yet attributable"
      : "work attributed to it: unknown";
  }
  const items = i.inScope ?? [];
  const parts = items.map((it) => it.units?.inFlight ?? null);
  if (items.length === 0 || parts.some((p) => p === null)) {
    return "work attributed to it: counts not served — unknown";
  }
  const inFlight = (parts as number[]).reduce((a, b) => a + b, 0);
  return `work attributed to it: ${inFlight} in flight`;
}

function parseInitiative(raw: unknown): InitiativeView | null {
  const o = obj(raw);
  if (!o) return null;
  const stateRaw = str(o.state);
  const state =
    stateRaw === "unparseable" ? "unparseable" : parseBlockState(stateRaw);
  const inScopeRaw = arr(o.in_scope);
  return {
    state,
    status: str(o.status),
    starts: str(o.starts),
    ends: str(o.ends),
    alignment: str(o.alignment),
    reason: str(o.reason),
    inScope: inScopeRaw
      ? inScopeRaw.flatMap((i): InitiativeItem[] => {
          // coord serves `{text, key, units, reason}`; a bare string is read too
          if (typeof i === "string")
            return [{ text: i, key: null, units: null }];
          const r = obj(i);
          const text = r ? str(r.text) : null;
          return r && text
            ? [{ text, key: str(r.key), units: parseAttributed(r.units) }]
            : [];
        })
      : null,
    unattributed: parseAttributed(o.unattributed),
    unknownKey: (() => {
      const u = obj(o.unknown_key);
      const base = parseAttributed(u);
      return u && base
        ? {
            ...base,
            keys: (arr(u.keys) ?? []).filter(
              (k): k is string => typeof k === "string"
            ),
          }
        : null;
    })(),
    error: typeof o.error === "string" ? o.error : null,
  };
}

export interface OnTrackView {
  state: BlockState;
  error: string | null;
  /** Totals — present ONLY when `state === "read"`. */
  rowCount: number | null;
  totals: ClassCounts | null;
  /** Per-repo groups — present ONLY when `state === "read"`. */
  groups: RepoGroup[] | null;
  initiative: InitiativeView | null;
  stallWindowSecs: number | null;
  /** In-progress units with no recorded history (classed in flight). */
  historyNotRecorded: number | null;
  /**
   * Coord's own merge-shepherd bookkeeping units, left out of every count
   * (`totals.excluded.merge_shepherd_bookkeeping`). Null = not stated.
   */
  excludedBookkeeping: number | null;
}

function parseOnTrack(raw: unknown): OnTrackView {
  const o = obj(raw) ?? {};
  const state = parseBlockState(o.state);
  const read = state === "read";
  const totals = read ? obj(o.totals) : null;
  const groups = read ? arr(o.groups) : null;
  return {
    state,
    error: str(o.error),
    rowCount: totals ? num(totals.row_count) : null,
    totals: totals ? parseClassCounts(totals.classes) : null,
    groups: groups
      ? groups.flatMap((g) => {
          const p = parseGroup(g);
          return p ? [p] : [];
        })
      : null,
    initiative: parseInitiative(o.initiative),
    stallWindowSecs: num(o.stall_window_secs),
    historyNotRecorded: read ? num(o.history_not_recorded) : null,
    excludedBookkeeping: totals
      ? num(obj(totals.excluded)?.merge_shepherd_bookkeeping)
      : null,
  };
}

// ---------------------------------------------------------------------------
// needs_me (plan Phase 3 wire shape)
// ---------------------------------------------------------------------------

export interface NeedsMeItem {
  source: string | null;
  id: string;
  askedAt: string | null;
  ageSecs: number | null;
  /** The decision being asked — the question text, or the gate's title. */
  fork: string | null;
  /** The offered answers; `null` when coord served options this page cannot read. */
  options: string[] | null;
  recommendation: string | null;
  ifOverturned: string | null;
  /** `fork_with_recommendation` | `open_question`, derived coord-side. */
  shape: string | null;
  /** The console page where the existing write door answers it. */
  answerAt: string | null;
  /** What the decision blocks, when coord says. */
  blocking: { workUnitSlug: string | null; planPhase: string | null } | null;
}

export interface NeedsMeView {
  state: BlockState;
  /** Oldest first, as coord serves them — present ONLY when read. */
  items: NeedsMeItem[] | null;
  total: number | null;
  omitted: number | null;
  shapeShare: {
    withRecommendation: number | null;
    total: number | null;
  } | null;
  /** Admitted decisions per decision domain; null = not served. */
  byDomain: Readonly<Record<string, number>> | null;
  /**
   * Whether coord can retire a question whose premise died. `unsupported`
   * means the list may hold questions whose condition already resolved;
   * `unknown` (coord's schema-readiness probe has not yet looked, or the field
   * was not served) is NEVER read as supported.
   */
  retirement: "supported" | "unsupported" | "unknown";
  error: string | null;
}

/** One option: a bare string, or `{label, ...}`. Anything else is unreadable. */
function optionLabel(v: unknown): string | null {
  if (typeof v === "string") return v;
  const o = obj(v);
  return o ? str(o.label) : null;
}

/**
 * Coord's `options` is "an array of `{label, ...}` or bare strings", and may
 * arrive as a single object. Absent → no options. Any entry this page cannot
 * read makes the whole list `null` ("options not readable") rather than
 * silently dropping it.
 */
export function parseOptions(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  const a = arr(raw);
  if (a) {
    const labels = a.map(optionLabel);
    return labels.every((l): l is string => l !== null)
      ? (labels as string[])
      : null;
  }
  const o = obj(raw);
  if (!o) return null;
  const single = str(o.label);
  if (single !== null) return [single];
  const labels = Object.values(o).map(optionLabel);
  return labels.length > 0 && labels.every((l) => l !== null)
    ? (labels as string[])
    : null;
}

function parseByDomain(raw: unknown): Record<string, number> | null {
  const o = obj(raw);
  if (!o) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) {
    const n = num(v);
    if (n === null) return null;
    out[k] = n;
  }
  return out;
}

function parseNeedsMe(raw: unknown): NeedsMeView {
  const o = obj(raw) ?? {};
  const state = parseBlockState(o.state);
  const read = state === "read";
  const itemsRaw = read ? arr(o.items) : null;
  const share = read ? obj(o.shape_share) : null;
  return {
    state,
    items: itemsRaw
      ? itemsRaw.flatMap((i, index): NeedsMeItem[] => {
          const r = obj(i);
          if (!r) return [];
          const id =
            str(r.id) ?? (typeof r.id === "number" ? String(r.id) : null);
          const blocking = obj(r.blocking);
          return [
            {
              source: str(r.source),
              id: id ?? `item-${index}`,
              askedAt: str(r.asked_at),
              ageSecs: num(r.age_secs),
              fork: str(r.fork),
              options: parseOptions(r.options),
              recommendation: str(r.recommendation),
              ifOverturned: str(r.if_overturned),
              shape: str(r.shape),
              answerAt: str(r.answer_at),
              blocking: blocking
                ? {
                    workUnitSlug: str(blocking.work_unit_slug),
                    planPhase: idString(blocking.plan_phase),
                  }
                : null,
            },
          ];
        })
      : null,
    total: read ? num(o.total) : null,
    omitted: read ? num(o.omitted) : null,
    shapeShare: share
      ? {
          withRecommendation: num(share.with_recommendation),
          total: num(share.total),
        }
      : null,
    byDomain: read ? parseByDomain(o.by_domain) : null,
    retirement:
      o.retirement === "supported" || o.retirement === "unsupported"
        ? o.retirement
        : "unknown",
    error: str(o.error),
  };
}

/**
 * Whether "Nothing needs you" may render. ONLY on a `read` block that served
 * an exact zero — never on `not_implemented`, `could_not_read`, a missing
 * total, or anything else. This predicate is the whole rule; the page renders
 * that sentence behind it and nowhere else.
 */
export function nothingNeedsYou(needs: NeedsMeView): boolean {
  return (
    needs.state === "read" &&
    needs.total === 0 &&
    (needs.items?.length ?? 0) === 0
  );
}

/**
 * The one displayable count of decisions waiting on the operator: the served
 * total, but ONLY when it is at least what was listed. A missing total, or a
 * total below the listed items, is not a count to print — it is `null`
 * (rendered "–" / "an unknown number"), never a misleading "0".
 */
export function needsDisplayCount(needs: NeedsMeView): number | null {
  if (needs.state !== "read") return null;
  const listed = needs.items?.length ?? 0;
  return needs.total !== null && needs.total >= listed ? needs.total : null;
}

/** A needs-you row's `reason`: the recommendation, or the literal label. */
export function needsYouReason(item: NeedsMeItem): string {
  if (item.recommendation !== null) return item.recommendation;
  // A gate is an approval, not a question: coord serves it with no
  // recommendation, and calling it an "open question" would misname it.
  return item.source === "operator_gate"
    ? "approval — no recommendation"
    : "open question — no recommendation";
}

// ---------------------------------------------------------------------------
// degradations
// ---------------------------------------------------------------------------

export interface DegradationView {
  id: string;
  plane: string | null;
  subjectName: string | null;
  subjectId: string | null;
  headline: string | null;
  /** The onset coord OBSERVED (`first_seen_at`), not the fault's true start. */
  onsetObservedAt: string | null;
  lastSeenAt: string | null;
  ageSecs: number | null;
  autoRemediation: { bound: boolean | null; response: string | null } | null;
  drill: string | null;
  /** A drain: a decision, shown muted, never counted as a fault. */
  declared: boolean;
  resolvedAt: string | null;
  durationSecs: number | null;
}

function idString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}

function parseDegradation(raw: unknown, index: number): DegradationView | null {
  const o = obj(raw);
  if (!o) return null;
  const subject = obj(o.subject);
  const rem = obj(o.auto_remediation);
  return {
    id: str(o.id) ?? `degradation-${index}`,
    plane: str(o.plane),
    subjectName: subject ? idString(subject.name) : null,
    subjectId: subject ? idString(subject.id) : null,
    headline: str(o.headline),
    onsetObservedAt: str(o.onset_observed_at),
    lastSeenAt: str(o.last_seen_at),
    ageSecs: num(o.age_secs),
    autoRemediation: rem
      ? { bound: bool(rem.bound), response: str(rem.response) }
      : null,
    drill: str(o.drill),
    declared: o.declared === true,
    resolvedAt: str(o.resolved_at),
    durationSecs: num(o.duration_secs),
  };
}

function parseDegradationList(raw: unknown): DegradationView[] | null {
  const a = arr(raw);
  if (!a) return null;
  return a.flatMap((r, i) => {
    const p = parseDegradation(r, i);
    return p ? [p] : [];
  });
}

export interface WatcherView {
  name: string;
  /** `fresh` | `stale` | `unknown` — coord's verdict. */
  state: string;
  asOf: string | null;
  reason: string | null;
}

export interface PlaneView {
  plane: string;
  /** Every watcher feeding the plane is fresh; null = not stated. */
  fresh: boolean | null;
  watchers: WatcherView[];
  detectionBoundSecs: number | null;
}

function parsePlanes(raw: unknown): PlaneView[] | null {
  const o = obj(raw);
  if (!o) return null;
  return Object.entries(o).flatMap(([plane, v]): PlaneView[] => {
    const p = obj(v);
    if (!p) return [];
    return [
      {
        plane,
        fresh: bool(p.fresh),
        watchers: (arr(p.watchers) ?? []).flatMap((w): WatcherView[] => {
          const r = obj(w);
          const name = r ? str(r.name) : null;
          if (!r || !name) return [];
          return [
            {
              name,
              state: str(r.state) ?? "unknown",
              asOf: str(r.as_of),
              reason: str(r.reason),
            },
          ];
        }),
        detectionBoundSecs: num(p.detection_bound_secs),
      },
    ];
  });
}

/** Coord's watcher-freshness reason tokens, in plain words (R8). */
const WATCHER_REASON_WORDS: Readonly<Record<string, string>> = {
  no_successful_tick: "has not completed a run",
  last_success_older_than_3x_interval: "last run is overdue",
  heartbeat_read_failed: "status could not be read",
  no_declared_interval: "no expected interval declared",
  no_heartbeat_row: "has never reported",
};

/** Coord's watcher states, in plain words, for when no reason is given. */
const WATCHER_STATE_WORDS: Readonly<Record<string, string>> = {
  stale: "stale",
  fresh: "fresh",
};

/**
 * One watcher's reason in plain words. A known reason token wins; with none,
 * the watcher's own state is worded (`stale` ⇒ "stale"); "state unknown" only
 * when neither is known.
 */
export function watcherReasonWords(
  reason: string | null,
  state: string | null = null
): string {
  return (
    (reason && WATCHER_REASON_WORDS[reason]) ||
    (state && WATCHER_STATE_WORDS[state]) ||
    "state unknown"
  );
}

/**
 * One plane's watcher freshness, in words. Watcher names are internal
 * vocabulary, so they are NOT in this sentence — see
 * {@link planeWatcherNames}, which the page puts in a `title` only.
 */
export function planeFreshnessPhrase(p: PlaneView): string {
  if (p.watchers.length === 0) {
    return p.fresh === true
      ? "read directly, no watcher"
      : "no watcher reported";
  }
  if (p.fresh === true) {
    return p.watchers.length === 1
      ? "its watcher is fresh"
      : "every watcher fresh";
  }
  const notFresh = p.watchers.filter((w) => w.state !== "fresh");
  if (notFresh.length === 0) return "freshness not stated";
  const reasons = [
    ...new Set(notFresh.map((w) => watcherReasonWords(w.reason, w.state))),
  ];
  const noun = p.watchers.length === 1 ? "watcher" : "watchers";
  return `${notFresh.length} of ${p.watchers.length} ${noun} not fresh — ${reasons.join("; ")}`;
}

/** The raw watcher names behind a plane, for a `title` only. */
export function planeWatcherNames(p: PlaneView): string {
  return p.watchers
    .map((w) => `${w.name}: ${w.state}${w.reason ? ` (${w.reason})` : ""}`)
    .join(", ");
}

/** Human names for coord's decision domains; unknown keys are spaced. */
const DECISION_DOMAIN_LABEL: Readonly<Record<string, string>> = {
  pr_fix: "fixing a pull request",
  red_main_fix: "fixing a red main branch",
  repo_pull: "pulling a repository",
  implementation: "implementation",
  policy_gap: "policy gap",
  unclassified: "unclassified",
  operator_gate: "operator approval gate",
  unscanned: "not yet scanned",
};

export function decisionDomainLabel(domain: string): string {
  return DECISION_DOMAIN_LABEL[domain] ?? domain.replace(/_/g, " ");
}

export interface DegradationsView {
  state: BlockState;
  /** `degraded` | `none` | `unknown` — coord's own headline rule. */
  headline: "degraded" | "none" | "unknown";
  headlineReason: string | null;
  /** Rows — served on `read` and on `stale` (positive facts survive). */
  open: DegradationView[] | null;
  declared: DegradationView[] | null;
  recentlyCleared: DegradationView[] | null;
  /** Per-plane watcher freshness; null = not served. */
  planes: PlaneView[] | null;
  error: string | null;
}

function parseDegradations(raw: unknown): DegradationsView {
  const o = obj(raw) ?? {};
  const state = parseBlockState(o.state);
  const rowsServed = state === "read" || state === "stale";
  const h = str(o.headline);
  return {
    state,
    headline: h === "degraded" || h === "none" ? h : "unknown",
    headlineReason: str(o.headline_reason),
    open: rowsServed ? parseDegradationList(o.open) : null,
    declared: rowsServed ? parseDegradationList(o.declared) : null,
    recentlyCleared: rowsServed
      ? parseDegradationList(o.recently_cleared)
      : null,
    planes: parsePlanes(o.planes),
    error: str(o.error),
  };
}

/** Human names for the operator planes coord classifies degradations into. */
const PLANE_LABEL: Readonly<Record<string, string>> = {
  runner: "runner",
  disk: "disk",
  merge_train: "merge train",
  credential: "credential",
  build_capacity: "build capacity",
  cloud_service: "cloud service",
  coord_itself: "coord",
};

export function planeLabel(plane: string | null): string {
  if (!plane) return "unclassified";
  return PLANE_LABEL[plane] ?? plane.replace(/_/g, " ");
}

/** Plain words for a degradation's remediation binding. */
export function remediationPhrase(d: DegradationView): string {
  if (d.declared) return "declared by an operator — not a fault";
  const rem = d.autoRemediation;
  if (!rem || rem.bound === null) return "remediation binding unknown";
  if (rem.bound) return "an agent response is bound to it";
  if (rem.response?.startsWith("operator:"))
    return "no automatic response — it waits on an operator";
  if (rem.response === "setting") return "caused by a setting, not a fault";
  return "no automatic response is bound";
}

// ---------------------------------------------------------------------------
// correctness + does_not_know
// ---------------------------------------------------------------------------

export interface CorrectnessView {
  state: BlockState;
  reason: string | null;
}

export interface SourceCoverageView {
  source: string;
  state: BlockState;
  asOf: string | null;
  freshnessBoundSecs: number | null;
  rowsConsidered: number | null;
  rowsExcluded: number | null;
  exclusionReason: string | null;
  error: string | null;
}

function parseSource(raw: unknown, index: number): SourceCoverageView | null {
  const o = obj(raw);
  if (!o) return null;
  return {
    source: str(o.source) ?? `source ${index + 1}`,
    state: parseBlockState(o.state),
    asOf: str(o.as_of),
    freshnessBoundSecs: num(o.freshness_bound_secs),
    rowsConsidered: num(o.rows_considered),
    rowsExcluded: num(o.rows_excluded),
    exclusionReason: str(o.exclusion_reason),
    error: str(o.error),
  };
}

// ---------------------------------------------------------------------------
// The whole view
// ---------------------------------------------------------------------------

export interface ProjectStateView {
  schema: number | null;
  generatedAt: string | null;
  tenantId: string | null;
  onTrack: OnTrackView;
  correctness: CorrectnessView;
  needsMe: NeedsMeView;
  degradations: DegradationsView;
  /** `null` when coord served no list — UNKNOWN, not "nothing unknown". */
  doesNotKnow: SourceCoverageView[] | null;
}

/**
 * Parse coord's body. Returns null for a body that is not an object at all
 * (the caller treats that as a read that delivered nothing). Every field is
 * read defensively; see the module doc.
 */
export function parseProjectState(raw: unknown): ProjectStateView | null {
  const o = obj(raw);
  return o ? parseBody(o) : null;
}

function parseBody(o: Json): ProjectStateView {
  const corr = obj(o.correctness) ?? {};
  const dnk = arr(o.does_not_know);
  return {
    schema: num(o.schema),
    generatedAt: str(o.generated_at),
    tenantId: str(o.tenant_id),
    onTrack: parseOnTrack(o.on_track),
    correctness: {
      state: parseBlockState(corr.state),
      reason: str(corr.reason),
    },
    needsMe: parseNeedsMe(o.needs_me),
    degradations: parseDegradations(o.degradations),
    doesNotKnow: dnk
      ? dnk.flatMap((s, i) => {
          const p = parseSource(s, i);
          return p ? [p] : [];
        })
      : null,
  };
}

/**
 * What the page's regions render before any read has delivered: every block
 * `unknown`, no counts, no source list — exactly what the parser makes of a
 * coord that said nothing, so each region shows its not-read sentence rather
 * than disappearing.
 */
export const NOTHING_READ: ProjectStateView = parseBody({});

// ---------------------------------------------------------------------------
// The strip
// ---------------------------------------------------------------------------

export type HomeBlock =
  | "needs_me"
  | "degradations"
  | "on_track"
  | "correctness";

/** The block names as the page shows them. */
export const HOME_BLOCK_LABEL: Readonly<Record<HomeBlock, string>> = {
  needs_me: "needs you",
  degradations: "degrading",
  on_track: "on track",
  correctness: "correct?",
};

export function blockStates(
  view: ProjectStateView
): ReadonlyArray<{ block: HomeBlock; state: BlockState }> {
  return [
    { block: "needs_me", state: view.needsMe.state },
    { block: "degradations", state: view.degradations.state },
    { block: "on_track", state: view.onTrack.state },
    { block: "correctness", state: view.correctness.state },
  ];
}

export interface HomeStripBadge {
  key: string;
  label: string;
  tone: "default" | "muted" | "attention";
  testId: string;
}

export interface HomeStrip {
  level: HealthStripLevel;
  attention: Attention;
  headline: string;
  detail: string | null;
  badges: HomeStripBadge[];
}

const LEVEL_BY_ATTENTION: Readonly<Record<Attention, HealthStripLevel>> = {
  author: "red",
  waiting: "amber",
  none: "green",
};

/** A count badge's value: the number, or `–` for anything not measured. */
function countText(n: number | null): string {
  return n === null ? "–" : String(n);
}

/** Open (non-declared) degradation rows. */
export function openDegradations(
  d: DegradationsView
): DegradationView[] | null {
  return d.open === null ? null : d.open.filter((r) => !r.declared);
}

/** How the page's last read went — the strip must know a poll failed. */
export interface HomeStripReadState {
  /**
   * The latest poll did not replace `view` (style guide R6): the numbers are
   * the last good read's, and the strip is amber at the least.
   */
  stale?: boolean;
}

/** "at the last good read (T)" — the qualifier a stale view carries. */
export function lastGoodReadPhrase(generatedAt: string | null): string {
  return `at the last good read (${absoluteTime(generatedAt)})`;
}

/**
 * The single derived headline (R1). Pure. `view === null` means no read ever
 * delivered a body: the strip then says it cannot tell and every badge is `–`.
 * `read.stale` means the latest poll failed and `view` is the last good one:
 * the strip is then never green, and says so in its headline.
 */
export function deriveHomeStrip(
  view: ProjectStateView | null,
  read: HomeStripReadState = {}
): HomeStrip {
  if (!view) {
    return {
      level: "amber",
      attention: "waiting",
      headline: "Cannot tell — coord has not answered",
      detail:
        "Nothing on this page has been read yet; every count is a dash, not a zero.",
      badges: [
        {
          key: "needs",
          label: "needs you –",
          tone: "muted",
          testId: "coord-home.strip.needs-you",
        },
        {
          key: "degraded",
          label: "degraded –",
          tone: "muted",
          testId: "coord-home.strip.degraded",
        },
        {
          key: "no-change",
          label: `no change ${stallWindowDays(null)} d –`,
          tone: "muted",
          testId: "coord-home.strip.no-change",
        },
        {
          key: "unknown",
          label: "unknown sources –",
          tone: "muted",
          testId: "coord-home.strip.unknown-sources",
        },
      ],
    };
  }

  const stale = read.stale === true;
  const unread = blockStates(view).filter((b) => b.state !== "read");
  const unknownSources =
    view.doesNotKnow === null
      ? null
      : view.doesNotKnow.filter((s) => s.state !== "read").length;

  const needsRead = view.needsMe.state === "read";
  // The displayable count: null when absent OR contradicted by the list.
  const needsTotal = needsDisplayCount(view.needsMe);
  const needsListed = needsRead ? (view.needsMe.items?.length ?? 0) : 0;
  const needsSomething =
    needsRead && ((needsTotal ?? 0) > 0 || needsListed > 0);
  const open = openDegradations(view.degradations);
  const degRowsServed =
    view.degradations.state === "read" || view.degradations.state === "stale";
  const degradedRead = view.degradations.state === "read";
  const stalled = view.onTrack.totals?.stalled ?? null;

  let attention: Attention = "none";
  if (needsSomething) attention = escalateAttention(attention, "author");
  if (open !== null && open.length > 0) {
    attention = escalateAttention(attention, "waiting");
  }
  // Ignorance floors at amber: never green over a block or source not read,
  // over a read block missing the number it exists to report, or over a view
  // the latest poll failed to replace.
  if (
    unread.length > 0 ||
    unknownSources === null ||
    unknownSources > 0 ||
    (needsRead && needsTotal === null) ||
    (degRowsServed && open === null) ||
    stale
  ) {
    attention = escalateAttention(attention, "waiting");
  }

  const unreadPhrase = unread
    .map((b) => `${HOME_BLOCK_LABEL[b.block]} ${BLOCK_STATE_PHRASE[b.state]}`)
    .join("; ");

  let headline: string;
  if (attention === "author") {
    headline =
      // Never "0 decisions need you" beside listed items: a total that is
      // absent, or smaller than what was listed, is not a count to print.
      needsTotal === null
        ? "Decisions need you — how many is unknown"
        : `${needsTotal} ${needsTotal === 1 ? "decision needs" : "decisions need"} you`;
  } else if (open !== null && open.length > 0) {
    headline = "Something is degrading";
  } else if (stale && unread.length === 0) {
    headline = "Cannot tell now — the latest read failed";
  } else if (attention === "waiting") {
    headline = "Cannot tell — part of this view is not read";
  } else {
    headline = "Nothing needs you and nothing is degrading";
  }
  if (stale) headline = `${headline}, ${lastGoodReadPhrase(view.generatedAt)}`;

  const detailParts: string[] = [];
  if (unreadPhrase) detailParts.push(`Not read: ${unreadPhrase}.`);
  if (needsRead && needsTotal === null) {
    detailParts.push(
      "Coord gave no usable count of the decisions that need you."
    );
  }
  if (degRowsServed && open === null) {
    detailParts.push(
      "Coord served no list of open degradations — cannot say whether any exist."
    );
  }
  if (unknownSources === null) {
    detailParts.push("Coord served no list of what it could not read.");
  } else if (unknownSources > 0) {
    detailParts.push(
      `${unknownSources} source${unknownSources === 1 ? "" : "s"} not read — see “What this view does not know”.`
    );
  }

  return {
    level: LEVEL_BY_ATTENTION[attention],
    attention,
    headline,
    detail: detailParts.length > 0 ? detailParts.join(" ") : null,
    badges: [
      {
        key: "needs",
        label: `needs you ${countText(needsTotal)}`,
        tone: needsSomething ? "attention" : needsRead ? "default" : "muted",
        testId: "coord-home.strip.needs-you",
      },
      {
        key: "degraded",
        // Only a READ block's rows are known to be all of them, and only when
        // the list was served at all.
        label: `degraded ${countText(degradedRead && open !== null ? open.length : null)}`,
        tone: degradedRead && open !== null ? "default" : "muted",
        testId: "coord-home.strip.degraded",
      },
      {
        key: "no-change",
        label: `no change ${stallWindowDays(view.onTrack.stallWindowSecs)} d ${countText(stalled)}`,
        tone: stalled === null ? "muted" : "default",
        testId: "coord-home.strip.no-change",
      },
      {
        key: "unknown",
        label: `unknown sources ${countText(unknownSources)}`,
        tone: unknownSources === null ? "muted" : "default",
        testId: "coord-home.strip.unknown-sources",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// R3 — the audited attention table for the surface's rows
// ---------------------------------------------------------------------------

/** Every row kind the page paints a badge for. */
export type HomeRowKind =
  | "needs_you"
  | "degrading"
  | "declared"
  | "cleared"
  | "waiting_on_condition"
  | "no_recorded_change"
  | "repo_group"
  | "source_read"
  | "source_not_read";

/**
 * Who must act on each row kind. A needs-you row is an operator fork (red);
 * a degradation is watched, and clears with its condition (amber); a named
 * unit waiting on a condition waits on something else (amber); a source not
 * read is ignorance, which floors at amber (R3's exception). A unit with no
 * recorded change is a MEASUREMENT, not a claim that someone must act —
 * calm, with the measurement stated in words.
 */
export const HOME_ATTENTION_BY_KIND: Readonly<Record<HomeRowKind, Attention>> =
  {
    needs_you: "author",
    degrading: "waiting",
    declared: "none",
    cleared: "none",
    waiting_on_condition: "waiting",
    no_recorded_change: "none",
    repo_group: "none",
    source_read: "none",
    source_not_read: "waiting",
  };

export const HOME_KIND_CLASS: Readonly<Record<HomeRowKind, string>> = {
  needs_you: AUTHOR_RED,
  degrading: WAITING_AMBER,
  declared: INERT,
  cleared: INERT,
  waiting_on_condition: WAITING_AMBER,
  no_recorded_change: INERT,
  repo_group: INERT,
  source_read: INERT,
  source_not_read: UNKNOWN_AMBER,
};

/** Red ⇔ the colourblind-safe `✕`: exactly the `author` kinds. */
export const HOME_AUTHOR_GLYPH_KINDS: ReadonlySet<HomeRowKind> = new Set(
  (Object.keys(HOME_ATTENTION_BY_KIND) as HomeRowKind[]).filter(
    (k) => HOME_ATTENTION_BY_KIND[k] === "author"
  )
);

export const HOME_STATUS_PALETTE: StatusPalette<HomeRowKind> = {
  badgeClass: HOME_KIND_CLASS,
  authorGlyphKinds: HOME_AUTHOR_GLYPH_KINDS,
};

/** Human duration for an age in seconds: `3d 4h`, `5h 12m`, `40m`. */
export function durationText(secs: number | null): string {
  if (secs === null) return "unknown";
  const m = Math.floor(secs / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${Math.max(m, 0)}m`;
}
