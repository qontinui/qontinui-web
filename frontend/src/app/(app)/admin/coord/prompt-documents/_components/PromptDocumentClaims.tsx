"use client";

import { CloudOff, Info } from "lucide-react";
import { absoluteTime, relativeTime } from "@/components/console";
import type {
  PromptDocument,
  PromptDocumentClaim,
  PromptDocumentClaimState,
} from "../types";
import { isPromptDocumentClaimState } from "../types";

/** The slice of the get-one envelope this panel reads. `Pick`ed so a caller
 *  cannot hand it a value it derived itself — every field here is SERVED. */
export type PromptDocumentClaimsEnvelope = Pick<
  PromptDocument,
  | "claims"
  | "claims_probed"
  | "claims_malformed"
  | "claims_observed_at"
  | "claims_state_source"
>;

interface PromptDocumentClaimsProps {
  document: PromptDocumentClaimsEnvelope;
  /** Clock in epoch ms, for deterministic relative times under test. */
  now?: number;
}

/**
 * The three badge styles, one per claim state — the attention families of the
 * console style guide (R3, "colour encodes who must act"):
 *
 * - `contradicted` is RED. The world disagrees with the document and nothing
 *   clears that by itself: someone has to decide whether the document or the
 *   probe is the stale one (plan D3 refuses to decide that by fiat).
 * - `unknown` is the AMBER IGNORANCE FLOOR — "we cannot tell you whether this
 *   claim holds". Never calm: painting an unobserved claim green is
 *   `silent-empty-is-unknown` with a badge attached.
 * - `confirmed` is CALM green. Nothing is waiting on anyone.
 *
 * Light-and-dark variants follow the sibling badges on `PromptDocumentList`
 * rather than the dark-only `statusRow` constants, because this dialog renders
 * in both themes; the FAMILY per state is the contract, the literal is not.
 */
const STATE_BADGE: Record<
  PromptDocumentClaimState,
  { label: string; className: string; title: string }
> = {
  confirmed: {
    label: "Confirmed",
    className:
      "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400",
    title:
      "The observer's last resolution matched what the probe block expects.",
  },
  contradicted: {
    label: "Contradicted",
    className:
      "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
    title:
      "The observer resolved this anchor to something other than what the document claims. Either the document is stale or the probe is — deciding which is a content judgement, so nothing here edits the document.",
  },
  unknown: {
    label: "Unknown",
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    title:
      "Coord could not say whether this claim holds: never observed, observed too long ago, an unresolvable anchor, or a malformed block. Resolution failure is never a contradiction and never a confirmation.",
  },
};

/** Keys rendered first, by name, because they are the ones the read contract
 *  promises (`reason` for a never-observed or malformed claim, `stale` when the
 *  staleness budget was applied). Everything else follows as `key=value`. */
const DETAIL_FIRST: readonly string[] = ["reason", "stale"];

function compactValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }
  try {
    const json = JSON.stringify(value);
    return json.length > 80 ? `${json.slice(0, 77)}…` : json;
  } catch {
    return "[unrenderable]";
  }
}

/** `reason=never_observed · stale=true · …`, or `—` when there is nothing. */
export function compactDetail(detail: Record<string, unknown>): string {
  const keys = Object.keys(detail);
  if (keys.length === 0) return "—";
  const ordered = [
    ...DETAIL_FIRST.filter((k) => k in detail),
    ...keys.filter((k) => !DETAIL_FIRST.includes(k)).sort(),
  ];
  return ordered.map((k) => `${k}=${compactValue(detail[k])}`).join(" · ");
}

function ClaimStateBadge({ state }: { state: PromptDocumentClaim["state"] }) {
  // A state this build does not know is UNKNOWN by the same floor: the badge
  // shows the served spelling so the operator can see the vocabulary moved,
  // but takes the amber style and never the green one.
  const known = isPromptDocumentClaimState(state);
  const meta = STATE_BADGE[known ? state : "unknown"];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${meta.className}`}
      title={known ? meta.title : `Unrecognised claim state "${state}" — treated as unknown.`}
      aria-label={`claim state: ${known ? state : `unknown (served as ${state})`}`}
      data-state={known ? state : "unknown"}
    >
      {known ? meta.label : `Unknown (${state})`}
    </span>
  );
}

function Stamp({
  label,
  iso,
  now,
}: {
  label: string;
  iso: string | null;
  now?: number;
}) {
  return (
    <span title={iso ? absoluteTime(iso) : undefined}>
      {label} {relativeTime(iso, { absent: "never", now })}
    </span>
  );
}

/**
 * The per-claim probe state for one fetched prompt document (plan
 * `2026-09-06-domain-spec-divergences-decay-with-no-re-probe`, D2 + D3): a
 * header that says whether the sweep is alive, and one row per probe block.
 *
 * Three degenerate renders, each its own sentence rather than an empty list,
 * because they are not the same claim:
 *
 * 1. The envelope fields are ABSENT — a coord predating the probe grammar.
 *    Rendered as "not served by this coord build". UNKNOWN, never zero.
 * 2. `claims_probed === 0` — coord parsed the body and found no probe block.
 *    This is the plan's detection-gap count: a document with nothing probeable
 *    in it. A confident zero, and the only one of the three that is.
 * 3. `claims_state_source !== "table"` — coord could not read its own table
 *    (missing relation during the deploy-ordering window, or a read error), so
 *    every claim it serves is UNKNOWN. The source is named so the operator can
 *    tell "the migration has not landed here" from "the sweep found nothing".
 *
 * Reads only what coord served. Nothing here parses the body for probe blocks
 * or decides staleness — both are coord's, and re-deriving them in a browser
 * would let this panel disagree with what agents read over the same route.
 */
export function PromptDocumentClaims({
  document,
  now,
}: PromptDocumentClaimsProps) {
  const served =
    document.claims !== undefined ||
    document.claims_probed !== undefined ||
    document.claims_state_source !== undefined;

  if (!served) {
    return (
      <section
        className="space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2"
        data-testid="doc-claims"
      >
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Probed claims
        </h3>
        <div
          className="flex items-start gap-2"
          data-testid="doc-claims-not-served"
        >
          <CloudOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Claims: not served by this coord build. This coord answered without
            a probe envelope, so whether this document carries probe blocks —
            and whether any of them still hold — is unknown. That is not the
            same as the document having none.
          </p>
        </div>
      </section>
    );
  }

  const probed = document.claims_probed;
  const malformed = document.claims_malformed ?? 0;
  const source = document.claims_state_source;
  const claims = document.claims ?? [];

  return (
    <section
      className="space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2"
      data-testid="doc-claims"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Probed claims
        </h3>
        <p
          className="text-xs text-muted-foreground"
          data-testid="doc-claims-header"
        >
          Claims probed: {probed ?? "–"} · newest observation{" "}
          <span
            title={
              document.claims_observed_at
                ? absoluteTime(document.claims_observed_at)
                : undefined
            }
          >
            {relativeTime(document.claims_observed_at ?? null, {
              absent: "never",
              now,
            })}
          </span>{" "}
          · source <code>{source ?? "unknown"}</code>
          {malformed > 0 ? (
            <>
              {" "}
              · {malformed} malformed block{malformed === 1 ? "" : "s"}{" "}
              skipped
            </>
          ) : null}
        </p>
      </div>

      {source !== undefined && source !== "table" ? (
        <div
          className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-2"
          data-testid={`doc-claims-source-${source}`}
        >
          <Info className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            {source === "table_absent" ? (
              <>
                Coord could not find its claim-state table (
                <code>table_absent</code>) — the migration that creates it has
                not been applied where this coord reads. Every claim below is
                served as unknown until it is.
              </>
            ) : source === "read_failed" ? (
              <>
                Coord&apos;s read of its claim-state table failed (
                <code>read_failed</code>). Every claim below is served as
                unknown; the last persisted states, if any, could not be seen.
              </>
            ) : (
              <>
                Coord served claim states from an unrecognised source (
                <code>{source}</code>). Treat every state below as unknown.
              </>
            )}
          </p>
        </div>
      ) : null}

      {probed === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="doc-claims-none">
          No probe blocks in this document — nothing here is machine-checkable,
          so the sweep has nothing to confirm or contradict.
        </p>
      ) : claims.length === 0 ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="doc-claims-empty-list"
        >
          Coord counted {probed ?? "an unknown number of"} probe block
          {probed === 1 ? "" : "s"} but served no claim rows — the list is
          unknown, not empty.
        </p>
      ) : (
        <ul className="space-y-1.5" data-testid="doc-claims-list">
          {claims.map((claim) => (
            <li
              key={claim.claim_id}
              className="rounded border border-border bg-card px-2.5 py-1.5"
              data-testid={`doc-claim-${claim.claim_id}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-xs font-medium">{claim.claim_id}</code>
                <span data-testid={`doc-claim-state-${claim.claim_id}`}>
                  <ClaimStateBadge state={claim.state} />
                </span>
                {claim.anchor_type ? (
                  <span
                    className="inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                    title="The probe's anchor type — which resolver the observer ran."
                  >
                    {claim.anchor_type}
                  </span>
                ) : (
                  <span
                    className="text-[10px] uppercase tracking-wide text-muted-foreground"
                    title="The block's anchor could not be parsed, so no resolver ran."
                  >
                    no anchor
                  </span>
                )}
              </div>
              <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                <Stamp label="observed" iso={claim.observed_at} now={now} />
                <Stamp label="verified" iso={claim.verified_at} now={now} />
                <span>
                  against{" "}
                  {claim.verified_against ? (
                    <code>{claim.verified_against}</code>
                  ) : (
                    "—"
                  )}
                </span>
              </p>
              <p
                className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground"
                data-testid={`doc-claim-detail-${claim.claim_id}`}
              >
                {compactDetail(claim.detail ?? {})}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
