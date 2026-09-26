/**
 * The system-tenant list's auto-publish badge — read entirely off the fields
 * coord's status route serves, and derived from nothing.
 *
 * Plan `2026-09-19-policy-publish-all-and-auto-publish` D4:
 *
 * > **The document list** in the system tenant shows a badge on each candidate:
 * > "publishes automatically at <time> (<24 h | 6 h>)" or "held: <token>".
 *
 * ## Why nothing here computes a settle time
 *
 * The clock is not a function of anything a browser holds. It starts at the
 * `created_at` of the newest version whose BODY differs from its predecessor's
 * — which requires reading every version's body since the last publication, and
 * deliberately excludes the metadata-only version a `publish_mode` PATCH cuts.
 * The wait then depends on a direction classified against the last publication's
 * body, or against a compiled seed when there has never been one. A console
 * that recomputed either would drift from the worker the badge is describing,
 * and the failure would be silent: a badge promising a publication at a time
 * nothing publishes at, or promising one for a document the worker is holding.
 *
 * So this module reads coord's answer and formats it. It compares no bodies and
 * adds no hours to any timestamp.
 *
 * ## The states worth a badge, and the ones that are not
 *
 * | Served | Badge | Why |
 * |---|---|---|
 * | `held === true` with tokens | `Held: <token>` | The actionable state: a new fleet-specific token is stopping a publication that would otherwise go out. |
 * | `held === true`, no tokens named | `Held` | Coord is holding it and did not say on what. Still a fact, and still worth the attention tone. |
 * | a parseable `settles_at` | `Publishes <time> (24 h)` | What is about to happen, and how long the operator has to stop it. |
 * | anything else | none | See below. |
 *
 * **A candidate with no `settles_at` and no hold gets no badge.** That is the
 * ordinary state of a `manual` or `never` document, and of an `auto` document
 * whose edits have not settled into a pending publication yet. A badge saying
 * "nothing scheduled" on most of the corpus is the clutter that makes the two
 * badges that matter harder to see — the same judgement `upstreamBadge` makes
 * about a clean, current document.
 *
 * **An unparseable `settles_at` gets no badge either.** A raw ISO string that
 * `Date` cannot read renders as a time nobody can act on, and a badge whose
 * time is wrong is worse than no badge: it is a schedule the operator would
 * plan around.
 *
 * **Only a document the worker will actually publish gets a badge.** Coord
 * computes `settles_at` and `held` for EVERY candidate, whatever its
 * `publish_mode` — the same candidate set feeds publish-all, which can publish a
 * `manual` document by hand. So a served settle time is not a promise: on a
 * `manual` document, or an undecided one whose `undecided_default` is `manual`,
 * nothing publishes at that time, and a hold is holding nothing. Those rows get
 * no badge. A mode this build cannot read (neither field served) falls through
 * to the served facts rather than guessing either way.
 *
 * **While the D5 switch is off the worker publishes nothing and holds
 * nothing**, but coord still reports what it WOULD do. Those rows get one muted
 * `Auto-publish off` badge instead — the schedule is still worth seeing (it is
 * what happens the moment the switch goes back on), but not under a label that
 * says it is about to happen. `publishingEnabled` is coord's own resolved
 * answer from the status read; `undefined` (a coord that does not serve it) is
 * UNKNOWN and keeps the served badge.
 *
 * **A direction this build predates renders as ITSELF.** The wait label is the
 * only place the 24 h / 6 h split is visible, and coord may add a class in a
 * release this console does not know. Showing the raw string beats showing
 * nothing, and beats guessing 6 h — which is the answer that would let a
 * loosening look like a routine change.
 */

import type { AutoPublishStatusEntry } from "../types";

/** How prominently the badge should read. */
export type AutoPublishBadgeTone = "attention" | "muted";

export interface AutoPublishBadge {
  /** Short label for the badge itself. */
  label: string;
  /** The `title=` explanation — one sentence, no jargon. */
  title: string;
  tone: AutoPublishBadgeTone;
  /** Stable suffix for the row's `data-testid`. */
  testId: "held" | "settles" | "paused";
}

/**
 * The wait coord's direction class implies, as the plan spells it: 24 hours for
 * a loosening, 6 hours for any other change.
 *
 * A LABEL, not an arithmetic input — nothing here adds it to a timestamp. It
 * exists so the badge can say which of the two branches the document is on,
 * which is the one fact `settles_at` alone does not carry.
 */
export function waitLabel(direction: string | null | undefined): string | null {
  if (direction === "loosening") return "24 h";
  if (direction === "other") return "6 h";
  // A class this build predates. Naming it beats guessing the shorter wait,
  // which is the guess that would make a loosening read as routine.
  return direction ? direction : null;
}

function formatWhen(iso: string): string | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

/**
 * The badge for one row, or `null` when there is nothing honest to say.
 *
 * Takes the status entry rather than four arguments so the call site cannot
 * accidentally pass a value it computed itself — the same shape, and the same
 * reason, as `upstreamBadge`.
 */
export function autoPublishBadge(
  entry: AutoPublishStatusEntry | undefined,
  publishingEnabled?: boolean
): AutoPublishBadge | null {
  if (!entry) return null;

  // The mode the NEXT worker pass acts on: the recorded one, or for an
  // undecided document the one that pass will record.
  const effectiveMode = entry.publish_mode ?? entry.undecided_default ?? null;
  if (effectiveMode !== null && effectiveMode !== "auto") return null;
  const undecided = entry.publish_mode == null && effectiveMode === "auto";
  const whenDecided = undecided
    ? " It is undecided today; the next worker pass sets it to auto, which is what makes this schedule real."
    : "";

  if (publishingEnabled === false) {
    const settle = entry.settles_at ? formatWhen(entry.settles_at) : null;
    if (entry.held !== true && settle === null) return null;
    return {
      label: "Auto-publish off",
      title:
        "Automatic publishing is switched off for this tenant, so nothing publishes itself. " +
        (entry.held === true
          ? "When it is switched back on, this document would be held by a new fleet-specific token."
          : `When it is switched back on, this document would publish at ${settle}.`) +
        // No `whenDecided` here: with the switch off the worker decides no
        // modes either (D5), so "the next pass sets it to auto" would be false.
        " Publish all changed and the per-document Publish button still work.",
      tone: "muted",
      testId: "paused",
    };
  }

  // A hold outranks a schedule: coord holds INSTEAD of publishing, so a badge
  // showing both a hold and a settle time would name a publication that is not
  // going to happen at that time.
  if (entry.held === true) {
    const tokens = (entry.held_tokens ?? []).map((hit) => hit.token);
    return {
      label: tokens.length > 0 ? `Held: ${tokens[0]}` : "Held",
      title:
        tokens.length > 0
          ? `Automatic publishing is held: this body carries ${
              tokens.length === 1 ? "a token" : "tokens"
            } (${tokens.join(
              ", "
            )}) that the last publication did not. Nothing is published while a hold stands. It clears when a later edit removes the token, when you publish the document by hand, or when you set it to manual or never.${whenDecided}`
          : `Automatic publishing is held for this document. Nothing is published while a hold stands.${whenDecided}`,
      tone: "attention",
      testId: "held",
    };
  }

  const when = entry.settles_at ? formatWhen(entry.settles_at) : null;
  if (when === null) return null;

  const wait = waitLabel(entry.direction);
  return {
    label: wait ? `Publishes ${when} (${wait})` : `Publishes ${when}`,
    title: wait
      ? `This document's edits have settled into a pending publication: it publishes itself to the fleet at ${when}, ${wait} after the last body change. Editing it again restarts that wait, and setting it to manual or never stops it.${whenDecided}`
      : `This document publishes itself to the fleet at ${when}. Editing it again restarts the wait, and setting it to manual or never stops it.${whenDecided}`,
    tone: "muted",
    testId: "settles",
  };
}

/** Index a status response by `kind/name` so a row can look itself up in O(1). */
export function autoPublishStatusByDocument(
  entries: readonly AutoPublishStatusEntry[]
): Map<string, AutoPublishStatusEntry> {
  const map = new Map<string, AutoPublishStatusEntry>();
  for (const entry of entries) map.set(`${entry.kind}/${entry.name}`, entry);
  return map;
}
