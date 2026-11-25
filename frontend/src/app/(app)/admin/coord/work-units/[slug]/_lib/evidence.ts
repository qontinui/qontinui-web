/**
 * The work-unit page's "Evidence" panel, as pure functions.
 *
 * Plan `2026-11-25-overview-timeline-and-milestones-derive-from-coord`
 * Phase 6. The Project Overview calls a phase done only on delivery evidence
 * coord holds: a landed PR citation (`phases_delivered`) or a phase
 * attestation (`phases_attested`). A person could read both but could not
 * enter either, so this panel is the person's door for them.
 *
 * Nothing here defaults. A read that did not answer is `null`, never an empty
 * list, and an attestation coord serves without who/when (an older coord) says
 * so instead of inventing a date.
 */

import type {
  AttestationDetail,
  AttestationRow,
  CitationRow,
  DeliveryView,
} from "@/lib/api/operations/coordPlans";

export type {
  AttestationDetail,
  AttestationRow,
  CitationRow,
  DeliveryView,
};

/** An attestation row joined with its who/when, when coord served them. */
export interface AttestationView extends AttestationRow {
  attested_at: string | null;
  attested_by: string | null;
  /** True when coord served `phases_attested_detail` for this row. */
  detailKnown: boolean;
}

/**
 * Join `phase_attestations` with `phases_attested_detail`. Both come from the
 * same rows in the same order, so the join is by position and double-checked
 * on `(phase_index, evidence_kind)`; a mismatch leaves the row's detail
 * unknown rather than pairing it with the wrong person.
 */
export function attestationViews(
  delivery: DeliveryView | null | undefined
): AttestationView[] {
  const rows = delivery?.phase_attestations ?? [];
  const detail = delivery?.phases_attested_detail;
  return rows.map((r, i) => {
    const d = detail?.[i];
    const matches =
      !!d &&
      d.phase_index === r.phase_index &&
      d.evidence_kind === r.evidence_kind;
    return {
      ...r,
      attested_at: matches ? (d.attested_at ?? null) : null,
      attested_by: matches ? (d.attested_by ?? null) : null,
      detailKnown: matches,
    };
  });
}

export function describeResolution(resolution: string): string {
  switch (resolution) {
    case "resolved":
      return "In effect";
    case "retracted":
      return "Retracted";
    case "vanished":
      return "Evidence gone";
    case "unreadable":
      return "Could not be checked";
    default:
      return resolution;
  }
}

export type PhaseEvidenceState = "delivered" | "attested" | "not_confirmed";

/** How coord's delivery evidence reads for one declared phase. */
export function phaseEvidenceState(
  delivery: DeliveryView | null | undefined,
  index: number
): PhaseEvidenceState {
  if (delivery?.phases_delivered?.includes(index)) return "delivered";
  if (delivery?.phases_attested?.includes(index)) return "attested";
  return "not_confirmed";
}

export function describePhaseEvidence(state: PhaseEvidenceState): string {
  switch (state) {
    case "delivered":
      return "Delivered by a landed PR";
    case "attested":
      return "Attested done";
    case "not_confirmed":
      return "Not confirmed";
  }
}

/** Only citations recorded by hand can be retracted here. */
export function isManualCitation(c: CitationRow): boolean {
  const s = c.sources;
  if (Array.isArray(s)) return s.includes("manual_backfill");
  return typeof s === "string" && s.split(/[\s,]+/).includes("manual_backfill");
}

export function describeCitation(c: CitationRow): string {
  if (c.merged === true) return "Landed";
  if (c.closed_unmerged === true) return "Closed without landing";
  if (c.observed === false) return "Not yet observed by coord";
  if (c.merged === false) return "Not landed";
  return "State unknown";
}

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export interface AttestDraft {
  phase: string;
  kind: "finding" | "prompt_document";
  ref: string;
  minVersion: string;
  note: string;
}

export const EMPTY_ATTEST: AttestDraft = {
  phase: "",
  kind: "finding",
  ref: "",
  minVersion: "",
  note: "",
};

export function validateAttest(d: AttestDraft): string[] {
  const out: string[] = [];
  if (!/^\d+$/.test(d.phase.trim())) out.push("Choose the phase to attest.");
  if (!/^[0-9a-fA-F-]{32,40}$/.test(d.ref.trim())) {
    out.push(
      d.kind === "finding"
        ? "The finding id must be a UUID."
        : "The prompt document id must be a UUID."
    );
  }
  if (d.minVersion.trim()) {
    if (d.kind !== "prompt_document") {
      out.push("A version floor applies to a prompt document only.");
    } else if (!/^\d+$/.test(d.minVersion.trim())) {
      out.push("The version floor must be a whole number.");
    }
  }
  return out;
}

/** The `POST /plans/{slug}/phase-attestations` body for a valid draft. */
export function buildAttestRequest(d: AttestDraft) {
  return {
    phase_index: Number(d.phase.trim()),
    evidence_kind: d.kind,
    evidence_ref: d.ref.trim(),
    ...(d.minVersion.trim()
      ? { evidence_min_version: Number(d.minVersion.trim()) }
      : {}),
    ...(d.note.trim() ? { note: d.note.trim() } : {}),
  };
}

export function validateCitation(repo: string, pr: string): string[] {
  const out: string[] = [];
  if (!REPO_RE.test(repo.trim())) out.push("The repository must be owner/name.");
  if (!/^[1-9]\d*$/.test(pr.trim())) {
    out.push("The PR number must be a positive whole number.");
  }
  return out;
}
