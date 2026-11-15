/**
 * "Remove from this tenant…" — every rule about what the removal dialog says
 * and what an answer means.
 *
 * Plan `2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console`
 * Phase 3. Pure and DOM-free; `RemoveMachineFromTenantDialog.tsx` renders it,
 * `useUnbindFleetDevices.ts` is transport.
 *
 * What the action is: coord's per-tenant unbind, once per device row the
 * roster groups under the machine (D1, D3). It deletes THIS tenant's
 * `(tenant, device)` edge and nothing else — no device row, no other tenant's
 * binding. So the words here never say "deleted" or "deregistered".
 *
 * Honesty rules carried here:
 * - A partial removal is reported as partial, never as one success
 *   (`[policy: ux-priorities/an-action-must-acknowledge-itself]`).
 * - A binding removed while the device's home-tenant pointer still names this
 *   tenant is "still listed", never "removed" (D4); a coord that does not say
 *   is UNKNOWN, never "removed" either.
 * - A registration whose GitHub listing is unknown says exactly that
 *   (`[policy: verification-and-evidence/unknown-must-not-render-as-a-default]`).
 */

import {
  BackendError,
  isBackendErrorReading,
  readErrorBody,
  type BackendErrorReading,
} from "@/lib/errors/backend-error-message";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import type {
  DeviceUnbindResponseWire,
  DeviceUnbindResultWire,
} from "@/lib/api/operations/coordDeviceBindings";
import type { DeviceListing, RoleMachine } from "./fleetDispatchRoles";

// ---------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------

/** One device row the removal names. */
export interface RemovalRow {
  deviceId: string;
  /**
   * The registration's GitHub listing — `null` for a workstation, which has
   * no registrar listing to have.
   */
  listing: DeviceListing | null;
  /** The row's own age: its listing's `last_seen_at`, else the machine's. */
  lastSeenAt: string | null;
}

/** Why a CI-host row's listing is unknown when coord served none for it. */
export const LISTING_NOT_SERVED =
  "coord did not report whether GitHub still lists this runner";
const LISTING_ROW_MISSING =
  "coord served listings for this machine but none for this registration";

/** Every device row the removal will name, each with its listing. */
export function removalRows(m: RoleMachine): RemovalRow[] {
  return m.deviceIds.map((deviceId) => {
    if (!m.hostOnly) {
      return { deviceId, listing: null, lastSeenAt: m.lastSeenAt };
    }
    const served =
      m.deviceListings?.find(
        (l) => l.deviceId.toLowerCase() === deviceId.toLowerCase()
      ) ?? null;
    if (served) {
      return { deviceId, listing: served, lastSeenAt: served.lastSeenAt };
    }
    return {
      deviceId,
      listing: {
        deviceId,
        scope: null,
        lastSeenAt: null,
        registrarListing: "unknown",
        detail:
          m.deviceListings === null ? LISTING_NOT_SERVED : LISTING_ROW_MISSING,
      },
      // The machine's single stamp cannot describe one row of several.
      lastSeenAt: m.deviceIds.length === 1 ? m.lastSeenAt : null,
    };
  });
}

/**
 * The typed phrase the confirm needs: the machine's name unless coord says
 * its heartbeat is stale. A `null` heartbeat "may be alive", so it pays the
 * phrase too.
 */
export function confirmPhraseFor(m: RoleMachine): string | undefined {
  return m.heartbeatFresh === false ? undefined : m.name;
}

export const ALIVE_TEXT =
  "This machine is alive; removing it stops coord sending it this tenant's work.";
export const LIVENESS_UNKNOWN_TEXT =
  "Coord does not report whether this machine is alive; if it is, removing it stops coord sending it this tenant's work.";
export const LAST_CI_HOST_TEXT =
  "This is the tenant's last CI host. Removing it makes coord treat the tenant as having no CI fleet, so its merge cap falls back to the static value.";
export const STILL_LISTED_TEXT =
  "GitHub still lists this runner, so coord's registrar will re-add it on its next poll. Remove the runner on GitHub (or with the CI-runner remove control) first.";
export const WORKSTATION_TEXT =
  "This removes only this tenant's binding. Full deregistration of the device is done by its owner on";

/** The liveness sentence, or `null` for a machine coord says is stale. */
export function livenessText(m: RoleMachine): string | null {
  if (m.heartbeatFresh === true) return ALIVE_TEXT;
  if (m.heartbeatFresh === null) return LIVENESS_UNKNOWN_TEXT;
  return null;
}

export const MAYBE_LAST_CI_HOST_TEXT =
  "This may be the tenant's last CI host: coord's roster read may be incomplete, so other CI hosts may not be listed. If it is the last, removing it makes coord treat the tenant as having no CI fleet, so its merge cap falls back to the static value.";

/** Whether the roster read is complete enough to call a CI host the last. */
export interface RosterCompleteness {
  /** Coord's `roster_truncated`; `null` = not reported. */
  rosterTruncated: boolean | null;
  /** Coord's `older_machines_omitted`; `null` = not reported. */
  omitted: number | null;
  /** CI runner registrations coord could not name; `null` = not reported. */
  unidentifiable: number | null;
}

/**
 * D5: the machine holds the tenant's last CI binding(s) — it is a CI host, and
 * every CI-host roster row's devices are in this removal. `"maybe"` when that
 * holds over a roster read that is cut, leaves machines out, or does not say
 * whether it was cut: other CI hosts may exist unlisted, so the console never
 * asserts it.
 */
export function isLastCiHost(
  machines: readonly RoleMachine[],
  m: RoleMachine,
  roster: RosterCompleteness
): "yes" | "maybe" | "no" {
  if (!m.hostOnly || m.deviceIds.length === 0) return "no";
  const removing = new Set(m.deviceIds.map((id) => id.toLowerCase()));
  const covers = machines
    .filter((h) => h.hostOnly && h.deviceIds.length > 0)
    .every((h) => h.deviceIds.every((id) => removing.has(id.toLowerCase())));
  if (!covers) return "no";
  // Another CI-host row whose device rows coord did not list may still be a
  // CI binding of this tenant: never assert "last" past it.
  // Only a REGISTERED host can hold a binding; an assigned-but-unregistered
  // row has no device row at all.
  const unlistedHost = machines.some(
    (h) =>
      h.hostOnly && h.registered && h.key !== m.key && h.deviceIds.length === 0
  );
  if (unlistedHost) return "maybe";
  // Every count must be REPORTED as zero: an unreported one is unknown, and
  // an unnamed CI registration may be another CI host.
  const complete =
    roster.rosterTruncated === false &&
    roster.omitted === 0 &&
    roster.unidentifiable === 0;
  return complete ? "yes" : "maybe";
}

/** A registration's listing in words. */
export function listingText(l: DeviceListing): string {
  switch (l.registrarListing) {
    case "listed":
      return "GitHub still lists this runner";
    case "not_listed":
      return `GitHub no longer lists this runner${l.detail ? ` (${l.detail})` : ""}`;
    default:
      return `Unknown whether GitHub still lists this runner${
        l.detail ? ` — ${l.detail}` : ""
      }`;
  }
}

/** The declared effect of the action, for its label and UI Bridge entry. */
export function removalEffect(n: number): string {
  return `removes this tenant's binding of ${n} device${n === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

/** One id's outcome, in the console's terms. */
export type UnbindRowOutcome =
  | "removed"
  /** D4: the edge is gone, the home-tenant pointer keeps it listed. */
  | "still_listed_via_pointer"
  /** The edge is gone; coord did not say whether the pointer keeps it. */
  | "unbound_pointer_unknown"
  | "already_absent"
  | "failed"
  /** The id at which coord refused the CALLER (401/403); the batch stopped. */
  | "refused_auth"
  /** After an auth refusal (`coord_refused_caller`): never sent to coord. */
  | "not_attempted"
  /**
   * Wire `unknown`: coord's answer was lost (timeout, transport, a non-JSON
   * 2xx). The binding MAY have been removed — never "removed", never "failed".
   */
  | "answer_lost"
  /** Wire `not_attempted`: the batch hit its deadline before this id. */
  | "deadline_not_attempted"
  /**
   * Batched removals: this id's batch was never sent, because an earlier
   * batch was REFUSED (a 4xx). Nothing happened to it.
   */
  | "not_sent"
  /** As `not_sent`, after an earlier batch failed or its answer was lost. */
  | "not_sent_after_failure"
  /**
   * The request carrying this id was rejected with a non-auth 4xx before any
   * id was acted on (`status` says which).
   */
  | "request_rejected"
  /**
   * A retry found the binding absent after an earlier attempt whose answer
   * was lost or unreported. Probably that attempt removed it, but nothing
   * confirmed it, so it has its own clause and is not counted as removed.
   */
  | "removed_earlier"
  /**
   * This console's own gate refused the request carrying this id (a 401/403
   * with no `refused_device_id`): it never reached coord.
   */
  | "console_refused"
  /** An id the route did not answer for, or an outcome this build does not know. */
  | "unreported";

export interface UnbindRowResult {
  deviceId: string;
  outcome: UnbindRowOutcome;
  /** For `unreported`: its batch answered a body that could not be read. */
  unreadable?: boolean;
  status: number | null;
  /** Coord's refusal for a failed id, as `BackendErrorMessage` renders it. */
  error: BackendErrorReading | null;
}

export interface UnbindSummary {
  rows: UnbindRowResult[];
  /** Bindings coord deleted, whatever the pointer says (removed + stillListed + pointerUnknown). */
  bindingsRemoved: number;
  removed: number;
  stillListed: number;
  pointerUnknown: number;
  alreadyAbsent: number;
  failed: number;
  refusedAuth: number;
  notAttempted: number;
  answerLost: number;
  deadlineNotAttempted: number;
  notSent: number;
  notSentAfterFailure: number;
  requestRejected: number;
  removedEarlier: number;
  consoleRefused: number;
  unreported: number;
  /** Every id read `unbound` or `already_absent` — the only case for a toast. */
  allSettled: boolean;
  /** The counts in one sentence. */
  sentence: string;
}

export const STILL_LISTED_VIA_POINTER_TEXT =
  "binding removed; still listed through its home tenant, which only its owner can change on /runners";
export const POINTER_UNREPORTED_TEXT =
  "binding removed; coord did not report whether it is still listed through its home tenant";

/**
 * An auth abort (`coord_refused_caller`): the id coord refused. The route's
 * rows cover every id — the refused one as `failed`, later ones as
 * `not_attempted` — and this is what tells those apart from an ordinary
 * failure and from the deadline's `not_attempted`.
 */
export interface UnbindAbort {
  refusedDeviceId: string | null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Outcomes a retry sends again: anything not known to be settled. */
const UNSETTLED: ReadonlySet<UnbindRowOutcome> = new Set<UnbindRowOutcome>([
  "failed",
  "refused_auth",
  "not_attempted",
  "answer_lost",
  "deadline_not_attempted",
  "not_sent",
  "not_sent_after_failure",
  "request_rejected",
  "console_refused",
  "unreported",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A failed id's coord body, as a reading. */
function errorReading(
  error: unknown,
  status: number | null
): BackendErrorReading {
  if (error === null || error === undefined) {
    return {
      kind: "unstructured",
      sentence: status !== null ? `HTTP ${status}` : "no detail given",
    };
  }
  const text = typeof error === "string" ? error : JSON.stringify(error);
  return readErrorBody(text, status ?? 500);
}

/** Read the route's per-id answer against the ids that were sent. */
export function summarizeUnbind(
  requested: readonly string[],
  body: DeviceUnbindResponseWire | null,
  abort: UnbindAbort | null = null,
  /** Ids whose batch answered a 2xx body that could not be read. */
  unreadableIds: readonly string[] = []
): UnbindSummary {
  const unreadable = new Set(unreadableIds.map((id) => id.toLowerCase()));
  const refused = abort?.refusedDeviceId?.toLowerCase() ?? null;
  const served = new Map<string, Record<string, unknown>>();
  if (body !== null && Array.isArray(body.results)) {
    for (const r of body.results as unknown[]) {
      if (isRecord(r) && typeof r.device_id === "string") {
        served.set(r.device_id.toLowerCase(), r);
      }
    }
  }
  const rows: UnbindRowResult[] = requested.map((deviceId) => {
    const r = served.get(deviceId.toLowerCase());
    const status = r && typeof r.status === "number" ? r.status : null;
    if (refused !== null && deviceId.toLowerCase() === refused) {
      return { deviceId, outcome: "refused_auth", status, error: null };
    }
    if (!r)
      return {
        deviceId,
        outcome: "unreported",
        status,
        error: null,
        // A whole body that could not be read, or this id's batch's.
        unreadable: body === null || unreadable.has(deviceId.toLowerCase()),
      };
    switch (r.outcome) {
      case "unbound":
        return {
          deviceId,
          outcome:
            r.still_member_via_pointer === true
              ? "still_listed_via_pointer"
              : r.still_member_via_pointer === false
                ? "removed"
                : "unbound_pointer_unknown",
          status,
          error: null,
        };
      case "already_absent":
        return { deviceId, outcome: "already_absent", status, error: null };
      case "unknown":
        return { deviceId, outcome: "answer_lost", status, error: null };
      case "not_attempted": {
        // The row's own words say why; the abort flag only decides when they
        // say nothing this build recognises.
        const detail = isRecord(r.error) ? str(r.error.detail) : null;
        const why =
          detail !== null && /caller refusal/i.test(detail)
            ? "not_attempted"
            : detail !== null && /budget|deadline|time/i.test(detail)
              ? "deadline_not_attempted"
              : abort !== null
                ? "not_attempted"
                : "deadline_not_attempted";
        return { deviceId, outcome: why, status, error: null };
      }
      case "failed":
        return {
          deviceId,
          outcome: "failed",
          status,
          error: errorReading(r.error, status),
        };
      // Synthesised by this console for batches, never sent by the route.
      case "not_sent":
      case "not_sent_after_failure":
        return { deviceId, outcome: r.outcome, status: null, error: null };
      case "request_rejected":
        return { deviceId, outcome: "request_rejected", status, error: null };
      case "console_refused":
        return {
          deviceId,
          outcome: "console_refused",
          status: null,
          error: null,
        };
      default:
        return { deviceId, outcome: "unreported", status, error: null };
    }
  });
  return summarizeRows(rows);
}

/**
 * The machine-level summary after a retry: each id's latest outcome — the
 * retry's for the ids it sent, the earlier attempt's for the rest.
 */
export function combineSummaries(
  requested: readonly string[],
  earlier: UnbindSummary,
  later: UnbindSummary
): UnbindSummary {
  const byId = (s: UnbindSummary) =>
    new Map(s.rows.map((r) => [r.deviceId.toLowerCase(), r]));
  const before = byId(earlier);
  const after = byId(later);
  const rows = requested.map((deviceId): UnbindRowResult => {
    const e = before.get(deviceId.toLowerCase());
    const l = after.get(deviceId.toLowerCase());
    // The retry never reached coord for this id: it says nothing new, so
    // the earlier row (which may say "may have been removed") stands.
    if (l !== undefined && e !== undefined && NEVER_SENT.has(l.outcome)) {
      return e;
    }
    // The earlier attempt may have removed it, and the retry acted on
    // nothing (coord refused the caller, or failed this id): the earlier
    // uncertainty stands — never a calm "failed".
    if (
      l !== undefined &&
      e !== undefined &&
      (e.outcome === "answer_lost" || e.outcome === "unreported") &&
      (l.outcome === "refused_auth" || l.outcome === "failed")
    ) {
      return e;
    }
    // Absent now, after an attempt that may have removed it: that attempt
    // did. (A `not_sent` id was never sent, so it is not one of these.)
    if (
      l?.outcome === "already_absent" &&
      (e?.outcome === "answer_lost" || e?.outcome === "unreported")
    ) {
      return { ...l, outcome: "removed_earlier" };
    }
    return (
      l ??
      e ?? {
        deviceId,
        outcome: "unreported",
        status: null,
        error: null,
      }
    );
  });
  return summarizeRows(rows);
}

/** Count rows and say them in one sentence. */
export function summarizeRows(rows: UnbindRowResult[]): UnbindSummary {
  const count = (o: UnbindRowOutcome) =>
    rows.filter((r) => r.outcome === o).length;
  const removed = count("removed");
  const stillListed = count("still_listed_via_pointer");
  const pointerUnknown = count("unbound_pointer_unknown");
  const alreadyAbsent = count("already_absent");
  const failed = count("failed");
  const refusedAuth = count("refused_auth");
  const notAttemptedCount = count("not_attempted");
  const answerLost = count("answer_lost");
  const deadlineNotAttempted = count("deadline_not_attempted");
  const notSent = count("not_sent");
  const notSentAfterFailure = count("not_sent_after_failure");
  const requestRejected = count("request_rejected");
  const removedEarlier = count("removed_earlier");
  const consoleRefused = count("console_refused");
  const unreported = count("unreported");
  const unreadableCount = rows.filter(
    (r) => r.outcome === "unreported" && r.unreadable === true
  ).length;
  const bindingsRemoved = removed + stillListed + pointerUnknown;

  const n = rows.length;
  const its = (k: number) => plural(k, "its", "their");
  // While any row may have been removed without coord saying so, the count
  // is of the CONFIRMED removals only.
  const uncertain = answerLost + unreported > 0;
  const parts: string[] = [
    `${bindingsRemoved} of ${n} ${plural(n, "binding", "bindings")} ${
      uncertain ? "confirmed removed" : "removed"
    }`,
  ];
  if (stillListed > 0)
    parts.push(
      `${stillListed} still listed through ${its(stillListed)} home tenant, which only ${plural(
        stillListed,
        "its owner",
        "their owners"
      )} can change on /runners`
    );
  if (pointerUnknown > 0)
    parts.push(
      `${pointerUnknown} may still be listed through ${its(pointerUnknown)} home tenant (coord did not report)`
    );
  if (removedEarlier > 0)
    parts.push(
      `${removedEarlier} absent now (the earlier attempt's answer was lost)`
    );
  if (alreadyAbsent > 0) parts.push(`${alreadyAbsent} already absent`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (refusedAuth > 0) parts.push(`${refusedAuth} refused (auth)`);
  if (notAttemptedCount > 0)
    parts.push(
      `${notAttemptedCount} not attempted (aborted by an auth refusal)`
    );
  if (answerLost > 0)
    parts.push(
      `${answerLost} may have been removed (coord's answer was lost; reload to check)`
    );
  if (deadlineNotAttempted > 0)
    parts.push(`${deadlineNotAttempted} not attempted (time limit) — retry`);
  if (consoleRefused > 0)
    parts.push(
      `${consoleRefused} not attempted (this console refused the request)`
    );
  if (requestRejected > 0) {
    const statuses = [
      ...new Set(
        rows
          .filter((r) => r.outcome === "request_rejected")
          .map((r) => (r.status !== null ? `HTTP ${r.status}` : "no status"))
      ),
    ].join(", ");
    parts.push(
      `${requestRejected} not attempted (the request was rejected: ${statuses})`
    );
  }
  if (notSent > 0)
    parts.push(`${notSent} not sent (an earlier batch was refused)`);
  if (notSentAfterFailure > 0)
    parts.push(
      `${notSentAfterFailure} not sent (an earlier batch failed or its answer was lost)`
    );
  if (unreadableCount > 0)
    parts.push(
      `${unreadableCount} unreported (the answer could not be read; the list re-reads to show what coord now holds)`
    );
  if (unreported - unreadableCount > 0)
    parts.push(`${unreported - unreadableCount} not reported by the route`);

  return {
    rows,
    bindingsRemoved,
    removed,
    stillListed,
    pointerUnknown,
    alreadyAbsent,
    failed,
    refusedAuth,
    notAttempted: notAttemptedCount,
    answerLost,
    deadlineNotAttempted,
    notSent,
    notSentAfterFailure,
    requestRejected,
    removedEarlier,
    consoleRefused,
    unreported,
    // Settled = coord answered for every id and none needs another try.
    allSettled: n > 0 && rows.every((r) => !UNSETTLED.has(r.outcome)),
    sentence:
      n > 0 && alreadyAbsent === n
        ? `Nothing to remove; ${n} already absent.`
        : `${parts.join("; ")}.`,
  };
}

/** Outcomes that say the attempt never reached coord for that id. */
const NEVER_SENT: ReadonlySet<UnbindRowOutcome> = new Set<UnbindRowOutcome>([
  "not_sent",
  "not_sent_after_failure",
  "deadline_not_attempted",
  "request_rejected",
  "console_refused",
  "not_attempted",
]);

/** The ids of a summary that a retry sends again. */
export function unsettledIds(summary: UnbindSummary): string[] {
  return summary.rows
    .filter((r) => UNSETTLED.has(r.outcome))
    .map((r) => r.deviceId);
}

/** A request the route refused as a whole (it rejected rather than answered). */
export interface UnbindRefusal {
  /** 401/403: the caller may not unbind here; the batch was aborted. */
  auth: boolean;
  status: number | null;
  reading: BackendErrorReading;
  /**
   * The outcome is not fully known and bindings MAY have been removed: a lost
   * answer (any 5xx, or a dropped connection) with no per-id rows, or rows
   * of which some read "answer lost" or "not reported". Rendered as its own
   * line. `false` when the rows say exactly what happened.
   */
  mayHaveApplied: boolean;
  /** Per-id rows the route recorded before an abort, when its body carried them. */
  partial: UnbindSummary | null;
  /**
   * For an auth refusal: the sentence around its "what was removed" clause,
   * so `mergeRefusalOver` can recompute that clause over the whole machine.
   */
  authFrame?: { lead: string; tail: string };
}

// Not a cause: coord does not report why a machine is still listed.
export const STILL_LISTED_HOME_TENANT_TEXT =
  "Still listed after the removal — it may be listed through its home tenant (which only its owner can change on /runners), or the list has not caught up; coord did not report why.";

export const MAY_HAVE_APPLIED_TEXT =
  "Some bindings may have been removed — the list re-reads to show what coord now holds.";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Rows that leave a removal possible but unconfirmed. */
function uncertainRows(s: UnbindSummary): number {
  return s.answerLost + s.unreported;
}

/** An auth refusal's "what was removed" clause, over the rows it has. */
export function authWhatClause(partial: UnbindSummary | null): string {
  const removed = partial?.bindingsRemoved ?? 0;
  const uncertain = partial !== null && uncertainRows(partial) > 0;
  return removed > 0
    ? `The batch stopped there; ${removed} ${plural(
        removed,
        "binding was",
        "bindings were"
      )} already removed${uncertain ? ", and more may have been" : ""}.`
    : uncertain
      ? "The batch stopped there; some bindings may have been removed."
      : "Nothing was removed.";
}

/**
 * A retry's refusal, merged over the whole-machine rows before it: its rows
 * (`combineSummaries`) and, for an auth refusal, the "what was removed"
 * clause and the uncertainty recomputed over the merge — so it never says
 * "Nothing was removed" about a machine an earlier attempt removed from.
 */
export function mergeRefusalOver(
  requested: readonly string[],
  base: UnbindSummary,
  refusal: UnbindRefusal,
  /** The ids this attempt sent: unreported when it came back with no rows. */
  attemptIds: readonly string[] = []
): UnbindRefusal {
  const partial =
    refusal.partial !== null
      ? combineSummaries(requested, base, refusal.partial)
      : refusal.mayHaveApplied && attemptIds.length > 0
        ? // A rowless answer that may have acted: this attempt's ids are
          // unknown now, the rest keep what the earlier attempts said.
          combineSummaries(
            requested,
            base,
            summarizeRows(
              attemptIds.map((deviceId) => ({
                deviceId,
                outcome: "unreported",
                status: null,
                error: null,
              }))
            )
          )
        : base;
  if (!refusal.auth || refusal.authFrame === undefined) {
    // A merged row may still be uncertain (an earlier lost answer), whatever
    // this attempt's own refusal said.
    return {
      ...refusal,
      partial,
      mayHaveApplied: refusal.mayHaveApplied || uncertainRows(partial) > 0,
    };
  }
  return {
    ...refusal,
    partial,
    reading: {
      ...refusal.reading,
      sentence:
        refusal.authFrame.lead +
        authWhatClause(partial) +
        refusal.authFrame.tail,
    },
    mayHaveApplied: uncertainRows(partial) > 0,
  };
}

/** Turn a rejection from `unbindFleetDevices` into what the dialog renders. */
export function describeUnbindRejection(
  requested: readonly string[],
  err: unknown,
  /**
   * When the removal was sent in batches: the rows earlier batches answered,
   * and the ids of later batches that were never sent.
   */
  batches: {
    prior: readonly DeviceUnbindResultWire[];
    /** The ids of the batch this rejection answered. */
    current: readonly string[];
    neverSent: readonly string[];
    /** Ids of earlier batches whose 2xx body could not be read. */
    unreadableIds: readonly string[];
  } = { prior: [], current: requested, neverSent: [], unreadableIds: [] }
): UnbindRefusal {
  const synth = (ids: readonly string[], outcome: string) =>
    ids.map((device_id) => ({
      device_id,
      outcome,
      status: null,
      error: null,
      still_member_via_pointer: null,
    }));
  // Later batches were never sent, whatever stopped this one; the words say
  // whether it was refused (a 4xx) or failed / lost its answer.
  const rejectedStatus = httpStatusOf(err);
  const refusedNotFailed =
    !isBackendErrorReading(err) &&
    !(err instanceof BackendError) &&
    rejectedStatus !== null &&
    rejectedStatus < 500;
  const notSentRows = synth(
    batches.neverSent,
    refusedNotFailed ? "not_sent" : "not_sent_after_failure"
  );
  // A lost answer (no status): this batch's ids stay unreported — it may have
  // acted — and only the rows earlier batches answered are known.
  const priorOnly = (): UnbindSummary | null =>
    batches.prior.length > 0 || notSentRows.length > 0
      ? summarizeUnbind(
          requested,
          {
            results: [...batches.prior, ...notSentRows],
          } as unknown as DeviceUnbindResponseWire,
          null,
          batches.unreadableIds
        )
      : null;
  if (isBackendErrorReading(err) || err instanceof BackendError) {
    const reading = isBackendErrorReading(err) ? err : err.reading;
    return {
      auth: false,
      status: null,
      reading,
      mayHaveApplied: true,
      partial: priorOnly(),
    };
  }
  const status = httpStatusOf(err);
  if (status === null) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      auth: false,
      status: null,
      reading: {
        kind: "unstructured",
        sentence: `The request failed before an answer arrived (${message}).`,
      },
      mayHaveApplied: true,
      partial: priorOnly(),
    };
  }
  const bodyText = httpBodyOf(err) ?? "";
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    // not JSON — the reading below still renders its text
  }
  // The web error envelope may splice a dict `detail` to the top level.
  const inner = isRecord(parsed)
    ? isRecord(parsed.detail)
      ? parsed.detail
      : parsed
    : null;
  const auth = status === 401 || status === 403;
  // `coord_refused_caller` (the route's own abort) names the id coord refused.
  // A 401/403 without it is the web gate's own refusal: nothing was attempted.
  const refusedDeviceId = inner ? str(inner.refused_device_id) : null;
  const abort: UnbindAbort | null =
    refusedDeviceId !== null ? { refusedDeviceId } : null;
  const chunkRows: unknown[] =
    inner !== null && Array.isArray(inner.results) ? inner.results : [];
  // After an auth abort, a later batch's ids were never sent: the same
  // "not attempted (aborted by an auth refusal)" as the route's own rows.
  // This console's own gate (a 401/403 with no `refused_device_id`): the
  // batch reached nothing.
  const gateRows =
    chunkRows.length > 0
      ? []
      : auth && abort === null
        ? synth(batches.current, "console_refused")
        : // A non-auth 4xx: the request was rejected before any id was
          // acted on — never "may have been removed".
          !auth && status < 500
          ? batches.current.map((device_id) => ({
              device_id,
              outcome: "request_rejected",
              status,
              error: null,
              still_member_via_pointer: null,
            }))
          : [];
  const merged = [...batches.prior, ...chunkRows, ...gateRows, ...notSentRows];
  const partial =
    merged.length > 0 || abort !== null
      ? summarizeUnbind(
          requested,
          { results: merged } as unknown as DeviceUnbindResponseWire,
          abort,
          batches.unreadableIds
        )
      : null;
  // Coord's own refusal, when the route relayed it as `coord_error`.
  const coordError = inner?.coord_error;
  const reading = readErrorBody(
    coordError === undefined || coordError === null
      ? bodyText
      : typeof coordError === "string"
        ? coordError
        : JSON.stringify(coordError),
    status
  );
  if (auth) {
    const uncertain = partial !== null && uncertainRows(partial) > 0;
    const what = authWhatClause(partial);
    // Without `refused_device_id` the refusal is this console's own gate,
    // before any id reached coord.
    const coordStatus =
      abort !== null && typeof inner?.coord_status === "number"
        ? inner.coord_status
        : null;
    const who =
      abort === null
        ? `This console refused the removal (HTTP ${status})`
        : coordStatus !== null
          ? `Coord refused the removal (coord HTTP ${coordStatus})`
          : `Coord refused the removal (HTTP ${status})`;
    const effective = coordStatus ?? status;
    const tenantUnresolved =
      abort === null &&
      ((inner !== null && inner.error === "tenant_not_resolved") ||
        /tenant_not_resolved/.test(bodyText));
    const why = tenantUnresolved
      ? "no coord tenant is selected or resolved for your account — pick a tenant and retry."
      : effective === 401
        ? "not authenticated — sign in again."
        : "only an operator of this tenant may remove a machine from it.";
    const lead = `${who}: ${why} `;
    const tail =
      reading.sentence && !/^HTTP \d{3}$/.test(reading.sentence)
        ? ` (${reading.sentence})`
        : "";
    return {
      auth,
      status,
      reading: { ...reading, sentence: lead + what + tail },
      mayHaveApplied: uncertain,
      partial,
      authFrame: { lead, tail },
    };
  }
  // A 5xx — 503 included — may follow a commit: only per-id rows can say
  // otherwise.
  const mayHaveApplied =
    partial !== null ? uncertainRows(partial) > 0 : status >= 500;
  return { auth, status, reading, mayHaveApplied, partial };
}
