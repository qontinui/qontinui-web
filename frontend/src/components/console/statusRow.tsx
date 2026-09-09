"use client";

// ============================================================================
// statusRow — the row primitives every "one row per entity, ONE plain-language
// status" console surface shares.
// ============================================================================
//
// ENFORCES R2 (one record = one line), R3 (colour encodes who must act) and
// R4 (left-edge accent, not a coloured row) — see
// `frontend/docs/console-ui-style-guide.md` §2 and §3.1.
//
// MOVED from `components/operations/` into `components/console/` by plan
// `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 1 (D3):
// these are presentation-only primitives, not merge-train feature code, and
// they are the base the composition primitives beside this file are built on.
// The module is otherwise UNCHANGED — Phase 1 adopts this extraction rather
// than re-doing it, because a second `StatusBadge`/accent/time implementation
// in the same repo is precisely the defect that plan exists to remove.
//
// Extracted from MergePipeline.tsx by plan
// `2026-08-05-coord-alerts-surface-and-fleet-style-ui.md`. Its SHARED UI
// CONVENTIONS section told the next surface (the Alerts tab) to "reuse
// `rowAccentClass` / `StatusBadge` / `RowTime`" — but all three were
// module-private in MergePipeline and each was typed to `PipelineRow`, so the
// instruction was unactionable and the only way to follow it was to fork a
// second copy. Two surfaces sharing one *paragraph* had already drifted; two
// surfaces sharing one *implementation* cannot.
//
// THE PALETTE RULE, and the whole point of it: **color encodes who has to do
// something, not how alarming the word sounds.** Red is reserved for
// `attention: "author"` — someone must act now. Amber means the row is waiting
// on something else and will clear itself. Everything else is a calm in-flight
// hue (yellow = work running, purple/blue = in motion, green = done, muted =
// inert).
//
// Getting this backwards is the bug the families below exist to prevent: a red
// badge on "CI hasn't finished" trained the eye to ignore red, while a failed
// check — the one state that genuinely needs a push — sat in amber next to it.
// Each surface supplies its own kind→class table via `StatusPalette`, and each
// surface's unit test asserts that table agrees with its own kind→attention
// table, so the severity model and the palette can never drift apart.

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { absoluteTime, relativeTime } from "./time";
import type { Attention } from "./attention";
// TYPE-ONLY. `statusRow` must stay free of a runtime dependency on
// `prPipeline` (1576 lines of merge-train derivation): the Alerts tab imports
// these primitives and has no business bundling the PR pipeline.
import type {
  DwellEvidence,
  UnifiedStatusKind,
} from "@/components/operations/prPipeline";

/**
 * The MINIMUM a row's status must carry to render through these primitives.
 * `prPipeline`'s `UnifiedStatus` and `alertStatus`'s `AlertStatus` are both
 * structurally assignable to it.
 *
 * - `kind` — the derived status vocabulary, keys the badge palette.
 * - `label` — the user-facing plain-language status. Never a raw enum value.
 * - `reason` — brief "why / next step". May be absent.
 * - `attention` — who must act; drives the accent AND the red/amber families.
 * - `dwellEvidence` — optional, and only meaningful on a surface that has a
 *   dwell clock (see `prPipeline.DwellEvidence`). Absent elsewhere.
 */
export interface RowStatus<K extends string = string> {
  kind: K;
  label: string;
  reason?: string;
  attention: Attention;
  dwellEvidence?: DwellEvidence;
}

// ----------------------------------------------------------------------------
// The three colour families. A kind may only use the family its attention
// allows. Exported so every surface's palette is built from the SAME literals —
// a second surface picking its own red is exactly the drift this file prevents.
// ----------------------------------------------------------------------------

/** `attention: "author"` — someone must act now. */
export const AUTHOR_RED = "bg-red-500/15 text-red-200 border-red-500/35";
/** `attention: "waiting"` — waiting on something else; it will clear itself. */
export const WAITING_AMBER = "bg-amber-500/15 text-amber-200 border-amber-500/30";
/** In-flight work nobody is blocked on (CI running, a sweep in progress). */
export const CI_YELLOW = "bg-yellow-500/15 text-yellow-200 border-yellow-500/30";
/** Nothing is happening and nothing is wrong. */
export const INERT = "bg-muted text-muted-foreground border-border";
/**
 * R3's IGNORANCE FLOOR — amber's lighter sibling, for "we cannot tell you
 * whose move this is".
 *
 * Deliberately a step lighter than {@link WAITING_AMBER}, because the two say
 * different things and an operator should be able to tell them apart: amber
 * proper is a promise that something else will clear the row, while this is a
 * statement about OUR knowledge, not about the row (style guide R3, "the one
 * exception: amber also covers we do not know"). It is still amber and never
 * calm, for the reason R3 gives — painting ignorance calm is
 * `silent-empty-is-unknown` with a badge attached.
 *
 * Named here in Phase 3 Wave 2 because five surfaces had hand-spelled the same
 * literal (`planStatus`, `memoryStatus`, `pullDecisionStatus`,
 * `releaseStatus`, `verificationStatus`) and §4.1 is explicit: nothing outside
 * this file may mint a red or an amber. That rule had already been broken
 * quietly — `planStatus.blocked` spelled `border-red-500/30` where
 * `AUTHOR_RED` is `/35`, and `paletteDisagreements` cannot catch it, because
 * it tests only for the `bg-red-`/`bg-amber-` PREFIX. Tint and border drift
 * passes that audit silently, which is exactly why the constants have to be
 * imported rather than re-typed.
 */
export const UNKNOWN_AMBER = "bg-amber-500/10 text-amber-200 border-amber-500/30";

/**
 * The merge pipeline's kind→class table. Lives here (rather than in
 * MergePipeline) so it sits beside the families it is built from and beside
 * the badge that consumes it; `MergePipeline` re-exports it for its callers
 * and its tests.
 */
export const STATUS_BADGE_CLASS: Record<UnifiedStatusKind, string> = {
  // --- someone must act now → red -------------------------------------------
  conflict: AUTHOR_RED,
  "not-mergeable": AUTHOR_RED,
  requirements: AUTHOR_RED,
  "checks-failing": AUTHOR_RED,
  // --- waiting on something else → amber ------------------------------------
  blocked: WAITING_AMBER,
  "needs-rebase": WAITING_AMBER,
  // A true conflict, de-escalated because coord won't reach this PR for a
  // while: "resolve just-before-merge", not "act now".
  "conflict-deferred": WAITING_AMBER,
  // ...but only for so long. Once the deferral window lapses, coord is
  // demonstrably never reaching this PR and it goes back to red.
  "conflict-stranded": AUTHOR_RED,
  // The other two waiting promises with an expired premise: past the dwell
  // cap the wait is demonstrably not ending on its own — red.
  "needs-rebase-stale": AUTHOR_RED,
  "blocked-stale": AUTHOR_RED,
  // --- in flight / terminal, nobody is blocked → never red or amber ---------
  "awaiting-ci": CI_YELLOW,
  "checks-pending": CI_YELLOW,
  rebasing: "bg-purple-500/15 text-purple-200 border-purple-500/30",
  landing: "bg-blue-500/15 text-blue-200 border-blue-500/30",
  merged: "bg-green-500/15 text-green-200 border-green-500/30",
  ready: "bg-green-500/5 text-green-300 border-green-500/25",
  queued: INERT,
  unknown: INERT,
  draft: "bg-transparent text-muted-foreground border-border border-dashed",
};

/**
 * The merge-pipeline kinds whose badge carries the colourblind-safe `✕` glyph.
 *
 * The rule is deliberately total: EVERY kind whose `ATTENTION_BY_KIND` value
 * is `"author"` is listed — red ⇔ ✕, no hand-picked subset. The glyph is the
 * colourblind-safe marker for "the author must act", and a consistent
 * red-implies-✕ rule beats the previous curated conflict-only list (which
 * meant `checks-failing` / `requirements` rows were red with no glyph, and
 * which web#813 forgot to extend — this list is a string set TypeScript's
 * exhaustive `Record`s cannot check, so a unit test enforces the invariant
 * against `ATTENTION_BY_KIND` instead).
 */
export const AUTHOR_GLYPH_KINDS: ReadonlySet<UnifiedStatusKind> = new Set([
  "conflict",
  "not-mergeable",
  "conflict-stranded",
  "needs-rebase-stale",
  "blocked-stale",
  "checks-failing",
  "requirements",
]);

/**
 * The marker for an amber row whose dwell clock DOES NOT EXIST — the third
 * glyph, joining `✓` (done) and `✕` (someone must act). It reads "we cannot
 * say how long this has been waiting", never "this is fine" and never "this
 * is broken".
 */
const UNKNOWN_DWELL_GLYPH = "? ";

/**
 * The dashed treatment layered over the amber a `waiting` row already earns.
 * Same hue (attention has not changed), but the border no longer reads as a
 * firm measurement — the same "provisional" vocabulary `draft` already uses.
 */
const UNKNOWN_DWELL_CLASS = "border-dashed";

/**
 * Everything a surface must supply to render its own status badges: the
 * kind→class table, plus the two glyph sets. Bundling them in one object (a)
 * keeps the badge to two props and (b) gives each surface's unit test a single
 * object to audit against its kind→attention table.
 */
export interface StatusPalette<K extends string> {
  /** Kind → Tailwind class string. Total over the surface's kind union. */
  badgeClass: Readonly<Record<K, string>>;
  /** Kinds carrying the colourblind-safe `✕` (must be exactly the red ones). */
  authorGlyphKinds: ReadonlySet<K>;
  /** Kinds carrying the `✓` "this is finished" glyph. */
  doneGlyphKinds?: ReadonlySet<K>;
  /** Appended to the badge title when `dwellEvidence === "unknown"`. */
  unknownNote?: string;
}

/** Left-edge accent: red = someone must act, amber = waiting on others. */
export function rowAccentClass(status: Pick<RowStatus, "attention">): string {
  if (status.attention === "author") return "border-l-2 border-l-red-500/80";
  if (status.attention === "waiting") return "border-l-2 border-l-amber-500/80";
  return "";
}

/**
 * R4's accent as ELEMENT PROPS — the border class AND the machine-readable
 * attention, from one call.
 *
 * The colour is the operator's channel; `data-attention` is the same fact in a
 * channel a stylesheet rule, a Spec-CI selector or a `/visual-audit` assertion
 * can address. Plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 4 step 1
 * writes style rules that select `[data-attention="author"]`, and a rule with a
 * live evaluator and a dead selector reports PASS — so the attribute has to
 * exist before the rule does, which is what this function is for.
 *
 * **Returning both together is the point.** `rowAccentClass` stays exported and
 * is still correct on its own, but a caller that spreads this cannot paint the
 * accent while forgetting the attribute, or derive the two from different
 * statuses. That is the same "true by construction rather than by assertion"
 * move `claimBannerBorder` made for the claim banner.
 *
 * `extra` is merged in front of the accent so the caller's own classes and R4's
 * border arrive as one `className` and nothing has to re-join them.
 */
export function rowAccentProps(
  status: Pick<RowStatus, "attention">,
  extra?: string
): { className: string; "data-attention": Attention } {
  return {
    className: [extra, rowAccentClass(status)].filter(Boolean).join(" "),
    "data-attention": status.attention,
  };
}

/**
 * The status badge.
 *
 * It carries its own reason as a `title`, so the "why is this row like this?"
 * answer is one hover away on EVERY row — including the narrow viewports where
 * the inline reason is dropped and the wide ones where it is truncated. A
 * native title (rather than a JS tooltip) also survives in the accessibility
 * tree and needs no provider.
 */
export function StatusBadge<K extends string>({
  status,
  palette,
  className,
}: {
  status: RowStatus<K>;
  palette: StatusPalette<K>;
  className?: string;
}) {
  const { kind, label, reason, dwellEvidence } = status;
  const isUnknown = dwellEvidence === "unknown";
  const base = reason ? `${label} — ${reason}` : label;
  const note = palette.unknownNote;
  return (
    <Badge
      variant="outline"
      className={[
        "text-[11px] font-semibold whitespace-nowrap",
        palette.badgeClass[kind],
        isUnknown ? UNKNOWN_DWELL_CLASS : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-status-kind={kind}
      // Absent when the question does not arise, so a reader can tell "not
      // applicable" from "measured" from "unknown" — the whole point.
      data-dwell-evidence={dwellEvidence}
      title={isUnknown && note ? `${base} (${note})` : base}
    >
      {palette.doneGlyphKinds?.has(kind) && "✓ "}
      {palette.authorGlyphKinds.has(kind) && "✕ "}
      {isUnknown && UNKNOWN_DWELL_GLYPH}
      {label}
    </Badge>
  );
}

/**
 * Re-export: `absoluteTime` lives in `./time` beside `relativeTime`, so the
 * two formatters this file renders through sit together and neither drags a
 * dependency into the base layer. Kept exported here because callers address
 * it by this module.
 */
export { absoluteTime };

export interface RowTimeProps {
  /** The timestamp this row reports (ISO-8601), or null when absent. */
  at: string | null | undefined;
  /** Title verb — "Updated 3 Aug…", "Merged …", "Last seen …". */
  verb?: string;
  /** Inline prefix rendered before the relative time (e.g. a "merged" tag). */
  prefix?: ReactNode;
  /**
   * The EXPLICIT rendering for "this row has no time", used instead of a blank
   * or a fabricated one. Only consulted when `at` is absent; when it is null
   * the row falls back to `relativeTime`'s own "never".
   */
  absent?: { label: string; title: string } | null;
  className?: string;
}

/**
 * The right-hand timestamp, per the conventions: the semantically-right time
 * for the row's state, with an explicit rendering when it is ABSENT rather
 * than a blank — and never a raw ISO string, which is what the Alerts tab
 * printed before this module existed.
 */
export function RowTime({
  at,
  verb = "Updated",
  prefix,
  absent,
  className,
}: RowTimeProps) {
  if (!at && absent) {
    return (
      <span
        className={["text-xs text-muted-foreground/70 italic shrink-0", className ?? ""]
          .filter(Boolean)
          .join(" ")}
        title={absent.title}
        data-testid="row-time"
      >
        {absent.label}
      </span>
    );
  }
  return (
    <span
      className={[
        "text-xs text-muted-foreground tabular-nums shrink-0",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={`${verb} ${absoluteTime(at)}`}
      data-testid="row-time"
    >
      {prefix}
      {relativeTime(at)}
    </span>
  );
}
