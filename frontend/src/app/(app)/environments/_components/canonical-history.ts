// ============================================================================
// Canonical-history display helpers (pure — no React, no fetch).
//
// The canonical-designation audit trail is deliberately built on SOFT machine
// refs (not foreign keys) so it OUTLIVES machine deletion, and on a
// `SET NULL` user FK. Consequently `changed_by_email`, `from_machine_name`
// and `to_machine_name` are nullable BY DESIGN — a null is a normal, expected
// row, never an error. These helpers are the single place that decides what
// to render in its place, so every surface degrades identically:
//
//   name present            -> the name
//   name null, id present   -> a short id prefix, marked as a deleted record
//   name null, id null      -> an honest "none" / "unknown" phrase
//
// Never render a bare UUID (fails the UX predictability gate) and never
// invent a name we do not have.
// ============================================================================

import type { CanonicalChange } from "@/services/devenv-api";

/** How many leading characters of a UUID we show when the name is gone. */
const ID_PREFIX_LEN = 8;

/** `deleted machine (a1b2c3d4)` — enough to correlate, short enough to read. */
function deletedRef(kind: string, id: string): string {
  return `deleted ${kind} (${id.slice(0, ID_PREFIX_LEN)})`;
}

/**
 * Label for a machine side of a change.
 *
 * `emptyLabel` is what a genuinely absent ref means in context — for the
 * `from` side of the very first designation there was no prior canonical
 * machine at all, which is different from "the machine was deleted".
 */
export function machineLabel(
  name: string | null,
  id: string | null,
  emptyLabel = "unknown machine"
): string {
  if (name) return name;
  if (id) return deletedRef("machine", id);
  return emptyLabel;
}

/** Label for the actor who made the change (email, else a deleted-user hint). */
export function actorLabel(
  email: string | null,
  userId: string | null
): string {
  if (email) return email;
  if (userId) return deletedRef("user", userId);
  return "an unknown user";
}

/** Absolute local timestamp; falls back to the raw ISO string if unparseable. */
export function formatChangedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * One-line summary of the most recent designation, e.g.
 * `Canonical set to monster by josh@qontinui.io on 7/19/2026, 4:05:00 PM`.
 */
export function describeLatestChange(change: CanonicalChange): string {
  const to = machineLabel(
    change.to_machine_name,
    change.to_machine_id,
    "no machine"
  );
  const who = actorLabel(change.changed_by_email, change.changed_by_user_id);
  return `Canonical set to ${to} by ${who} on ${formatChangedAt(
    change.changed_at
  )}`;
}

/**
 * True when this row is the initial designation (no prior canonical machine),
 * which renders as "— → machine" rather than a misleading deletion hint.
 */
export function isInitialDesignation(change: CanonicalChange): boolean {
  return change.from_machine_id === null && change.from_machine_name === null;
}
