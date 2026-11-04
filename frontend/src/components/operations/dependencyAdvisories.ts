/**
 * The fleet Rust advisory census — its wire shape, the validator its one
 * reader runs, and the pure per-repo derivation the Dev Ops section renders
 * (plan `2026-11-02-rust-advisories-have-no-fleet-consumer` Phase 5).
 *
 * Coord's `GET /coord/dependency-advisories` serves one census row per repo:
 * the sha it audited, the advisory-DB commit it audited against, when, and a
 * `state` of `clean | vulnerable | not_applicable | unknown`. Nothing here
 * recomputes that verdict; it adds only what the census cannot know about
 * itself — how old it is NOW, and which of its advisories are still open.
 *
 * ## Honesty rules ([policy: unknown-must-not-render-as-a-default],
 * [policy: silent-empty-is-unknown])
 *
 * - A repo with no census row is absent from the body. An empty `census` is
 *   therefore "no census recorded yet" — UNKNOWN — never "clean".
 * - A row in state `unknown` has no measured advisory count: its open count
 *   is `null` (rendered `–`), never `0`, and its `reason` is shown.
 * - A census older than {@link CENSUS_STALE_AFTER_SECS} is stale: a `clean`
 *   verdict from three days ago is not a statement about today's lockfile or
 *   today's advisory DB, so the row is flagged and raised to `waiting`.
 * - A census whose age cannot be established (no parseable `observed_at` and
 *   no `age_secs`) is treated as stale — an undatable reading is not fresh.
 */

import type { Attention } from "@/components/console";

/** The census states coord serves. */
export type CensusState = "clean" | "vulnerable" | "not_applicable" | "unknown";

/** One advisory on one repo's census. */
export interface DependencyAdvisory {
  advisory_id: string;
  package: string;
  version: string;
  /** Version requirements that fix it; empty = no fixed release exists. */
  patched: string[];
  severity: string | null;
  /** Listed in the repo's `.cargo/audit.toml` ignore list. */
  ignored: boolean;
  first_seen_at: string | null;
  last_seen_at: string | null;
  resolved_at: string | null;
}

/** One repo's census row. */
export interface DependencyCensusRow {
  repo: string;
  ecosystem: string | null;
  sha: string | null;
  db_commit: string | null;
  state: string;
  reason: string | null;
  advisory_count: number | null;
  observed_at: string | null;
  /** Coord's age of `observed_at` as of the answer. */
  age_secs: number | null;
  advisories: DependencyAdvisory[];
}

export interface DependencyAdvisoriesPayload {
  available: boolean;
  census: DependencyCensusRow[];
}

/** A census older than this (36 h) is flagged stale. */
export const CENSUS_STALE_AFTER_SECS = 36 * 3600;

const isStr = (v: unknown): v is string => typeof v === "string";
const strOrNull = (v: unknown): string | null => (isStr(v) ? v : null);
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function parseAdvisory(v: unknown): DependencyAdvisory | null {
  if (typeof v !== "object" || v === null) return null;
  const a = v as Record<string, unknown>;
  if (!isStr(a.advisory_id) || !isStr(a.package)) return null;
  return {
    advisory_id: a.advisory_id,
    package: a.package,
    version: isStr(a.version) ? a.version : "",
    patched: Array.isArray(a.patched) ? a.patched.filter(isStr) : [],
    severity: strOrNull(a.severity),
    ignored: a.ignored === true,
    first_seen_at: strOrNull(a.first_seen_at),
    last_seen_at: strOrNull(a.last_seen_at),
    resolved_at: strOrNull(a.resolved_at),
  };
}

function parseRow(v: unknown): DependencyCensusRow | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (!isStr(r.repo) || !isStr(r.state)) return null;
  if (r.advisories !== undefined && !Array.isArray(r.advisories)) return null;
  const advisories: DependencyAdvisory[] = [];
  for (const raw of (r.advisories as unknown[] | undefined) ?? []) {
    const a = parseAdvisory(raw);
    if (a === null) return null;
    advisories.push(a);
  }
  return {
    repo: r.repo,
    ecosystem: strOrNull(r.ecosystem),
    sha: strOrNull(r.sha),
    db_commit: strOrNull(r.db_commit),
    state: r.state,
    reason: strOrNull(r.reason),
    advisory_count: numOrNull(r.advisory_count),
    observed_at: strOrNull(r.observed_at),
    age_secs: numOrNull(r.age_secs),
    advisories,
  };
}

/**
 * Accept a body only when it is the census shape: `available: true` and a
 * `census` array whose every row names its repo and state. A pass-through
 * proxy forwards whatever coord says, so a body of any other shape — or one
 * that says `available: false` — is a failed read, never an empty census.
 */
export function parseDependencyAdvisoriesPayload(
  body: unknown
): DependencyAdvisoriesPayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.available !== true || !Array.isArray(b.census)) return null;
  const census: DependencyCensusRow[] = [];
  for (const raw of b.census) {
    const row = parseRow(raw);
    if (row === null) return null;
    census.push(row);
  }
  return { available: true, census };
}

/**
 * How old the census is NOW, in seconds, or `null` when it cannot be dated.
 *
 * `observed_at` against the page clock first — it keeps advancing while the
 * read is failing, which is what keeps a census from looking fresh forever.
 * Otherwise coord's `age_secs` as of the answer, plus the time since the
 * answer arrived.
 */
export function censusAgeSecs(
  row: DependencyCensusRow,
  nowMs: number,
  answeredAtMs: number | null
): number | null {
  if (row.observed_at) {
    const t = Date.parse(row.observed_at);
    if (!Number.isNaN(t)) return Math.max(0, (nowMs - t) / 1000);
  }
  if (row.age_secs !== null && answeredAtMs !== null) {
    return Math.max(0, row.age_secs + (nowMs - answeredAtMs) / 1000);
  }
  return null;
}

/** The advisories still open: neither ignored nor resolved. */
export function openAdvisories(row: DependencyCensusRow): DependencyAdvisory[] {
  return row.advisories.filter((a) => !a.ignored && a.resolved_at === null);
}

/** Everything the section renders for one repo. */
export interface CensusRowView {
  row: DependencyCensusRow;
  state: CensusState | "unrecognised";
  /** Open (non-ignored, unresolved) advisories. */
  open: DependencyAdvisory[];
  /** `null` = not measured (state unknown / unrecognised); never `0` then. */
  openCount: number | null;
  ignoredCount: number;
  ageSecs: number | null;
  /** Older than the bound, or undatable. */
  stale: boolean;
  attention: Attention;
}

const KNOWN_STATES: ReadonlySet<string> = new Set([
  "clean",
  "vulnerable",
  "not_applicable",
  "unknown",
]);

/**
 * One repo's view. Attention (style guide R3): `vulnerable` with an open
 * advisory is `author` — someone must act. `unknown`, an unrecognised state,
 * and any stale or undatable census are `waiting` — amber's "we do not know".
 * Only a fresh `clean` / `not_applicable` is `none`.
 */
export function viewCensusRow(
  row: DependencyCensusRow,
  nowMs: number,
  answeredAtMs: number | null
): CensusRowView {
  const state = KNOWN_STATES.has(row.state)
    ? (row.state as CensusState)
    : "unrecognised";
  const open = openAdvisories(row);
  const measured = state === "clean" || state === "vulnerable";
  const ageSecs = censusAgeSecs(row, nowMs, answeredAtMs);
  const stale = ageSecs === null || ageSecs > CENSUS_STALE_AFTER_SECS;
  let attention: Attention = "none";
  if (state === "vulnerable" && open.length > 0) attention = "author";
  else if (state === "unknown" || state === "unrecognised" || stale) {
    attention = "waiting";
  } else if (state === "vulnerable") {
    // Vulnerable with nothing open in the list coord sent: the verdict and
    // the rows disagree, which is not a calm state either.
    attention = "waiting";
  }
  return {
    row,
    state,
    open,
    openCount: measured ? open.length : null,
    ignoredCount: row.advisories.filter((a) => a.ignored).length,
    ageSecs,
    stale,
    attention,
  };
}

/** Sort order: who must act first, then the unknown, then the calm; by repo. */
export function sortCensusViews(views: CensusRowView[]): CensusRowView[] {
  const rank: Record<Attention, number> = { author: 0, waiting: 1, none: 2 };
  return [...views].sort(
    (a, b) =>
      rank[a.attention] - rank[b.attention] ||
      a.row.repo.localeCompare(b.row.repo)
  );
}

/** First 7 characters of a sha-like value, or `null`. */
export function shortSha(value: string | null): string | null {
  return value ? value.slice(0, 7) : null;
}
