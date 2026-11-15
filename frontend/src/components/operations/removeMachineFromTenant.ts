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

/**
 * D5: the machine holds the tenant's last CI binding(s) — it is a CI host, and
 * every CI-host roster row's devices are in this removal.
 */
export function isLastCiHost(
  machines: readonly RoleMachine[],
  m: RoleMachine
): boolean {
  if (!m.hostOnly || m.deviceIds.length === 0) return false;
  const removing = new Set(m.deviceIds.map((id) => id.toLowerCase()));
  return machines
    .filter((h) => h.hostOnly && h.deviceIds.length > 0)
    .every((h) => h.deviceIds.every((id) => removing.has(id.toLowerCase())));
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
  removed: number;
  stillListed: number;
  pointerUnknown: number;
  alreadyAbsent: number;
  failed: number;
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
  body: DeviceUnbindResponseWire | null
): UnbindSummary {
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
  const unreported = count("unreported");

  const n = rows.length;
  const parts: string[] = [
    `${removed} of ${n} row${n === 1 ? "" : "s"} removed`,
  ];
  if (stillListed > 0)
    parts.push(`${stillListed} ${STILL_LISTED_VIA_POINTER_TEXT}`);
  if (pointerUnknown > 0)
    parts.push(`${pointerUnknown} ${POINTER_UNREPORTED_TEXT}`);
  if (alreadyAbsent > 0) parts.push(`${alreadyAbsent} already absent`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (unreported > 0)
    parts.push(
      body === null
        ? `${unreported} unreported (the answer could not be read; the list re-reads to show what coord now holds)`
        : `${unreported} not reported by the route`
    );

  return {
    rows,
    removed,
    stillListed,
    pointerUnknown,
    alreadyAbsent,
    failed,
    unreported,
    allSettled: n > 0 && failed === 0 && unreported === 0,
    sentence: `${parts.join("; ")}.`,
  };
}

/** A request the route refused as a whole (it rejected rather than answered). */
export interface UnbindRefusal {
  /** 401/403: the caller may not unbind here; the batch was aborted. */
  auth: boolean;
  status: number | null;
  reading: BackendErrorReading;
  /**
   * The removal may have been applied in part — a lost answer (5xx or a
   * dropped connection), or an auth abort after earlier ids were unbound.
   */
  mayHaveApplied: boolean;
  /** Results the route recorded before an abort, when its body carried them. */
  partial: UnbindSummary | null;
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
        sentence: `The request failed before an answer arrived (${message}). Some bindings may have been removed — the list re-reads to show what coord now holds.`,
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
  const inner = isRecord(parsed)
    ? isRecord(parsed.detail)
      ? parsed.detail
      : parsed
    : null;
  const partial =
    inner && Array.isArray(inner.results) && inner.results.length > 0
      ? summarizeUnbind(requested, inner as unknown as DeviceUnbindResponseWire)
      : null;
  const auth = status === 401 || status === 403;
  const reading = readErrorBody(bodyText, status);
  if (auth) {
    return {
      auth,
      status,
      reading: {
        ...reading,
        sentence:
          `Coord refused the removal (HTTP ${status}): only an operator of this tenant may remove a machine from it. ` +
          (partial !== null &&
          partial.removed + partial.stillListed + partial.pointerUnknown > 0
            ? "The batch stopped there; the rows below were already answered."
            : "Nothing was removed.") +
          (reading.sentence && !/^HTTP \d{3}$/.test(reading.sentence)
            ? ` (${reading.sentence})`
            : ""),
      },
      mayHaveApplied: partial !== null,
      partial,
    };
  }
  const lost = status >= 500 && status !== 503;
  return {
    auth,
    status,
    reading: lost
      ? {
          ...reading,
          sentence: `${reading.sentence} Some bindings MAY have been removed — the list re-reads to show what coord now holds.`,
        }
      : reading,
    mayHaveApplied: lost,
    partial,
  };
}
