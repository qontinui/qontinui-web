/**
 * Turn a raw DriftVerdict envelope into a human-digestible summary — the prose
 * a person reads instead of the agent-facing JSON. Generic across instances
 * (works off the uniform envelope fields), with a couple of instance-specific
 * touches where the components shape is well-known.
 */

import { citationCounts } from "./delivery-citations";
import { formatRatio, formatStaleness } from "./status-presentation";
import type { DeliveryComponents, DriftVerdict } from "./types";

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

/** One short instance-specific clause when the components shape is known. */
function instanceClause(verdict: DriftVerdict): string | null {
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
      const status = comp.status;
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
        return status !== undefined && status !== null
          ? `${statusLabel} “${String(status)}”; no cited PRs found.`
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
      const statusPart =
        status !== undefined && status !== null
          ? `${statusLabel} “${String(status)}”; `
          : "";
      return `${statusPart}${counts.total} cited PR${counts.total === 1 ? "" : "s"}, ${mergeClause}.`;
    }
    default:
      return null;
  }
}

export interface VerdictSummary {
  /** A one/two-sentence plain-language reading. */
  prose: string;
  /** Compact key facts for a definition list. */
  facts: { label: string; value: string }[];
}

export function summarizeVerdict(
  subspaceId: string,
  verdict: DriftVerdict,
): VerdictSummary {
  const name = subspaceId.replace(/_/g, " ");
  const drift = driftClassPhrase(verdict.drift_class);
  const fresh = formatStaleness(verdict.staleness_seconds);
  const provenance = verdict.provenance ?? "unknown source";

  const sentences = [
    `${capitalize(name)} is ${drift}.`,
    `${trustPhrase(verdict)}; data is ${fresh}, read from ${provenance}.`,
  ];
  const extra = instanceClause(verdict);
  if (extra) sentences.push(extra);

  const facts: VerdictSummary["facts"] = [
    { label: "Drift", value: verdict.drift_class ?? "—" },
    { label: "Coverage", value: formatRatio(verdict.coverage) },
    { label: "Credibility", value: formatRatio(verdict.credibility) },
    { label: "Freshness", value: fresh },
    { label: "Source", value: provenance },
  ];
  if (verdict.d3_outcome) {
    facts.push({ label: "Effect outcome", value: verdict.d3_outcome });
  }

  return { prose: sentences.join(" "), facts };
}

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}
