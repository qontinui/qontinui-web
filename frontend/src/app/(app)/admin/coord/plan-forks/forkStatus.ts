/**
 * `GET /api/v1/plan-library/divergent` — two copies of one plan that do not
 * agree, derived.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4b.
 * The route has existed, schema'd and tested, with **zero frontend
 * consumers**; `/admin/coord/plans` already renders a `coord-plan-divergent`
 * marker when a stem's `variant_count > 1` and, until this surface, that
 * marker had nowhere to go.
 *
 * ## Two forks, reported side by side — and they are NOT the same failure
 *
 * | | grouped by | what disagrees |
 * |---|---|---|
 * | `groups` | `(kind, slug)` | `content_sha256` — the same document captured from two checkouts that drifted apart |
 * | `kind_forks` | `(slug, source_repo)` | `kind` — the class the kind-lock fix prevents |
 *
 * Grouping by `(kind, slug)` structurally **cannot see** a kind fork, whose
 * whole distinguishing feature is that the kinds differ. That is why the route
 * reports them separately, and why this module keeps them separate rather than
 * flattening both into one list with a discriminator nobody reads.
 *
 * ## The page presents the fork. It does not resolve it.
 *
 * The parent plan's own framing — *"the fork is surfaced, not declared
 * away"* — is load-bearing here. Declaring an authority does not merge
 * divergent stems: they are genuinely different documents and the disposition
 * is a **content judgement**, so it stays the operator's call. Nothing in this
 * module ranks variants, picks a winner, or calls one "current". The one
 * ordering claim it makes is temporal (newest `updated_at` first, within a
 * group) and it is labelled as that and nothing more.
 *
 * `resolvable` is the ONE exception, and it is the route's own field, carried
 * verbatim: exactly one `kind_locked` variant means the scanner can
 * unambiguously prefer that row and the fork heals itself. That is a statement
 * about the scanner's behaviour, not a recommendation about which copy is
 * right.
 *
 * ## Computed LIVE
 *
 * The route recomputes on every read; there is no stored list. So an empty
 * answer is a measurement taken NOW, and a failed read is UNKNOWN — the same
 * distinction the rest of this plan turns on. Never cache a fork list into a
 * document: a stale reconciliation list is the same defect class as the fork
 * it is meant to close.
 */

import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  type Attention,
  type AttentionMap,
  type RowStatus,
  type StatusPalette,
} from "@/components/console";

// ---------------------------------------------------------------------------
// The wire shape. Mirrors `backend/app/schemas/plan_library.py`
// (`DivergentResponse`, `DivergentGroup`, `KindForkGroup`, `DivergentVariant`).
// ---------------------------------------------------------------------------

export interface DivergentVariant {
  id: string;
  kind: string;
  kind_locked: boolean;
  content_sha256: string;
  source_repo?: string | null;
  source_path?: string | null;
  title: string;
  status: string;
  current_version: number;
  updated_at: string;
}

/** Same `(kind, slug)`, different `content_sha256`. */
export interface DivergentGroup {
  kind: string;
  slug: string;
  variant_count: number;
  variants: DivergentVariant[];
}

/** Same `(slug, source_repo)`, different `kind`. */
export interface KindForkGroup {
  slug: string;
  source_repo?: string | null;
  kinds: string[];
  variant_count: number;
  /** Exactly one variant is `kind_locked` — the scanner can heal it itself. */
  resolvable: boolean;
  variants: DivergentVariant[];
}

export interface DivergentResponse {
  groups?: DivergentGroup[];
  total?: number;
  kind_forks?: KindForkGroup[];
  kind_fork_total?: number;
}

// ---------------------------------------------------------------------------
// The palette (R3/R4). Registered in `components/console/consoleSurfaces.ts`.
// ---------------------------------------------------------------------------

/**
 * Three kinds, and the attention each carries.
 *
 * `content` and `kind_operator` are RED for the same reason
 * `planReconciliationStatus`'s `disagree` is: two writers of one fact hold
 * different values and **nothing but a human reconciles them**. The scan-safe
 * upsert refuses to pick a winner (it 409s), so no machine is going to clear
 * these.
 *
 * `kind_self_healing` is AMBER — waiting, and genuinely so: one
 * `kind_locked` variant means the scanner will prefer that row on its next
 * pass and the fork resolves with nobody acting.
 */
export const FORK_ATTENTION_BY_KIND = {
  content: "author",
  kind_operator: "author",
  kind_self_healing: "waiting",
} satisfies AttentionMap<ForkKind>;

export type ForkKind = "content" | "kind_operator" | "kind_self_healing";

export const FORK_KIND_CLASS: Record<ForkKind, string> = {
  content: AUTHOR_RED,
  kind_operator: AUTHOR_RED,
  kind_self_healing: UNKNOWN_AMBER,
};

export const FORK_AUTHOR_GLYPH_KINDS: ReadonlySet<ForkKind> = new Set<ForkKind>(
  ["content", "kind_operator"]
);

export const FORK_PALETTE: StatusPalette<ForkKind> = {
  badgeClass: FORK_KIND_CLASS,
  authorGlyphKinds: FORK_AUTHOR_GLYPH_KINDS,
};

/** The calm badge for a variant's own `status` word — not an R3 claim. */
export const VARIANT_STATUS_CLASS = INERT;

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

/**
 * A content fork's badge. Always `content`: there is no self-healing arm for
 * a digest disagreement, because no rule in the product picks a winner.
 */
export function describeContentFork(
  group: DivergentGroup
): RowStatus<ForkKind> {
  return {
    kind: "content",
    label: `${group.variant_count} copies disagree`,
    reason:
      "Same kind and slug, different content digests — one document captured " +
      "from checkouts that have drifted apart. Which copy is the plan is a " +
      "content judgement, so nothing resolves this but a person reading both.",
    attention: FORK_ATTENTION_BY_KIND.content,
  };
}

/**
 * A kind fork's badge, split on the route's own `resolvable`.
 *
 * `resolvable` is forwarded, never recomputed here: it is
 * `sum(kind_locked) == 1` over the variants the route selected, and
 * re-deriving it from a payload this page may have filtered would be a second
 * spelling of one rule.
 */
export function describeKindFork(group: KindForkGroup): RowStatus<ForkKind> {
  if (group.resolvable) {
    return {
      kind: "kind_self_healing",
      label: "scanner will heal",
      reason:
        "Exactly one copy has its kind locked, so the scanner can " +
        "unambiguously prefer that row on its next pass. Nobody has to act — " +
        "but until it runs, the fork is real and both kinds are addressable.",
      attention: FORK_ATTENTION_BY_KIND.kind_self_healing,
    };
  }
  return {
    kind: "kind_operator",
    label: "operator must pick",
    reason:
      "The copies disagree on kind and the scanner cannot tell which is " +
      "right (either none is locked, or more than one is), so the scan-safe " +
      "upsert refuses to resolve it — it 409s rather than pick a winner. " +
      "A person settles it with PATCH /plan-library/{id}/kind.",
    attention: FORK_ATTENTION_BY_KIND.kind_operator,
  };
}

/** A digest, short enough to compare by eye, long enough to be a key. */
export function shortDigest(sha: string | null | undefined): string {
  const value = sha ?? "";
  return value.length > 12 ? value.slice(0, 12) : value || "no digest";
}

/**
 * A variant's provenance, spelled the way the scanner writes `source_repo`
 * (`<repo>/<dir relative to the repo root>`), with the path beneath it.
 *
 * An absent repo is stated rather than blanked: a hand-`POST`ed row carries
 * none, and an empty cell reads as "same as the others".
 */
export function variantOrigin(variant: DivergentVariant): string {
  const repo = variant.source_repo ?? null;
  const path = variant.source_path ?? null;
  if (repo === null && path === null) return "no source recorded";
  if (repo === null) return `${path} (no source repo recorded)`;
  return path ? `${repo}/${path}` : repo;
}

/**
 * Variants newest-touched first.
 *
 * This is a TEMPORAL ordering and nothing else. It is not a ranking, and the
 * first row is not "the current one": `updated_at` is last TOUCHED, so a kind
 * correction moves a copy to the top without anybody editing it.
 */
export function orderVariants(
  variants: readonly DivergentVariant[]
): DivergentVariant[] {
  return [...variants].sort((a, b) => {
    const at = Date.parse(a.updated_at ?? "");
    const bt = Date.parse(b.updated_at ?? "");
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
    if (Number.isNaN(at)) return 1;
    if (Number.isNaN(bt)) return -1;
    return bt - at;
  });
}

export const VARIANT_ORDER_CAVEAT =
  "Newest touched first — a temporal ordering, not a ranking. updated_at is " +
  "last TOUCHED, so a kind correction lifts a copy to the top with no edit " +
  "behind it, and the top row is not 'the' plan.";

// ---------------------------------------------------------------------------
// The whole read
// ---------------------------------------------------------------------------

export interface ForkCensus {
  groups: DivergentGroup[];
  kindForks: KindForkGroup[];
  /** The route's own `total`; `null` when unserved — UNKNOWN, never a length. */
  contentTotal: number | null;
  kindForkTotal: number | null;
  /** Both lists empty AND both totals zero — a measured "no fork". */
  measuredClean: boolean;
}

export function deriveForkCensus(res: DivergentResponse | null): ForkCensus {
  const groups = res?.groups ?? [];
  const kindForks = res?.kind_forks ?? [];
  const contentTotal = typeof res?.total === "number" ? res.total : null;
  const kindForkTotal =
    typeof res?.kind_fork_total === "number" ? res.kind_fork_total : null;
  return {
    groups,
    kindForks,
    contentTotal,
    kindForkTotal,
    measuredClean:
      res !== null &&
      groups.length === 0 &&
      kindForks.length === 0 &&
      contentTotal === 0 &&
      kindForkTotal === 0,
  };
}

export interface ForkHealth {
  level: "green" | "amber" | "red";
  headline: string;
  detail?: string;
  badges: {
    key: string;
    label: string;
    tone: "default" | "muted" | "attention";
    title?: string;
  }[];
}

const DASH = "–";

/**
 * The strip. R6 throughout: an unfetched or unserved count is `–`, never `0`,
 * because "no fork" and "we did not look" are the two readings this whole
 * plan exists to keep apart.
 *
 * **A missing total does not make the forks go away.** The verdict is taken
 * from the ROWS when the route served no count — a strip reading "No fork in
 * what this read returned" above a list rendering that fork contradicts its
 * own page, and it is the same `?? 0` collapse this module's `measuredClean`
 * already refuses. The count stays a dash; only the presence claim is
 * answered from the list.
 */
export function deriveForkHealth(
  census: ForkCensus | null,
  loaded: boolean,
  readFailed: boolean
): ForkHealth {
  const dashes = [
    { key: "content", label: `content forks ${DASH}`, tone: "muted" as const },
    { key: "kind", label: `kind forks ${DASH}`, tone: "muted" as const },
  ];
  if (!loaded || census === null) {
    return readFailed
      ? {
          level: "amber",
          headline: "Could not read the fork list — unknown, not clean",
          detail:
            "This route computes the forks live, so a failed read is the " +
            "absence of a measurement, never a measured zero.",
          badges: dashes,
        }
      : {
          level: "amber",
          headline: "Reading the fork list…",
          detail: "counts appear once the route answers",
          badges: dashes,
        };
  }

  const content = census.contentTotal;
  const kind = census.kindForkTotal;
  const operatorForks = census.kindForks.filter((f) => !f.resolvable).length;
  // NOT `(content ?? 0) > 0`. An unserved `total` is UNKNOWN, and collapsing
  // it to a measured zero made the strip say "No fork in what this read
  // returned" while the list underneath rendered the forks the same response
  // carried. The ROWS are the fact that survives a missing total, so the
  // presence question is answered from them; `measuredClean` at the top of
  // this module is the counterpart and was already right.
  const contentForksPresent =
    content !== null ? content > 0 : census.groups.length > 0;
  const kindForksPresent =
    kind !== null ? kind > 0 : census.kindForks.length > 0;
  const needsPerson = contentForksPresent || operatorForks > 0;
  // A count the route did not serve stays a dash on the badge either way —
  // the strip may say a fork is THERE without inventing how many.
  const totalsUnserved =
    (content === null && census.groups.length > 0) ||
    (kind === null && census.kindForks.length > 0);

  return {
    // GREEN is reserved for a measured clean read that also refreshed. A
    // failed refresh, or a read whose totals the route never served, is a
    // statement about our knowledge — the same reading `deriveCandidateHealth`
    // and `deriveFollowupHealth` now take.
    level: needsPerson
      ? "red"
      : kindForksPresent || readFailed || !census.measuredClean
        ? "amber"
        : "green",
    headline: needsPerson
      ? "Copies of a plan disagree, and only a person can settle it"
      : kindForksPresent
        ? "Kind forks only — the scanner can heal every one of them"
        : census.measuredClean
          ? "No copy of any plan disagrees with another"
          : "No fork in what this read returned",
    detail: readFailed
      ? "Last refresh failed — these counts are stale."
      : totalsUnserved
        ? "The route served no total for a list it did return, so the forks " +
          "below are real and their count is UNKNOWN — the badge is a dash, " +
          "not a zero."
        : census.measuredClean
          ? "Measured now: the route recomputes on every read, so this is a " +
            "fresh zero rather than a cached one."
          : undefined,
    badges: [
      {
        key: "content",
        label: `content forks ${content ?? DASH}`,
        tone: contentForksPresent ? "attention" : "muted",
        title:
          "Same kind and slug, different content digests. Nothing but a " +
          "person reconciles these." +
          (content === null
            ? " The route served no total for this read, so the count is unknown."
            : ""),
      },
      {
        key: "kind",
        label: `kind forks ${kind ?? DASH}`,
        tone: operatorForks > 0 ? "attention" : "muted",
        title:
          `${operatorForks} of them need an operator to pick; the rest have ` +
          "exactly one locked kind and heal on the scanner's next pass." +
          (kind === null
            ? " The route served no total for this read, so the count is unknown."
            : ""),
      },
    ],
  };
}

/** Re-exported so the page and its tests share one spelling. */
export type { Attention };
