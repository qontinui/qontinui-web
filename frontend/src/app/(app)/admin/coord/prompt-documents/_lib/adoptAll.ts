/**
 * "Adopt all updates" — when it is offered, which documents it offers, the run
 * that adopts them, what each row's outcome means, and the re-read that checks
 * the run against coord afterwards.
 *
 * A client loop over the existing per-document door
 * (`POST …/{kind}/{name}/upstream-adopt`), not a batch route. Each adopt is
 * one transaction in coord with its own concurrency check, so a loop of them
 * is exactly as safe as clicking each row's Adopt in turn.
 *
 * ## What the pins guarantee, and what they do not
 *
 * Every adopt is pinned to the PREVIEW: `publication_version` is the row's
 * `latest_publication_version` and `expected_version` its `current_version`,
 * both read once when the dialog opened and never looked up again.
 *
 * - **A document edited after the preview is refused**, with coord's
 *   `document_moved`, instead of being overwritten unseen.
 * - **A newer publication released mid-run is NOT detected.** Coord's adopt
 *   checks only that the pinned publication exists; it does not require it to
 *   be the latest. The run adopts the version the operator was shown, and the
 *   row's badge offers the newer one afterwards.
 *
 * ## When it is offered at all
 *
 * Only in a tenant coord has said is not positively the system tenant
 * ({@link coordSaidNotSystemTenant}), for the project the answer was read in.
 * The publishing tenant's own documents read `update_available` with no
 * tracked publication, so there the button would offer to replace every
 * policy edited since it was published with the older published body.
 * Nothing on the prompt-document wire says which tenant is the system one;
 * the publish-all surface's own refusal is the answer, and until it arrives
 * the control is not offered. Per-row Adopt is unaffected.
 *
 * ## Sequential, on purpose
 *
 * One at a time, never `Promise.all`: each row's outcome appears as it lands,
 * and the run can be stopped between documents.
 *
 * ## "Refused" is a claim about who said no
 *
 * Coord commits an adopt before it answers. A gateway timeout, a dropped
 * connection or an unreadable 2xx can therefore follow a commit, and none of
 * them says whether it did: those are `unconfirmed`. A row is `refused` only on
 * a 4xx, and says whether the refusal is in coord's own words — when the body
 * carries coord's answer ({@link coordAnswered}) — or not. "Not in coord's
 * words" is not "never reached coord": the web backend refuses on its own (an
 * expired session, a tenant-admin check, a route this deployment does not
 * proxy), and so does coord's adopt route itself on a malformed body, with
 * axum's plain-text rejection. Either way nothing was adopted. The post-run re-read ({@link reconcileRow}) then reports what
 * coord's list shows for each such row, which is the only thing that can
 * settle it.
 *
 * ## What this module never does
 *
 * It never computes `local_modified` or `update_available`. It reads coord's
 * values and groups rows by them for display ({@link adoptEffectOf}); where a
 * document tracks no publication, coord's `local_modified: true` is its
 * "cannot tell" answer (see `upstreamStatus.ts`), and the row says exactly
 * that rather than calling it an observed edit.
 */

import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import type {
  UpstreamDecisionOutcome,
  UpstreamDecisionRefusal,
} from "../_hooks/usePromptDocumentPublications";
import type {
  PromptDocumentKind,
  PromptDocumentSummary,
  UpstreamDecisionResponse,
} from "../types";

/** One row of the preview: the summary fields the run pins and the dialog shows. */
export type AdoptAllCandidate = Pick<
  PromptDocumentSummary,
  | "kind"
  | "name"
  | "description"
  | "current_version"
  | "latest_publication_version"
  | "upstream_publication_version"
  | "local_modified"
  | "update_available"
>;

/** `kind/name` — the key every map and checkbox in the dialog is keyed on. */
export function addressOf(c: { kind: string; name: string }): string {
  return `${c.kind}/${c.name}`;
}

/** A JSON object, from a string that holds one or an object itself; else `null`. */
function objectOf(value: unknown): Record<string, unknown> | null {
  let obj: unknown = value;
  if (typeof value === "string") {
    try {
      obj = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return obj !== null && typeof obj === "object" && !Array.isArray(obj)
    ? (obj as Record<string, unknown>)
    : null;
}

/**
 * The `error` codes a rejected request's body carries: its own top-level one,
 * and the one RELAYED one level deep. The web backend relays coord's text as a
 * string `detail`, and its error handler reports that string under `message`
 * beside a generic `error` (`FORBIDDEN`, `CONFLICT`…), so coord's answer sits
 * inside `message` / `detail`, as a JSON string or an object. The backend's
 * OWN refusals carry prose there, which relays nothing.
 */
export function answerCodesOf(detail: string): {
  top: string | null;
  relayed: string | null;
} {
  const body = objectOf(httpBodyOf(new Error(detail)) ?? "");
  if (!body) return { top: null, relayed: null };
  const top = typeof body.error === "string" ? body.error : null;
  for (const key of ["message", "detail"]) {
    const inner = objectOf(body[key]);
    if (inner && typeof inner.error === "string") {
      return { top, relayed: inner.error };
    }
  }
  return { top, relayed: null };
}

/** Coord's own machine codes on the adopt door, recognised at the top level too. */
const COORD_ADOPT_CODES = new Set([
  "document_moved",
  "already_current",
  "schema_migration_pending",
]);

/**
 * Whether a 4xx body is COORD's answer rather than the web backend's: coord's
 * body relayed one level deep (its legacy bodies carry prose under `error`,
 * so any relayed `error` counts), or one of coord's own machine codes at the
 * top level.
 */
export function coordAnswered(detail: string): boolean {
  const { top, relayed } = answerCodesOf(detail);
  return relayed !== null || (top !== null && COORD_ADOPT_CODES.has(top));
}

/**
 * Whether `err` is coord answering that the project the request was made in
 * is not positively the system tenant: status 403 (read by the console's
 * anchored parser, never the body) AND coord's `not_system_tenant` code, at
 * the top level or relayed one level deep.
 *
 * "Not positively": coord gives the same answer when no tenant at all is
 * marked `is_system`. That is still the safe reading for adopt-all — it
 * offers itself only where this tenant is not the publisher — but it is not
 * a positive identification of anything.
 */
export function isNotSystemTenantAnswer(err: unknown): boolean {
  if (httpStatusOf(err) !== 403) return false;
  const text = err instanceof Error ? err.message : String(err);
  const { top, relayed } = answerCodesOf(text);
  return top === "not_system_tenant" || relayed === "not_system_tenant";
}

/**
 * Whether a refusal LATCHED by the publish-all surface is that answer, for
 * `tenant`.
 *
 * Strict on purpose, because a wrong `true` offers a bulk revert of the
 * publisher's own policies. The latch must be stamped with the project its
 * request was PINNED to, and that project must be `tenant`: a refusal another
 * tab's project earned must not read as this one's. A project pin is sent as
 * the active-tenant header on every attempt, so its answer is that project's.
 * A `null` pin has no header: it is not retried, but a replay after a token
 * refresh still re-reads the stored project, so a `null` stamp is weaker —
 * the caller counts it only where `null` is the page's project and no
 * provider can reconcile it. An unstamped latch is no answer. Anything
 * else — no answer yet, the system tenant (whose read succeeds), a 404 from a
 * proxy that does not carry the route, a 500 — is not this answer either.
 */
export function coordSaidNotSystemTenant(
  unavailable: {
    refusal: string;
    detail: string;
    tenant?: string | null;
  } | null,
  tenant: string | null
): boolean {
  if (!unavailable || unavailable.refusal !== "not_system_tenant") {
    return false;
  }
  if (unavailable.tenant === undefined || unavailable.tenant !== tenant) {
    return false;
  }
  return isNotSystemTenantAnswer(new Error(unavailable.detail));
}

/**
 * Every document coord says has an update, of ANY kind — not only `policy`.
 *
 * Reads `update_available === true` and nothing else: absent is UNKNOWN and is
 * not offered, for the same reason the row's badge does not render on it.
 */
export function adoptAllCandidates(
  documents: readonly PromptDocumentSummary[]
): AdoptAllCandidate[] {
  return documents
    .filter((d) => d.update_available === true)
    .map((d) => ({
      kind: d.kind,
      name: d.name,
      description: d.description,
      current_version: d.current_version,
      latest_publication_version: d.latest_publication_version ?? null,
      upstream_publication_version: d.upstream_publication_version ?? null,
      local_modified: d.local_modified,
      update_available: d.update_available,
    }));
}

/**
 * The publication version to pin, or `null` when coord served an update flag
 * without saying WHICH publication it is. Such a row cannot be adopted here —
 * "the latest" would be a guess made at click time, which is what pinning
 * exists to forbid.
 */
export function pinnedPublicationVersion(c: AdoptAllCandidate): number | null {
  const v = c.latest_publication_version;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null;
}

/**
 * How the dialog GROUPS a row, read off coord's fields. A display category,
 * not a replacement for them: the row also states coord's `local_modified`.
 *
 * | Served | Group |
 * |---|---|
 * | `upstream_publication_version === null` | `never_adopted` — coord's `local_modified` is then its "cannot tell" answer, not an observation |
 * | tracked, `local_modified === true` | `overwrites_local_edits` |
 * | tracked, `local_modified === false` | `clean` |
 * | tracked, `local_modified` absent | `unknown` |
 */
export type AdoptEffect =
  | "never_adopted"
  | "overwrites_local_edits"
  | "clean"
  | "unknown";

export function adoptEffectOf(c: AdoptAllCandidate): AdoptEffect {
  if (c.upstream_publication_version === null) return "never_adopted";
  if (c.local_modified === true) return "overwrites_local_edits";
  if (c.local_modified === false) return "clean";
  return "unknown";
}

/** The warning box's counts, over the rows that CAN be adopted. */
export interface AdoptEffectCounts {
  overwrites: number;
  unknown: number;
  neverAdopted: number;
}

export function adoptEffectCounts(
  candidates: readonly AdoptAllCandidate[]
): AdoptEffectCounts {
  const counts: AdoptEffectCounts = {
    overwrites: 0,
    unknown: 0,
    neverAdopted: 0,
  };
  for (const c of candidates) {
    if (pinnedPublicationVersion(c) === null) continue;
    const effect = adoptEffectOf(c);
    if (effect === "overwrites_local_edits") counts.overwrites += 1;
    else if (effect === "unknown") counts.unknown += 1;
    else if (effect === "never_adopted") counts.neverAdopted += 1;
  }
  return counts;
}

/** Why a run stopped sending. */
export type AbortReason = "stopped" | "tenant_changed";

/** Why a row was not sent. */
export type NotAttemptedReason = AbortReason | "no_publication_version";

/** One row's outcome, as the dialog renders it. */
export type AdoptRowOutcome =
  /** Coord adopted it and named the version it landed as. */
  | { state: "adopted"; toVersion: number }
  /**
   * A 4xx: declined, and nothing was adopted. `by` is `coord` when the body
   * carries coord's answer, else `unattributed` — not in coord's words, which
   * does not prove coord never saw it. `detail` is verbatim.
   */
  | {
      state: "refused";
      by: "coord" | "unattributed";
      refusal: UpstreamDecisionRefusal;
      detail: string;
      status: number;
    }
  /**
   * Nobody can say whether it landed: no answer at all (network, abort), an
   * answer that arrived but could not be read, a 5xx (a gateway may have
   * timed out after coord committed), or a 2xx without the `to_version` an
   * adopt reports.
   */
  | {
      state: "unconfirmed";
      cause:
        | "no_answer"
        | "unreadable_answer"
        | "server_error"
        | "unrecognized_answer";
      detail: string;
    }
  /**
   * Not sent — the operator stopped the run, the active tenant changed, or
   * coord served no publication version to pin. Nothing can have landed.
   */
  | { state: "not_attempted"; reason: NotAttemptedReason };

/** The adopt door, as the run calls it: the four pinned arguments, nothing else. */
export type AdoptOne = (
  kind: PromptDocumentKind,
  name: string,
  publicationVersion: number,
  expectedVersion: number
) => Promise<UpstreamDecisionOutcome<UpstreamDecisionResponse>>;

/** Map the hook's outcome onto a row outcome. */
export function rowOutcomeOf(
  outcome: UpstreamDecisionOutcome<UpstreamDecisionResponse>
): AdoptRowOutcome {
  if (!outcome.ok) {
    const status = outcome.status;
    if (status !== null && status >= 400 && status < 500) {
      return {
        state: "refused",
        by: coordAnswered(outcome.detail) ? "coord" : "unattributed",
        refusal: outcome.refusal,
        detail: outcome.detail,
        status,
      };
    }
    return {
      state: "unconfirmed",
      cause:
        status === null
          ? "no_answer"
          : status >= 200 && status < 300
            ? "unreadable_answer"
            : "server_error",
      detail: outcome.detail,
    };
  }
  const value = outcome.value as Partial<UpstreamDecisionResponse> | null;
  if (value && typeof value.to_version === "number") {
    return { state: "adopted", toVersion: value.to_version };
  }
  return {
    state: "unconfirmed",
    cause: "unrecognized_answer",
    detail: JSON.stringify(outcome.value),
  };
}

export interface AdoptRunHooks {
  /** Called just before a row's request is sent. */
  onStart?: (candidate: AdoptAllCandidate) => void;
  /** Called with each row's outcome as soon as it is known. */
  onSettled?: (candidate: AdoptAllCandidate, outcome: AdoptRowOutcome) => void;
  /**
   * Read before EVERY request. A non-null reason stops the run there: that row
   * and every row after it are `not_attempted` with the reason.
   */
  abortReason?: () => AbortReason | null;
}

/**
 * Adopt `selected` one at a time, each pinned to its preview versions, and
 * carry on past every refusal. Never throws: a rejected `adoptOne` is that
 * row's `unconfirmed` outcome and the run continues.
 */
export async function adoptSequentially(
  selected: readonly AdoptAllCandidate[],
  adoptOne: AdoptOne,
  hooks: AdoptRunHooks = {}
): Promise<Map<string, AdoptRowOutcome>> {
  const outcomes = new Map<string, AdoptRowOutcome>();
  let aborted: AbortReason | null = null;
  for (const candidate of selected) {
    const address = addressOf(candidate);
    aborted = aborted ?? hooks.abortReason?.() ?? null;
    let outcome: AdoptRowOutcome;
    const publicationVersion = pinnedPublicationVersion(candidate);
    if (aborted !== null) {
      outcome = { state: "not_attempted", reason: aborted };
    } else if (publicationVersion === null) {
      // The dialog never selects such a row; this keeps the run honest if a
      // caller does.
      outcome = { state: "not_attempted", reason: "no_publication_version" };
    } else {
      hooks.onStart?.(candidate);
      try {
        outcome = rowOutcomeOf(
          await adoptOne(
            candidate.kind,
            candidate.name,
            publicationVersion,
            candidate.current_version
          )
        );
      } catch (err) {
        outcome = {
          state: "unconfirmed",
          cause: "no_answer",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }
    outcomes.set(address, outcome);
    hooks.onSettled?.(candidate, outcome);
  }
  return outcomes;
}

/** The run's one summary. */
export interface AdoptRunSummary {
  adopted: number;
  refused: number;
  unconfirmed: number;
  notAttempted: number;
}

export function summarizeAdoptRun(
  outcomes: Iterable<AdoptRowOutcome>
): AdoptRunSummary {
  const summary: AdoptRunSummary = {
    adopted: 0,
    refused: 0,
    unconfirmed: 0,
    notAttempted: 0,
  };
  for (const o of outcomes) {
    if (o.state === "adopted") summary.adopted += 1;
    else if (o.state === "refused") summary.refused += 1;
    else if (o.state === "unconfirmed") summary.unconfirmed += 1;
    else summary.notAttempted += 1;
  }
  return summary;
}

/**
 * What the post-run re-read shows for a row the run did not confirm.
 *
 * | Re-read | State |
 * |---|---|
 * | failed | `unknown` — nothing was read |
 * | the document is absent | `unknown` |
 * | tracks the pinned publication, at a new version | `tracks_publication` — the read shows the adopt in place (it does not say who made it) |
 * | same version, same tracked publication | `unchanged` — nothing landed |
 * | anything else | `changed` — the document moved, but not into the pinned publication |
 */
export type RowReconciliation =
  | { state: "unknown"; why: "read_failed" | "absent" }
  | {
      state: "tracks_publication" | "unchanged" | "changed";
      currentVersion: number;
      tracked: number | null;
    };

export function reconcileRow(
  candidate: AdoptAllCandidate,
  after: readonly PromptDocumentSummary[] | null
): RowReconciliation {
  if (after === null) return { state: "unknown", why: "read_failed" };
  const doc = after.find(
    (d) => d.kind === candidate.kind && d.name === candidate.name
  );
  if (!doc) return { state: "unknown", why: "absent" };
  const tracked = doc.upstream_publication_version ?? null;
  const currentVersion = doc.current_version;
  const pinned = pinnedPublicationVersion(candidate);
  if (
    pinned !== null &&
    tracked === pinned &&
    currentVersion !== candidate.current_version
  ) {
    return { state: "tracks_publication", currentVersion, tracked };
  }
  if (
    currentVersion === candidate.current_version &&
    tracked === candidate.upstream_publication_version
  ) {
    return { state: "unchanged", currentVersion, tracked };
  }
  return { state: "changed", currentVersion, tracked };
}
