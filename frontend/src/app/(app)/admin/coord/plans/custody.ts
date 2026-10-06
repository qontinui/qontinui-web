/**
 * The live-custody badge — who is working this plan right now, as coord
 * resolved it, and NOTHING guessed.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 6
 * and Design decision 1. Mapped onto coord's shipped wire contract
 * (`work_unit_custody.rs`), forwarded verbatim by the reconciliation route
 * under `include_custody=true`:
 *
 * | wire | badge |
 * |---|---|
 * | `sole` + `session_name` | "claimed by <name>, last seen <Xm> ago, expires <HH:MM>" |
 * | `sole` + `session_name: null` | "claimed by an unnamed session" |
 * | `ambiguous` | "N sessions active on this device" |
 * | `unresolved` | "custody UNKNOWN" |
 * | `live_sessions: []` | "no live claim" — ONLY here |
 * | `custody_resolved` false / absent | "custody not resolved (older coord)" |
 *
 * **Never collapse one of these into another.** "No live claim" is a
 * measured zero and is said only for an empty `live_sessions` list; an absent
 * list, an unresolved custody and an older coord are three different UNKNOWNs.
 * An ambiguous device is a COUNT — naming the most recent of its sessions
 * would address a peer by guess, which is exactly what coord's
 * `sole_live_session_for_device` refuses to do.
 *
 * One deliberate ordering: an empty `live_sessions` list reads "no live
 * claim" even when `custody_resolved` is false. Custody resolution names WHO
 * holds a claim; when there is no claim row at all there is nobody to name,
 * and the zero was measured either way.
 */

import { relativeTime } from "@/components/console";
import type {
  ReconciliationAxisA,
  ReconciliationLiveSession,
} from "@/components/admin/coord/planReconciliationStatus";

/** Where to get the list an ambiguous count stands for. */
export const WHO_IS_WORKING_HINT =
  "coord_who_is_working_on lists the sessions for this slug.";

export type CustodyClaimKind =
  | "sole_named"
  | "sole_unnamed"
  | "ambiguous"
  | "unresolved"
  | "unknown";

export interface CustodyClaim {
  kind: CustodyClaimKind;
  label: string;
  title: string;
  unknown: boolean;
}

export type CustodyKind =
  /** No coord unit for this stem — custody does not apply. */
  | "not_applicable"
  /** Axis A unreadable: whether anyone holds it is UNKNOWN. */
  | "axis_unknown"
  /** `custody_resolved` false or absent, with claim rows (or none reported). */
  | "older_coord"
  /** Resolved, but coord reported no live-session list for this unit. */
  | "sessions_unknown"
  /** A real, measured zero. */
  | "no_live_claim"
  | "claims";

export interface CustodyReading {
  kind: CustodyKind;
  /** The single-badge text; for `claims`, see `claims`. */
  label: string;
  title: string;
  unknown: boolean;
  claims: CustodyClaim[];
}

/** `HH:MM`, local, zero-padded — or `null` for an absent/unparseable time. */
export function clockTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function lastSeen(session: ReconciliationLiveSession, now: number): string {
  return session.updated_at
    ? `last seen ${relativeTime(session.updated_at, { now, absent: "at an unknown time" })}`
    : "last seen at an unknown time";
}

function expires(session: ReconciliationLiveSession): string {
  const at = clockTime(session.expires_at);
  return at ? `expires ${at}` : "expiry unknown";
}

function deviceNote(session: ReconciliationLiveSession): string {
  return `device ${session.device_id}${
    session.correlation_topic ? ` · topic ${session.correlation_topic}` : ""
  }`;
}

/** One live-session row's claim. */
export function describeClaim(
  session: ReconciliationLiveSession,
  now: number = Date.now()
): CustodyClaim {
  const custody = session.custody;
  const where = deviceNote(session);
  if (custody === null || custody === undefined) {
    return {
      kind: "unknown",
      label: "custody UNKNOWN",
      title: `coord sent no custody for this live session (${where}) — UNKNOWN, never "nobody".`,
      unknown: true,
    };
  }
  if (custody.state === "sole") {
    const name = custody.session_name;
    if (name) {
      return {
        kind: "sole_named",
        label: `claimed by ${name}, ${lastSeen(session, now)}, ${expires(session)}`,
        title: `The only live session on ${where}.`,
        unknown: false,
      };
    }
    return {
      kind: "sole_unnamed",
      label: "claimed by an unnamed session",
      title: `The only live session on ${where}; it has no display name (not an unknown one). ${lastSeen(session, now)}, ${expires(session)}.`,
      unknown: false,
    };
  }
  if (custody.state === "ambiguous") {
    const n = custody.live_session_count;
    return {
      kind: "ambiguous",
      label:
        typeof n === "number"
          ? `${n} sessions active on this device`
          : "several sessions active on this device (count not reported)",
      title: `${where}. Naming one would be a guess, so none is named. ${WHO_IS_WORKING_HINT}`,
      unknown: false,
    };
  }
  if (custody.state === "unresolved") {
    return {
      kind: "unresolved",
      label: "custody UNKNOWN",
      title: `coord could not establish custody on ${where} (a failed count, a race, or a session in another tenant). UNKNOWN — never "no sessions".`,
      unknown: true,
    };
  }
  return {
    kind: "unknown",
    label: "custody UNKNOWN",
    title: `coord sent a custody state this console does not know ("${String(
      (custody as { state: unknown }).state
    )}") on ${where} — UNKNOWN.`,
    unknown: true,
  };
}

/** The custody reading for one row's axis A. */
export function describeCustody(
  axis: ReconciliationAxisA,
  now: number = Date.now()
): CustodyReading {
  if (!axis.readable) {
    return {
      kind: "axis_unknown",
      label: "custody UNKNOWN",
      title:
        "coord's work-unit list could not be read for this stem, so whether anyone holds it is UNKNOWN.",
      unknown: true,
      claims: [],
    };
  }
  if (!axis.present) {
    return {
      kind: "not_applicable",
      label: "no work unit",
      title:
        "No coord work unit exists for this stem, so nothing can claim it.",
      unknown: false,
      claims: [],
    };
  }
  const sessions = axis.live_sessions;
  const resolved = axis.custody_resolved === true;
  if (Array.isArray(sessions) && sessions.length === 0) {
    return {
      kind: "no_live_claim",
      label: "no live claim",
      title:
        "coord reports no live session naming this unit. A session drops out within STATUS_TTL of its last heartbeat.",
      unknown: false,
      claims: [],
    };
  }
  if (!resolved) {
    return {
      kind: "older_coord",
      label: "custody not resolved (older coord)",
      title:
        axis.custody_resolved === false
          ? "coord did not echo resolve_session_names: true, so who holds this unit was not resolved."
          : "This backend did not report custody resolution for this read, so who holds this unit was not resolved.",
      unknown: true,
      claims: [],
    };
  }
  if (!Array.isArray(sessions)) {
    return {
      kind: "sessions_unknown",
      label: "custody UNKNOWN",
      title:
        'coord answered no live-session list for this unit — UNKNOWN, never "no live claim".',
      unknown: true,
      claims: [],
    };
  }
  const claims = sessions.map((s) => describeClaim(s, now));
  return {
    kind: "claims",
    label: claims.map((c) => c.label).join(" · "),
    title: claims.map((c) => c.title).join(" "),
    unknown: claims.some((c) => c.unknown),
    claims,
  };
}
