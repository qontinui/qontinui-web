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
import type { DeviceUnbindResponseWire } from "@/lib/api/operations/coordDeviceBindings";
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
  const complete =
    roster.rosterTruncated === false && (roster.omitted ?? 0) === 0;
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
  /** An id the route did not answer for, or an outcome this build does not know. */
  | "unreported";

export interface UnbindRowResult {
  deviceId: string;
  outcome: UnbindRowOutcome;
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
  abort: UnbindAbort | null = null
): UnbindSummary {
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
    if (!r) return { deviceId, outcome: "unreported", status, error: null };
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
      case "not_attempted":
        return {
          deviceId,
          // After an auth abort the batch stopped at the refusal; otherwise
          // its deadline came first.
          outcome: abort !== null ? "not_attempted" : "deadline_not_attempted",
          status,
          error: null,
        };
      case "failed":
        return {
          deviceId,
          outcome: "failed",
          status,
          error: errorReading(r.error, status),
        };
      default:
        return { deviceId, outcome: "unreported", status, error: null };
    }
  });
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
  const unreported = count("unreported");
  const bindingsRemoved = removed + stillListed + pointerUnknown;

  const n = rows.length;
  const its = (k: number) => plural(k, "its", "their");
  const parts: string[] = [
    `${bindingsRemoved} of ${n} ${plural(n, "binding", "bindings")} removed`,
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
  if (unreported > 0)
    parts.push(
      body === null
        ? `${unreported} unreported (the answer could not be read; the list re-reads to show what coord now holds)`
        : `${unreported} not reported by the route`
    );

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
    unreported,
    // Settled = coord answered for every id and none needs another try.
    allSettled: n > 0 && rows.every((r) => !UNSETTLED.has(r.outcome)),
    sentence: `${parts.join("; ")}.`,
  };
}

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
}

export const MAY_HAVE_APPLIED_TEXT =
  "Some bindings may have been removed — the list re-reads to show what coord now holds.";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Rows that leave a removal possible but unconfirmed. */
function uncertainRows(s: UnbindSummary): number {
  return s.answerLost + s.unreported;
}

/** Turn a rejection from `unbindFleetDevices` into what the dialog renders. */
export function describeUnbindRejection(
  requested: readonly string[],
  err: unknown
): UnbindRefusal {
  if (isBackendErrorReading(err) || err instanceof BackendError) {
    const reading = isBackendErrorReading(err) ? err : err.reading;
    return {
      auth: false,
      status: null,
      reading,
      mayHaveApplied: true,
      partial: null,
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
      partial: null,
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
  const hasResults =
    inner !== null && Array.isArray(inner.results) && inner.results.length > 0;
  const partial =
    inner !== null && (hasResults || abort !== null)
      ? summarizeUnbind(
          requested,
          inner as unknown as DeviceUnbindResponseWire,
          abort
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
    const removed = partial?.bindingsRemoved ?? 0;
    const uncertain = partial !== null && uncertainRows(partial) > 0;
    const what =
      removed > 0
        ? `The batch stopped there; ${removed} ${plural(
            removed,
            "binding was",
            "bindings were"
          )} already removed${uncertain ? ", and more may have been" : ""}.`
        : uncertain
          ? "The batch stopped there; some bindings may have been removed."
          : "Nothing was removed.";
    return {
      auth,
      status,
      reading: {
        ...reading,
        sentence:
          `Coord refused the removal (HTTP ${status}): only an operator of this tenant may remove a machine from it. ` +
          what +
          (reading.sentence && !/^HTTP \d{3}$/.test(reading.sentence)
            ? ` (${reading.sentence})`
            : ""),
      },
      mayHaveApplied: uncertain,
      partial,
    };
  }
  // A 5xx — 503 included — may follow a commit: only per-id rows can say
  // otherwise.
  const mayHaveApplied =
    partial !== null ? uncertainRows(partial) > 0 : status >= 500;
  return { auth, status, reading, mayHaveApplied, partial };
}
