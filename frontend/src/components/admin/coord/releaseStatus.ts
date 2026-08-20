/**
 * Observed runner release → operator-facing status.
 *
 * Extracted from `ReleaseCard.tsx` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 2,
 * into the shape `alertStatus.ts` / `planStatus.ts` established: a pure
 * derivation module beside the row that renders it, carrying R3's two
 * requirements — an audited state→attention table and a palette keyed off it —
 * with `releaseStatus.test.ts` asserting the agreement through the shared
 * `paletteDisagreements`.
 *
 * The `releaseState` ladder below is UNCHANGED from `ReleaseCard`: same
 * short-circuit, same namespaced/bare sub-class handling, same fallbacks, and
 * its tests moved across verbatim. What is new is the attention table and the
 * class palette that replaces the `BadgeVariant` tones.
 *
 * ## The one hue this migration CHANGES, and why
 *
 * `unknown` rendered `secondary` — plain grey. Under R3 that is calm, and calm
 * asserts *nothing is waiting on you*, which on a release descriptor we could
 * not read is exactly what we do not know. It is now amber: R3's stated
 * ignorance exception, the same floor `attention.ts` (`attentionOf`),
 * `planStatus.ts` and `alertStatus.ts` all carry. A dark observation (GitHub
 * unreachable, token unset) is the common source of these, and painting it
 * grey read as "nothing to see here" on a row that means "we could not look".
 *
 * Every other hue is unchanged, `in_flight`'s amber included — see the table.
 */

import type { Attention } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import type { ReleaseHistoryEntry } from "@/services/runner-releases-service";

/** The surface's operational state, normalized from the drift descriptor. */
export type ReleaseState =
  | "in_sync"
  | "in_flight"
  | "stale"
  | "failed_deploy"
  | "rolled_back"
  | "unknown";

/**
 * Resolve the operational state from an entry. `in_sync` short-circuits;
 * otherwise the `release:*` sub-class (preferred, stripped of its prefix) or
 * the surface `token` names the state, with the canonical class as a last
 * fallback. Tolerant of either the namespaced or bare form.
 */
export function releaseState(entry: ReleaseHistoryEntry): ReleaseState {
  if (entry.in_sync) return "in_sync";
  const raw = (entry.drift_class?.subclass ?? entry.drift_class?.token ?? "")
    .toString()
    .replace(/^release:/, "");
  switch (raw) {
    case "in_sync":
      return "in_sync";
    case "in_flight":
      return "in_flight";
    case "stale":
      return "stale";
    case "failed_deploy":
      return "failed_deploy";
    case "rolled_back":
      return "rolled_back";
  }
  const canonical = entry.drift_class?.canonical;
  if (canonical === "none") return "in_sync";
  if (canonical === "active_negation") return "rolled_back";
  return "unknown";
}

/** Operator-facing label per state. Never the raw drift token. */
export const RELEASE_LABEL: Record<ReleaseState, string> = {
  in_sync: "in sync",
  in_flight: "in flight",
  stale: "stale",
  // The v1.0.0/v1.0.1 case: draft stuck because the Windows hard-gate failed.
  failed_deploy: "stuck draft",
  rolled_back: "rolled back",
  unknown: "unknown",
};

export function releaseDriftLabel(entry: ReleaseHistoryEntry): string {
  return RELEASE_LABEL[releaseState(entry)];
}

export const RELEASE_STATE_CLASS: Record<ReleaseState, string> = {
  in_sync: "bg-green-500/15 text-green-200 border-green-500/30",
  // Amber: the build IS the thing that clears it (see the table below).
  in_flight: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  stale: "bg-red-500/15 text-red-200 border-red-500/35",
  failed_deploy: "bg-red-500/15 text-red-200 border-red-500/35",
  rolled_back: "bg-red-500/15 text-red-200 border-red-500/35",
  // R3's ignorance floor — was `secondary` grey; see the module doc.
  unknown: "bg-amber-500/10 text-amber-200 border-amber-500/30",
};

/**
 * The audited state → attention table. TOTAL over {@link ReleaseState}, one
 * row per state with the reason it lands there:
 *
 * - `in_sync` — **`none`**. Published, assets present, nothing owed. Done.
 * - `in_flight` — **`waiting`**. The clearer has a name and a duration: the
 *   ~2h runner build. It settles to `in_sync` or to `stuck draft` on its own,
 *   which is amber's self-clearing contract satisfied literally. (This is a
 *   DIFFERENT judgement from `prPipeline`'s `awaiting-ci` → `none`, and the
 *   difference is real: a PR waiting on CI is one of forty rows in a queue
 *   nobody is watching, while a runner release in flight is the single artefact
 *   an operator came to this page to watch land. R3 asks *whose move* — here it
 *   is the build's, and the operator IS watching.)
 * - `stale` — **`author`**. A tag past its build window with nothing
 *   published. No workflow is still running and no retry is scheduled; only a
 *   human re-dispatches it.
 * - `failed_deploy` — **`author`**. A draft stuck behind a failed Windows
 *   hard-gate. This is the state the whole surface was built to expose (the
 *   v1.0.0 / v1.0.1 case was found by hand, months late) — nothing clears it
 *   but a human.
 * - `rolled_back` — **`author`**. The published installer was withdrawn, so
 *   users cannot install. Nothing republishes it; a human ships the next one.
 * - `unknown` — **`waiting`**, the ignorance floor. A descriptor this build
 *   cannot read, usually a dark observation. Only a human extending the
 *   vocabulary (or GitHub coming back) resolves it, so read literally R3's
 *   name-the-clearer test would forbid amber — and R3 states the exception,
 *   because an amber painted on ignorance is a statement about our knowledge.
 */
export const RELEASE_ATTENTION_BY_STATE: Record<ReleaseState, Attention> = {
  in_sync: "none",
  in_flight: "waiting",
  stale: "author",
  failed_deploy: "author",
  rolled_back: "author",
  unknown: "waiting",
};

/** Red ⇔ the colourblind-safe `✕`: exactly the `author` states. */
export const RELEASE_AUTHOR_GLYPH_STATES: ReadonlySet<ReleaseState> = new Set(
  (Object.keys(RELEASE_ATTENTION_BY_STATE) as ReleaseState[]).filter(
    (s) => RELEASE_ATTENTION_BY_STATE[s] === "author"
  )
);

export const RELEASE_STATUS_PALETTE: StatusPalette<ReleaseState> = {
  badgeClass: RELEASE_STATE_CLASS,
  authorGlyphKinds: RELEASE_AUTHOR_GLYPH_STATES,
  doneGlyphKinds: new Set<ReleaseState>(["in_sync"]),
};

/** `lag_seconds` → "Nm" / "Nh Nm". null/≤0 → "". */
export function lagLabel(lagSeconds: number | null | undefined): string {
  if (
    typeof lagSeconds !== "number" ||
    !Number.isFinite(lagSeconds) ||
    lagSeconds <= 0
  ) {
    return "";
  }
  const mins = Math.floor(lagSeconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remM = mins % 60;
  return remM ? `${hrs}h ${remM}m` : `${hrs}h`;
}

/**
 * The row status `/releases` renders.
 *
 * `reason` is the shortest true "why": the lag when the release is behind
 * (which is what "in flight" and "stale" both mean in practice), otherwise the
 * missing Windows hard-gate asset, otherwise the CI state.
 */
export function deriveReleaseStatus(
  entry: ReleaseHistoryEntry
): RowStatus<ReleaseState> {
  const kind = releaseState(entry);
  const lag = lagLabel(entry.lag_seconds);
  const missing: string[] = [];
  // `false` is a MEASUREMENT ("we looked, it is absent"); `null`/undefined is
  // a dark observation and must not be reported as a missing asset.
  if (entry.has_setup_exe === false) missing.push("setup.exe");
  if (entry.has_latest_json === false) missing.push("latest.json");

  const reason =
    (lag ? `${lag} behind` : "") ||
    (missing.length > 0 ? `no ${missing.join(", no ")}` : "") ||
    (entry.ci_state ? `CI ${entry.ci_state}` : "");

  return {
    kind,
    label: RELEASE_LABEL[kind],
    reason: reason || undefined,
    attention: RELEASE_ATTENTION_BY_STATE[kind],
  };
}

/** The mono identity chip: the tag, version, or published tag — in that order. */
export function releaseIdentity(entry: ReleaseHistoryEntry): string {
  return entry.tag ?? entry.version ?? entry.published_tag ?? "—";
}
