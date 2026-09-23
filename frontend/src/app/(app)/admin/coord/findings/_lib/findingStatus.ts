/**
 * findingStatus — everything `/admin/coord/findings` DERIVES, as pure
 * functions, plus R3's audited severity table for the surface.
 *
 * Named `*Status.ts` deliberately: `attention.test.ts` DISCOVERS attention
 * tables by that suffix under `src/app/**` and `src/components/**`, and its own
 * failure message says a table belongs in one rather than in a directory the
 * discovery globs were widened for. `notificationStatus.ts` is the shape — one
 * module holding a surface's vocabulary, its palette and its banner copy.
 *
 * Plan `2026-09-15-the-console-names-a-finding-it-cannot-open`, Phase 2.
 *
 * **R8 is why this file exists.** Kind, expiry, triage state and the routed-to
 * dossier are all internal vocabulary, and the style guide's rule is that the
 * derivation lives in a pure, unit-tested module rather than inline in JSX, and
 * that the ENUM never reaches the screen — a label goes in the text, the enum
 * goes in a `data-*` attribute. The precedent is
 * `prompt-document-proposals/_lib/writes.ts` + its test, which this follows.
 *
 * ## Expiry is a FACT, and a dossier head is not "expiring"
 *
 * Every `coord.findings` row carries an `expires_at`, and the store has no
 * `expired` boolean — expiry is derived here, from the timestamp. That is not
 * an accident of the API: a `kind=dossier` row is a durable dossier head whose
 * TTL is **a hundred years**, so a row that never expires in practice carries
 * the same field as a fortnight-long observation. Rendering it as "expires in
 * 36524 days" would be true and useless; rendering it as "expiring" would be
 * false.
 *
 * So the classifier keys on the DISTANCE rather than on the kind
 * ({@link DURABLE_HORIZON_MS}): an expiry far enough out that nobody will see
 * it is `durable`, whatever kind the row claims. Keying on `kind === "dossier"`
 * would have been shorter and is the wrong shape twice over — it would put the
 * enum in the predicate (and so, eventually, on the screen), and it would
 * mis-class the next durable kind the findings steward invents.
 *
 * An ABSENT or unparseable `expires_at` is `unknown`, never "never expires":
 * a missing field is the store declining to say, and `silent-empty-is-unknown`
 * applies to a timestamp exactly as it applies to a count.
 */

import type { Attention } from "@/components/console/attention";
import type {
  HealthBadge,
  HealthStripLevel,
} from "@/components/console/HealthStrip";
import {
  UNKNOWN_COUNTS_DETAIL,
  staleDetail,
} from "@/components/console/readFailure";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import { INERT, UNKNOWN_AMBER } from "@/components/console/statusRow";

/** One row of coord's findings store, as the proxy forwards it. */
export interface CoordFindingRow {
  finding_id: string;
  title?: string | null;
  body?: string | null;
  kind?: string | null;
  topic?: string | null;
  scope?: string | null;
  resource_keys?: string[] | null;
  artifact_refs?: Record<string, unknown> | null;
  author_session?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  triaged_at?: string | null;
  triaged_by?: string | null;
  supersedes?: string | null;
  tenant_id?: string | null;
}

/**
 * The envelope `/api/v1/operations/coord/findings` returns.
 *
 * `count` and the `*_applied` echoes are coord's; `unavailable` /
 * `unavailable_kind` are the proxy's degrade pair, present only when coord's
 * findings surface did not answer at all.
 */
export interface FindingsResponse {
  available?: boolean | null;
  count?: number | null;
  findings?: CoordFindingRow[] | null;
  /** The id coord filtered by — `null` on a page read. */
  finding_id_applied?: string | null;
  kind_applied?: string | null;
  /** Kinds a `triaged=false` read leaves out by design (e.g. `["dossier"]`). */
  kind_excluded?: string[] | null;
  limit?: number | null;
  /** How MANY resource keys coord applied — a count, not the keys. */
  resource_keys_applied?: number | null;
  resource_keys_truncated?: boolean | null;
  /** The scope a `triaged=false` read is restricted to (e.g. `"tenant"`). */
  scope_restricted?: string | null;
  /** coord's wire spelling of the triage filter: `"any"`, `"false"` or `"true"`. */
  triaged_applied?: string | null;
  unavailable?: string | null;
  unavailable_kind?: string | null;
}

/**
 * How far out an expiry has to be before the row is "kept", not "expiring".
 *
 * Ten years. The durable class it exists for is a hundred years out and the
 * ordinary classes are days-to-months, so the threshold sits in a two-order-of-
 * magnitude gap: no plausible finding TTL lands near it, which is what makes a
 * single constant honest rather than a tuned guess.
 */
export const DURABLE_HORIZON_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/**
 * What a row's `expires_at` says about its retention. The vocabulary the badge
 * renders — never the finding's own `kind`.
 */
export type FindingRetention = "durable" | "expiring" | "expired" | "unknown";

/**
 * The audited kind → attention table (R3). TOTAL over
 * {@link FindingRetention}, one documented row each:
 *
 * | retention | attention | why |
 * |---|---|---|
 * | `durable` | `none` | A dossier head, kept indefinitely. Nothing is owed and nothing decays. |
 * | `expiring` | `none` | A finding inside its TTL, doing exactly what the store was built to do. Amber would promise something else clears it; nothing does, and nothing needs to. |
 * | `expired` | `none` | Past its TTL and shown anyway, because a by-id read serves it and hiding it is what made this surface necessary. It is a FACT about the row, stated in words — not a demand on anybody. |
 * | `unknown` | `waiting` | No parseable `expires_at`. We cannot say what happens to this row, and R3's floor for not knowing is amber, never calm. |
 *
 * There is deliberately no `author` row. Nothing on this surface is a demand:
 * it is a reader, and the one thing that acts on an untriaged finding is the
 * findings steward, not the operator looking at it.
 */
export const FINDING_ATTENTION_BY_RETENTION: Record<
  FindingRetention,
  Attention
> = {
  durable: "none",
  expiring: "none",
  expired: "none",
  unknown: "waiting",
};

export const FINDING_RETENTION_CLASS: Record<FindingRetention, string> = {
  // Calm and distinctly its own: "this one is not on a clock" is a different
  // statement from "this one's clock has not run out yet", and a reader
  // scanning for the durable heads should not have to read the label.
  durable: "bg-sky-500/10 text-sky-200 border-sky-500/25",
  expiring: INERT,
  // Visibly spent without being an alarm — the dashed treatment the console
  // already uses for "deliberately not in play".
  expired: "bg-transparent text-muted-foreground border-border border-dashed",
  unknown: UNKNOWN_AMBER,
};

/** Red ⇔ the colourblind-safe `✕`: exactly the `author` kinds. There are none. */
export const FINDING_AUTHOR_GLYPH_RETENTIONS: ReadonlySet<FindingRetention> =
  new Set(
    (Object.keys(FINDING_ATTENTION_BY_RETENTION) as FindingRetention[]).filter(
      (k) => FINDING_ATTENTION_BY_RETENTION[k] === "author"
    )
  );

export const FINDING_STATUS_PALETTE: StatusPalette<FindingRetention> = {
  badgeClass: FINDING_RETENTION_CLASS,
  authorGlyphKinds: FINDING_AUTHOR_GLYPH_RETENTIONS,
};

/** Milliseconds, or `null` when the value is absent or unparseable. */
function parseIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The retention class of one row. `now` is injectable so the tests pin the
 * boundaries rather than racing the clock.
 */
export function retentionOf(
  row: Pick<CoordFindingRow, "expires_at">,
  now: number = Date.now()
): FindingRetention {
  const expires = parseIso(row.expires_at);
  if (expires === null) return "unknown";
  if (expires <= now) return "expired";
  return expires - now >= DURABLE_HORIZON_MS ? "durable" : "expiring";
}

/** Is this row past its `expires_at`? The one question the banner asks. */
export function isExpired(
  row: Pick<CoordFindingRow, "expires_at">,
  now: number = Date.now()
): boolean {
  return retentionOf(row, now) === "expired";
}

const RETENTION_LABEL: Record<FindingRetention, string> = {
  durable: "kept indefinitely",
  expiring: "in retention",
  expired: "expired",
  unknown: "retention unknown",
};

const RETENTION_REASON: Record<FindingRetention, string> = {
  durable:
    "Kept indefinitely — its retention runs decades out, so it is not on a clock.",
  expiring: "Inside its retention window — coord will drop it when it lapses.",
  expired:
    "Past its retention window. It is still readable by id, which is why it is shown rather than hidden.",
  unknown:
    "coord served no readable expiry for this row, so what happens to it is unknown — not permanent.",
};

/** The row's status badge: retention, in words, with the reason behind it. */
export function deriveFindingStatus(
  row: Pick<CoordFindingRow, "expires_at">,
  now: number = Date.now()
): RowStatus<FindingRetention> {
  const kind = retentionOf(row, now);
  return {
    kind,
    label: RETENTION_LABEL[kind],
    reason: RETENTION_REASON[kind],
    attention: FINDING_ATTENTION_BY_RETENTION[kind],
  };
}

/**
 * Where the findings steward routed this row, if it did.
 *
 * `artifact_refs.dossier_slug` is the steward's own convention. Anything that
 * is not a non-blank string is `null` — an absent route, never a blank one.
 */
export function dossierSlug(
  row: Pick<CoordFindingRow, "artifact_refs">
): string | null {
  const refs = row.artifact_refs;
  if (!refs || typeof refs !== "object") return null;
  const slug = (refs as Record<string, unknown>).dossier_slug;
  if (typeof slug !== "string") return null;
  const trimmed = slug.trim();
  return trimmed === "" ? null : trimmed;
}

/** What has been DONE with a row, as distinct from how long it is kept. */
export type FindingTriage = "routed" | "triaged" | "untriaged";

export function triageOf(
  row: Pick<CoordFindingRow, "artifact_refs" | "triaged_at">
): FindingTriage {
  if (dossierSlug(row) !== null) return "routed";
  return row.triaged_at ? "triaged" : "untriaged";
}

/**
 * The one line a row's triage state earns.
 *
 * Plain language, no enum: "routed" and "triaged" are our words for the
 * steward's journal, and an operator reading this page has not read that
 * journal.
 */
export function triageSentence(
  row: Pick<CoordFindingRow, "artifact_refs" | "triaged_at" | "triaged_by">
): string {
  const slug = dossierSlug(row);
  const by = (row.triaged_by ?? "").trim();
  const stamp = by ? ` by ${by}` : "";
  if (slug !== null) {
    return `Routed into the ${slug} dossier${stamp}.`;
  }
  if (row.triaged_at) {
    return `Read and dispositioned${stamp} — left to expire rather than routed into a dossier.`;
  }
  return "Not yet read by the findings steward.";
}

/**
 * The console deep link that opens one finding — the ONE builder of this URL.
 * The landed-write feed and the notifications banner import it rather than
 * spelling the path again, because two builders of one link drift.
 */
export function findingHref(id: string): string {
  return `/admin/coord/findings?id=${encodeURIComponent(id)}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Is this `?id=` value something coord could possibly hold?
 *
 * Checked BEFORE the by-id read so a mangled link gets its own sentence
 * ("this link's id is not a finding id") instead of coord's 400 landing in the
 * generic read-failed arm — a malformed link is not a failed lookup, and
 * retrying it would fail forever.
 */
export function isFindingId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * Accept a by-id answer's row only if it IS the row asked for.
 *
 * coord echoes `finding_id_applied` precisely because a door that ignored the
 * id would still return a well-formed page; taking `findings[0]` on trust would
 * expand some other finding under a banner saying it is the linked one.
 */
export function linkedRowFrom(
  rows: CoordFindingRow[],
  linkedId: string
): CoordFindingRow | null {
  const want = linkedId.trim().toLowerCase();
  return rows.find((r) => r.finding_id.toLowerCase() === want) ?? null;
}

/**
 * The caveat the `untriaged only` filter owes the operator.
 *
 * `triaged=false` is not merely "the complement of triaged": coord excludes
 * durable dossier heads and other tenants' fleet-infrastructure rows from it by
 * design, so the count under this filter is NARROWER than the page total for
 * reasons no arithmetic on screen can explain. Two numbers that disagree with
 * no sentence between them is the defect; the sentence is the fix.
 *
 * `null` for every other filter state — there is nothing to explain.
 */
export function triageFilterCaveat(triaged: boolean | null): string | null {
  if (triaged !== false) return null;
  return (
    "Untriaged-only is deliberately narrower than the whole store: it leaves " +
    "out durable dossier heads and fleet-infrastructure rows belonging to " +
    "other tenants. A smaller count here is the filter working, not findings " +
    "going missing."
  );
}

/**
 * The `?id=` banner, as ONE ranked decision.
 *
 * The arm order is lifted from `notificationStatus.linkedRefNotice` and the
 * ranking is the whole point: `loading` sits above `error` and above the
 * fallback and SHORT-CIRCUITS, so the first render — nothing fetched yet —
 * cannot tell the operator the finding does not exist. He arrived here by
 * clicking a link; "not found" is the LAST arm, never the default.
 *
 * One arm is new, and it sits beside `found` rather than after it: an
 * **expired** row IS found. Coord serves a by-id read past `expires_at`
 * precisely so this link keeps working, so the banner states the expiry as a
 * fact about a row that is on screen — it is not a failure to find anything.
 */
export function findingLinkNotice(state: {
  /** The linked row is on screen. */
  found: boolean;
  /** …and is past its `expires_at`. Only consulted when `found`. */
  expired?: boolean;
  /** The by-id read has not answered yet. */
  loading: boolean;
  /** The by-id read failed — we could not look. */
  error?: boolean;
  /** coord's findings surface did not answer at all (not deployed / down). */
  unavailable?: boolean;
  /** The `?id=` value is not a finding id at all — no read was issued. */
  invalid?: boolean;
  /** The linked row is on screen but outside the current filters. */
  outsideFilters?: boolean;
  /**
   * The linked row is on screen but not in the loaded page, and that page came
   * back FULL — so the row may match the filters and simply sit beyond it.
   * Never claim "outside the filters" off a truncated page.
   */
  beyondLoadedPage?: boolean;
}): string {
  // First, and before `found`: a mangled id was never looked up, so no other
  // arm's claim (found, loading, failed, absent) is about it.
  if (state.invalid) {
    return (
      "This link's id is not a finding id, so there is nothing to look up. " +
      "The link itself is malformed — it is not a missing finding."
    );
  }
  if (state.found) {
    const base = state.expired
      ? "Showing the finding this write's author recorded — expanded below. " +
        "It is past its retention window and is served by id anyway, so what " +
        "you are reading is the whole record, not a summary of a deleted one."
      : "Showing the finding this write's author recorded — expanded below.";
    if (state.outsideFilters) {
      return (
        base +
        " It is outside the current filters, so it is shown first and not " +
        "counted in the list total."
      );
    }
    if (state.beyondLoadedPage) {
      return (
        base +
        " It is not in the loaded page of the list, so it is shown first; " +
        "whether it matches the current filters is not known from this page."
      );
    }
    return base;
  }
  // Outranks every arm below: with no findings surface there is no store for
  // the finding to be absent FROM, so "no such finding" would report a
  // deployment state as a fact about this id.
  if (state.unavailable) {
    return (
      "The linked finding cannot be looked up — coord's findings reader is " +
      "not answering. This is an availability state, not a missing finding."
    );
  }
  if (state.loading) return "Looking for the linked finding…";
  if (state.error) {
    return "The linked finding could not be looked up — the read failed. Refresh to retry.";
  }
  return (
    "No finding with that id is readable here. A by-id read is served even " +
    "past expiry, so this is coord answering: the finding was superseded by " +
    "a correction, the id belongs to another tenant, or it names no finding " +
    "at all."
  );
}

/**
 * The page's health strip, derived.
 *
 * R1 — every number here is one the page ALREADY holds; this function cannot
 * fetch. R6 — a count nobody managed to read renders `–`, never `0`, and the
 * strip is amber for every shape of not-knowing rather than green with a
 * caveat underneath.
 *
 * It is never red. Nothing on a reader is a demand, and a red strip over a
 * list of recorded observations would spend the loudest signal the console has
 * on a surface that asks for nothing.
 */
export function deriveFindingsHealth(input: {
  /** coord's server-computed row count for the current query. `null` = unread. */
  count: number | null;
  /** True once a read has SUCCEEDED — never merely "a read finished". */
  loaded: boolean;
  /** The most recent read failed. */
  failed: boolean;
  /** The proxy degraded: coord's findings surface did not answer. */
  unavailable: string | null;
  /** The filter currently narrowing the read, for the window sentence. */
  triaged: boolean | null;
}): {
  level: HealthStripLevel;
  headline: string;
  detail: string;
  badges: HealthBadge[];
  readIsCurrent: boolean;
} {
  const window =
    input.triaged === false
      ? "untriaged findings"
      : input.triaged === true
        ? "triaged findings"
        : "findings";
  const readIsCurrent =
    input.loaded && !input.failed && input.unavailable === null;
  const countBadge: HealthBadge = {
    key: "shown",
    // R6: a count nobody managed to read is a DASH, never a zero. `0 shown`
    // and "we could not read the store" are different claims, and only one of
    // them is true here.
    label:
      readIsCurrent && input.count !== null
        ? `${input.count} shown`
        : "– shown",
    tone: readIsCurrent ? "default" : "muted",
    "data-testid": "coord-findings-count",
  };

  if (input.unavailable !== null) {
    return {
      level: "amber",
      headline: "Findings could not be read",
      detail: input.unavailable,
      badges: [countBadge],
      readIsCurrent: false,
    };
  }
  if (input.failed && !input.loaded) {
    return {
      level: "amber",
      headline: "Could not read the findings store",
      detail: UNKNOWN_COUNTS_DETAIL,
      badges: [countBadge],
      readIsCurrent: false,
    };
  }
  if (input.failed) {
    return {
      level: "amber",
      headline: "These results stopped updating",
      detail: staleDetail(`Showing ${window} from the last read that landed.`),
      badges: [countBadge],
      readIsCurrent: false,
    };
  }
  if (!input.loaded) {
    return {
      level: "amber",
      headline: "Reading the findings store…",
      detail:
        "Nothing has answered yet, so the count is a dash rather than a zero.",
      badges: [countBadge],
      readIsCurrent: false,
    };
  }
  return {
    level: "green",
    headline: `${input.count ?? 0} ${window} in this window`,
    detail:
      "Findings are what agents recorded and why. Nothing here is waiting on you.",
    badges: [countBadge],
    readIsCurrent: true,
  };
}
