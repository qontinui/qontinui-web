/**
 * Turn a raw DriftVerdict envelope into a human-digestible summary — the prose
 * a person reads instead of the agent-facing JSON. Generic across instances
 * (works off the uniform envelope fields), with a couple of instance-specific
 * touches where the components shape is well-known.
 */

import { citationCounts } from "./delivery-citations";
import {
  UNSERVED_AGE,
  WORST_BUCKET,
  datesWorstBucket,
  formatRatio,
  formatReadingAge,
  readingAge,
  type ReadingAge,
} from "./status-presentation";
import type { DeliveryComponents, DoorShape, DriftVerdict } from "./types";

/** Plain-language reading of the canonical drift_class. */
function driftClassPhrase(driftClass: string | undefined): string {
  switch (driftClass) {
    case "none":
    case "ok":
    case "in_sync":
      return "in sync — declared matches actual";
    case "pending":
    case "in_flight":
      return "a change is in flight (declared moved, actual catching up)";
    case "divergent":
      return "diverged — declared and actual disagree";
    case "in_place":
    case "in_place_change":
      return "changed in place outside the declared source";
    case "active_negation":
      return "an active negation — applying the declared state would strip live config";
    case "benign_add":
      return "a benign addition (extra live state, not a conflict)";
    case "stale":
      return "stale — the deployed artifact is behind";
    case "rolled_back":
      return "rolled back from the declared artifact";
    case "degraded":
      return "degraded — a soft SLO breach, still serving";
    case "unavailable":
      return "unavailable — a live serving element is gone";
    case "unknown":
      return "unknown — the observer could not read this for your tenant";
    default:
      return driftClass ? `classified “${driftClass}”` : "unclassified";
  }
}

/** A confidence qualifier from credibility + coverage. */
function trustPhrase(verdict: DriftVerdict): string {
  const cov = verdict.coverage;
  const cred = verdict.credibility;
  const covPct = formatRatio(cov);
  const credPct = formatRatio(cred);
  return `Coverage ${covPct}, credibility ${credPct}`;
}

/** How a summary words what coord holds. */
export interface SummaryOptions {
  /**
   * The word a work unit's status is shown as. By default coord's own text,
   * verbatim — the operator must see what coord holds. Presentation mode
   * passes a fixed vocabulary (`presentedPlanStatus`): coord's status is
   * opaque text a tenant can write anything into (`waiting-on-<client>`), so
   * an evaluator is never shown it (plan
   * `2026-10-23-console-presentation-spaces` D3.3).
   */
  readonly statusWord?: (status: string) => string;
  /**
   * The shape of the door the verdict was read from; by default coord's twin
   * door, whose answer is a DriftVerdict. An `envelope` door's answer is not
   * one: its age, when one is served, is its worst bucket's — the bucket its
   * drift class comes from — and is named so; with none served its freshness
   * is UNKNOWN, never "live" (`status-presentation.ts` `readingAge`).
   */
  readonly doorShape?: DoorShape | null;
}

/** One short instance-specific clause when the components shape is known. */
function instanceClause(
  verdict: DriftVerdict,
  { statusWord = (status) => status }: SummaryOptions
): string | null {
  const c = verdict.components;
  if (!c || typeof c !== "object") return null;
  const comp = c as Record<string, unknown>;

  switch (verdict.instance) {
    case "release": {
      const target = comp.target ?? comp.surface;
      const inSync = comp.in_sync;
      if (target !== undefined && typeof inSync === "boolean") {
        return `${String(target)} is ${inSync ? "serving the declared artifact" : "NOT serving the declared artifact"}.`;
      }
      return null;
    }
    case "schema": {
      const head = comp.alembic_head ?? comp.stamped_head;
      if (head !== undefined) return `Stamped alembic head: ${String(head)}.`;
      return null;
    }
    case "dependency": {
      const eco = comp.ecosystem ?? comp.ecosystems;
      if (eco !== undefined) return `Ecosystems observed: ${String(eco)}.`;
      return null;
    }
    case "delivery": {
      // The anchor noun is generic over plan vs work-unit (coord generalized
      // delivery off the plan vocabulary). `anchor_kind` drives the wording; we
      // never decide rendering on an opaque status value.
      const anchorKind = comp.anchor_kind;
      const noun = anchorKind === "work_unit" ? "work unit" : "plan";
      const statusLabel =
        anchorKind === "work_unit" ? "Unit status" : "Plan status";
      const status =
        comp.status === undefined || comp.status === null
          ? null
          : statusWord(String(comp.status));
      // Every citation bucket is resolved by ONE reader shared with the card
      // (`delivery-citations.ts`) — count first, list second — so the prose and
      // the per-PR badges can never disagree about which citations blocked.
      const counts = citationCounts(c as DeliveryComponents);
      // `all_merged` is coord's DELIVERY PREDICATE, not the literal "every
      // citation merged" its name suggests — a closed-never-merged citation is
      // retired rather than counted (coord plan
      // `2026-08-18-closed-unmerged-citation-pins-shipped-forever`). Rendering
      // it as the words "all merged" would state something false about a unit
      // that delivered with a dead duplicate still cited, so the retired count
      // is named separately and only the BLOCKING citations feed the "still
      // unmerged" clause.
      const delivered = comp.all_merged;
      if (counts.total === 0) {
        return status !== null
          ? `${statusLabel} “${status}”; no cited PRs found.`
          : `No cited PRs found for this ${noun}.`;
      }
      const retiredClause =
        counts.retired > 0 ? `, ${counts.retired} closed without landing` : "";
      // Below the predicate, the clause states the LITERAL breakdown. "none
      // landed" is a claim about `landed_count`, so it is only made when that
      // count says so — the predicate being absent or false is not evidence
      // that nothing landed, and asserting it there is the same class of
      // falsehood as saying "all merged" over a retired citation.
      const mergeClause =
        delivered === true
          ? counts.retired > 0
            ? `delivered${retiredClause}`
            : "all merged"
          : counts.blocking > 0
            ? `${counts.blocking} still unmerged${retiredClause}`
            : counts.landed > 0
              ? `${counts.landed} landed${retiredClause}`
              : counts.retired > 0
                ? `none landed${retiredClause}`
                : "merge state mixed";
      const statusPart = status !== null ? `${statusLabel} “${status}”; ` : "";
      return `${statusPart}${counts.total} cited PR${counts.total === 1 ? "" : "s"}, ${mergeClause}.`;
    }
    default:
      return null;
  }
}

/** One key fact of a verdict, for a definition list. */
export interface VerdictFact {
  readonly label: string;
  /** The value in words ("UNKNOWN" for one with an `unknownReason`). */
  readonly value: string;
  /**
   * Why the value is UNKNOWN, when it is: a renderer puts it on the
   * ignorance floor, never as a plain value.
   */
  readonly unknownReason?: string;
}

export interface VerdictSummary {
  /** A one/two-sentence plain-language reading. */
  prose: string;
  /** Compact key facts for a definition list. */
  facts: VerdictFact[];
}

/**
 * The sentence on the verdict's trust, freshness and source. The staleness is
 * the verdict's age when it was read, never its age now: every summary is
 * shown beside, or after, the time it was read — a cached answer, one kept
 * after a failed read, or a lookup left on screen (`formatAgeWhenRead`).
 */
function trustSentence(
  verdict: DriftVerdict,
  age: ReadingAge,
  doorShape: DoorShape | null | undefined
): string {
  const trust = trustPhrase(verdict);
  const provenance = verdict.provenance ?? "unknown source";
  if (age === null) {
    return `${trust}, from ${provenance}; ${UNSERVED_AGE}, so its freshness when read is UNKNOWN.`;
  }
  // An envelope door's age dates its worst bucket, not the whole answer.
  const whose = datesWorstBucket(age, doorShape)
    ? `its ${WORST_BUCKET}'s data`
    : "its data";
  return `${trust}; ${whose} was ${formatReadingAge(age)} when read, from ${provenance}.`;
}

export function summarizeVerdict(
  subspaceId: string,
  verdict: DriftVerdict,
  options: SummaryOptions = {}
): VerdictSummary {
  const name = subspaceId.replace(/_/g, " ");
  const drift = driftClassPhrase(verdict.drift_class);
  const age = readingAge(verdict.staleness_seconds, options.doorShape);
  const provenance = verdict.provenance ?? "unknown source";

  const sentences = [
    `${capitalize(name)} is ${drift}.`,
    trustSentence(verdict, age, options.doorShape),
  ];
  const extra = instanceClause(verdict, options);
  if (extra) sentences.push(extra);

  const facts: VerdictFact[] = [
    { label: "Drift", value: verdict.drift_class ?? "—" },
    { label: "Coverage", value: formatRatio(verdict.coverage) },
    { label: "Credibility", value: formatRatio(verdict.credibility) },
    {
      label: "Freshness when read",
      value: datesWorstBucket(age, options.doorShape)
        ? `${formatReadingAge(age)} (${WORST_BUCKET})`
        : formatReadingAge(age),
      ...(age === null ? { unknownReason: UNSERVED_AGE } : {}),
    },
    // "Data source", not "Source": beside a provenance chip, whose own
    // "source:" names who read it, one label names one thing.
    { label: "Data source", value: provenance },
  ];
  if (verdict.d3_outcome) {
    facts.push({ label: "Effect outcome", value: verdict.d3_outcome });
  }

  return { prose: sentences.join(" "), facts };
}

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}
