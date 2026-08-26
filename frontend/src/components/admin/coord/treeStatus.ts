/**
 * treeStatus — pure status derivation for `coord.primary_trees` rows.
 *
 * Extracted from `TreeCard.tsx` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 1,
 * following the shape `alertStatus.ts` established: **status derivation lives
 * in a pure, unit-tested module** (R8), so the words an operator reads are
 * testable without a DOM and no page derives a status inline in JSX.
 *
 * The module carries three things:
 *
 * 1. {@link pullSafetyClass} — the client-side mirror of coord's Rust ladder,
 *    moved here verbatim. `treeStatus.test.ts` still asserts the same 6-case
 *    matrix as the Rust verdict tests.
 * 2. {@link TREE_ATTENTION_BY_KIND} — the audited verdict → attention table
 *    (R3), TOTAL over {@link TreeStatusKind}.
 * 3. {@link deriveTreeStatus} — the row status the console renders, including
 *    the ONE escalation this surface has: a dirty tree whose WIP has sat
 *    untouched for **24h or more** is somebody's problem regardless of what
 *    the pull ladder says. (It was 72h until the Wave-1 review's Ruling 1
 *    moved the 24-72h band from `waiting` to `author` — see
 *    {@link STALE_ATTENTION}.)
 *
 * ## Why the badge hue and the row accent can disagree here
 *
 * The verdict badge is keyed on the PULL VERDICT: it answers "what would coord
 * do with this tree?". The left-edge accent is keyed on the row's escalated
 * attention: it answers "must a human act?". Those are genuinely different
 * questions on this surface — an `up_to_date` tree with a day-old pile of
 * uncommitted work needs a human and needs no pull. Painting the verdict badge
 * red would be a lie about the verdict; leaving the row unaccented would be a
 * lie about the operator's inbox. So the badge reports the verdict, the accent
 * reports the attention, and the stale badges name the reason out loud.
 */

import {
  escalateAttention,
  type Attention,
} from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import {
  AUTHOR_RED,
  INERT,
} from "@/components/console/statusRow";

/** One `coord.primary_trees` row as the web proxy serves it. */
export interface PrimaryTreeRow {
  device_id?: string;
  hostname?: string;
  repo: string;
  primary_path: string;
  branch?: string | null;
  dirty?: boolean;
  last_seen?: string | null;
  wip_last_modified?: string | null;
  behind_count?: number | null;
  local_ahead?: number | null;
  head_detached?: boolean | null;
  untracked_count?: number | null;
}

/**
 * Client-side pull-safety class — a faithful mirror of the Rust ladder
 * `policies::decide::pull_safety_verdict` in
 * `qontinui-coord/src/policies/decide.rs:800` (the SOURCE OF TRUTH). Keep these
 * two in lockstep; the sibling unit test (`treeStatus.test.ts`) asserts the same
 * 6-case matrix as the Rust verdict tests to catch drift.
 *
 * Timing (Now/Defer) is server-only and deliberately NOT computed here — this
 * is the safety class only; the full timing + outcome live on the Pull
 * Decisions page.
 */
export type PullSafetyClass =
  | { kind: "up_to_date" }
  | { kind: "default_ref_sync" }
  | { kind: "hold"; reason: "wip_on_default" | "detached" }
  | { kind: "diverged" }
  | { kind: "pull" };

/**
 * The verdict vocabulary, as a flat kind union.
 *
 * `hold` stays ONE kind even though it has two reasons: the reason is carried
 * in the label ("hold: WIP" / "hold: detached"), and the authored testid
 * `coord-tree-verdict-hold` — frozen by D4a and asserted by the Spec-CI
 * derivation — is likewise one id for both.
 */
export type TreeStatusKind = PullSafetyClass["kind"];

const DEFAULT_BRANCHES = new Set(["main", "master"]);

/**
 * Mirrors `pull_safety_verdict` exactly (decide.rs:800). The 6-case order is
 * load-bearing: detached (case 2) outranks feature-branch (case 3), and
 * dirty-on-default (case 4) outranks diverged (case 5).
 */
export function pullSafetyClass(
  row: Pick<
    PrimaryTreeRow,
    "behind_count" | "head_detached" | "branch" | "dirty" | "local_ahead"
  >
): PullSafetyClass {
  // 1. behind_count <= 0 → UpToDate (nothing to pull).
  if ((row.behind_count ?? 0) <= 0) {
    return { kind: "up_to_date" };
  }
  // 2. head_detached → Hold{Detached}.
  if (row.head_detached === true) {
    return { kind: "hold", reason: "detached" };
  }
  // 3. feature branch → DefaultRefSync. A missing/empty branch is treated as a
  //    feature branch (conservative — never auto-pulls into an unknown ref),
  //    matching the Rust default where `is_default_branch=false`.
  const branch = row.branch ?? "";
  if (!DEFAULT_BRANCHES.has(branch)) {
    return { kind: "default_ref_sync" };
  }
  // On the default branch from here.
  // 4. dirty → Hold{WipOnDefault} (never auto-stash).
  if (row.dirty === true) {
    return { kind: "hold", reason: "wip_on_default" };
  }
  // 5. local_ahead > 0 → Diverged (never auto-rebase).
  if ((row.local_ahead ?? 0) > 0) {
    return { kind: "diverged" };
  }
  // 6. else → Pull (ff-only safe).
  return { kind: "pull" };
}

/**
 * The audited verdict → attention table (R3). TOTAL over
 * {@link TreeStatusKind}; `treeStatus.test.ts` audits
 * {@link TREE_BADGE_CLASS} against it.
 *
 * - `hold` and `diverged` are `author`: coord has stopped BECAUSE it needs a
 *   human — stashing WIP, resolving a detached HEAD or rebasing unpushed
 *   commits are all decisions coord refuses to make on its own.
 * - `pull`, `default_ref_sync` and `up_to_date` are calm: the next move is
 *   coord's or there is no move. A red badge on "coord will handle this" is
 *   exactly what trains an operator to stop reading red.
 */
export const TREE_ATTENTION_BY_KIND: Record<TreeStatusKind, Attention> = {
  hold: "author",
  diverged: "author",
  pull: "none",
  default_ref_sync: "none",
  up_to_date: "none",
};

/** Verdict → badge classes, built from the shared console colour families. */
export const TREE_BADGE_CLASS: Record<TreeStatusKind, string> = {
  hold: AUTHOR_RED,
  diverged: AUTHOR_RED,
  pull: "bg-green-500/15 text-green-200 border-green-500/30",
  default_ref_sync: "bg-blue-500/15 text-blue-200 border-blue-500/30",
  up_to_date: INERT,
};

/** Red ⇔ ✕: exactly the kinds whose declared attention is `author`. */
export const TREE_AUTHOR_GLYPH_KINDS: ReadonlySet<TreeStatusKind> = new Set(
  (Object.keys(TREE_ATTENTION_BY_KIND) as TreeStatusKind[]).filter(
    (k) => TREE_ATTENTION_BY_KIND[k] === "author"
  )
);

export const TREE_STATUS_PALETTE: StatusPalette<TreeStatusKind> = {
  badgeClass: TREE_BADGE_CLASS,
  authorGlyphKinds: TREE_AUTHOR_GLYPH_KINDS,
};

/** The authored testid each verdict badge carries. Frozen by D4a. */
export function verdictTestId(kind: TreeStatusKind): string {
  return `coord-tree-verdict-${kind}`;
}

/** Plain-language verdict label — unchanged from `TreeCard`'s badge text. */
function verdictLabel(cls: PullSafetyClass): string {
  switch (cls.kind) {
    case "pull":
      return "pull";
    case "default_ref_sync":
      return "ref-sync";
    case "hold":
      return cls.reason === "detached" ? "hold: detached" : "hold: WIP";
    case "diverged":
      return "diverged";
    case "up_to_date":
      return "up to date";
  }
}

/** Why the verdict is what it is — the row's `reason`, in the operator's words. */
export function verdictReason(cls: PullSafetyClass): string {
  switch (cls.kind) {
    case "pull":
      return "would auto-pull ff-only";
    case "default_ref_sync":
      return "feature branch — local default ref ff-sync";
    case "hold":
      return cls.reason === "detached"
        ? "held — detached HEAD"
        : "held — WIP on default branch";
    case "diverged":
      return "diverged — unpushed local commits, manual rebase";
    case "up_to_date":
      return "up to date with origin — nothing to pull";
  }
}

/** Hours since an ISO timestamp; `null` when absent or unparseable. */
function hoursAgo(iso?: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / 3_600_000;
}

/** The stale-WIP band a dirty tree has aged into. */
export type StaleBand = "none" | "warning" | "critical";

/**
 * Stale-WIP band, keyed off `wip_last_modified` when coord recorded one and
 * `last_seen` otherwise. Only a DIRTY tree can be stale: a clean checkout that
 * has not been seen for a week is idle, not at risk.
 */
export function staleBand(tree: PrimaryTreeRow): StaleBand {
  if (!tree.dirty) return "none";
  const h =
    hoursAgo(tree.wip_last_modified ?? null) ?? hoursAgo(tree.last_seen ?? null);
  if (h === null) return "none";
  if (h >= 72) return "critical";
  if (h >= 24) return "warning";
  return "none";
}

/**
 * A stale band's own attention — the escalation input, not a verdict.
 *
 * **Both dirty bands are `author`, and the 24h one deliberately is NOT amber.**
 * R3's amber means *waiting on something else, it will clear itself*, and
 * nothing clears untouched uncommitted work except a human — there is no
 * timeout, no retry and no other process that resolves it. Rating it `waiting`
 * was a promise the surface cannot keep.
 *
 * It also has to agree with `alertStatus.ts`, which rates the SAME condition
 * (`stale-wip`) `author` and shipped reviewed in qontinui-web#986. Two console
 * surfaces answering "who must act on idle WIP?" differently is exactly the
 * drift R3 exists to prevent, and where the failure mode is LOST WORK the tie
 * breaks toward the louder signal.
 *
 * The 24h/72h gradation survives in the badge TEXT (`stale 24h+` /
 * `stale 72h+`) and in `TreesHealth.headline`, which is where a gradation
 * belongs — the hue answers "must a human act?", which is `yes` for both.
 */
const STALE_ATTENTION: Record<StaleBand, Attention> = {
  critical: "author",
  warning: "author",
  none: "none",
};

/**
 * The row status `/trees` renders.
 *
 * `attention` is the ESCALATED value (verdict ∨ stale band), never a
 * de-escalation — see `escalateAttention`'s contract: the kind table encodes
 * what the verdict means, and the stale clock is evidence the table cannot
 * see. It may raise a row above the verdict's floor and must never lower it.
 */
export function deriveTreeStatus(tree: PrimaryTreeRow): RowStatus<TreeStatusKind> {
  const cls = pullSafetyClass(tree);
  const band = staleBand(tree);
  return {
    kind: cls.kind,
    label: verdictLabel(cls),
    reason: verdictReason(cls),
    attention: escalateAttention(
      TREE_ATTENTION_BY_KIND[cls.kind],
      STALE_ATTENTION[band]
    ),
  };
}

/** The pull-decisions cross-link a tree row offers. */
export function pullDecisionsHref(tree: PrimaryTreeRow): string {
  const repo = `repo=${encodeURIComponent(tree.repo)}`;
  return tree.device_id
    ? `/admin/coord/pull-decisions?device_id=${encodeURIComponent(
        tree.device_id
      )}&${repo}`
    : `/admin/coord/pull-decisions?${repo}`;
}

/**
 * The page's health, derived from the rows ALREADY FETCHED (R1) — never a
 * second request.
 */
export interface TreesHealth {
  level: "green" | "amber" | "red";
  headline: string;
  detail: string;
  dirty: number;
  stale: number;
  held: number;
}

export function deriveTreesHealth(trees: PrimaryTreeRow[]): TreesHealth {
  let dirty = 0;
  let stale = 0;
  let critical = 0;
  let held = 0;
  for (const t of trees) {
    if (t.dirty) dirty += 1;
    const band = staleBand(t);
    if (band !== "none") stale += 1;
    if (band === "critical") critical += 1;
    const k = pullSafetyClass(t).kind;
    if (k === "hold" || k === "diverged") held += 1;
  }
  // THE STRIP AGREES WITH THE ROWS. After Ruling 1 every band `staleBand`
  // reports is `author`, so ANY stale tree makes this a red page — `stale`, not
  // `critical`, is the red disjunct. Leaving it at `critical` would have put an
  // amber strip headlined "Every tree is safe to pull" directly above a row
  // with a red accent and a red `stale 24h+` badge, which is the contradiction
  // R3 exists to prevent, one layer up from where it usually bites.
  //
  // `dirty` is the only amber, and it is amber in the R3 sense: uncommitted
  // work under 24h needs nobody yet, and the clock is what will decide. The
  // green headline is therefore reserved for a page where it is literally
  // true.
  const level: "green" | "amber" | "red" =
    stale > 0 || held > 0 ? "red" : dirty > 0 ? "amber" : "green";
  const headline =
    critical > 0
      ? `${critical} tree${critical === 1 ? "" : "s"} holding WIP for 72h+`
      : stale > 0
        ? `${stale} tree${stale === 1 ? "" : "s"} holding WIP for 24h+`
        : held > 0
          ? `${held} tree${held === 1 ? "" : "s"} coord will not touch`
          : dirty > 0
            ? `${dirty} tree${dirty === 1 ? "" : "s"} carrying fresh uncommitted work`
            : trees.length === 0
              ? "No primary trees for this device"
              : "Every tree is safe to pull";
  return {
    level,
    headline,
    detail:
      trees.length === 0
        ? "coord has no primary-tree registration under this device_id"
        : `${dirty} dirty, ${stale} stale, ${held} held or diverged`,
    dirty,
    stale,
    held,
  };
}
