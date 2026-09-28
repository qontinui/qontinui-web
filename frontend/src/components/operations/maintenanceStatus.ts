/**
 * maintenanceStatus — the two audited status tables of
 * `/admin/coord/machine-maintenance`, and the row derivations that use them.
 *
 * Plan `2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place`
 * Phase 7. Split out of `maintenanceWindow.ts` because the console's
 * attention audit discovers tables by the `*Status.ts` convention
 * (`console/attention.test.ts`): a lever row's kind → attention table, and a
 * CI registration's. Everything else about the window — the wire parse, the
 * verdict, the dialog — stays in `maintenanceWindow.ts`.
 */

import type { Attention } from "@/components/console/attention";
import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
  type RowStatus,
  type StatusPalette,
} from "@/components/console/statusRow";
import { UNKNOWN_LABEL } from "./runnerStatus";
import {
  NO_MAINTENANCE_CONTEXT,
  drainedLanes,
  formatUntil,
  labelRepos,
  lanesLabel,
  stillRoutingCount,
  type MaintenanceContext,
  type CiRegistration,
  type MachineEntry,
  type MaintenanceLever,
} from "./maintenanceWindow";

// ---------------------------------------------------------------------------
// Lever rows — the audited kind → attention table (R3)
// ---------------------------------------------------------------------------

export type MaintenanceLeverKind =
  | "held"
  | "partial"
  | "failed"
  | "released"
  | "not_held"
  | "nothing_to_delabel"
  | "overridden_externally"
  | "left_paused_quarantined"
  | "no_ci_host"
  | "no_ci_host_unpaused"
  | "drained_outside_window"
  | "window_expired"
  | "not_in_window"
  | "unknown";

/**
 * TOTAL over {@link MaintenanceLeverKind}.
 *
 * - `partial`, `failed`, `overridden_externally`, `left_paused_quarantined`
 *   and `no_ci_host` are `author`: each stays as it is until an operator acts
 *   (retry, decide whether the hand-restored label stands, clear the
 *   quarantine, link the host).
 * - `drained_outside_window` is `author`: a raw drain (an agent's
 *   `coord_fleet_drain`, a legacy row) holds the lane and nothing about a
 *   window will release it — the operator releases it here or opens a window.
 * - `no_ci_host_unpaused` (no host linked, nothing paused yet) and
 *   `window_expired` (coord is restoring what it held) are `waiting`.
 * - `unknown` is `waiting` under the palette's documented exception — amber on
 *   an unknown row is a statement about our knowledge.
 * - `held`, `released`, `not_held`, `nothing_to_delabel` and `not_in_window`
 *   are calm: the lever is in the state someone chose, or there is nothing
 *   for it to do.
 */
export const MAINTENANCE_LEVER_ATTENTION_BY_KIND: Record<
  MaintenanceLeverKind,
  Attention
> = {
  held: "none",
  partial: "author",
  failed: "author",
  released: "none",
  not_held: "none",
  nothing_to_delabel: "none",
  overridden_externally: "author",
  left_paused_quarantined: "author",
  no_ci_host: "author",
  no_ci_host_unpaused: "waiting",
  drained_outside_window: "author",
  window_expired: "waiting",
  not_in_window: "none",
  unknown: "waiting",
};

export const MAINTENANCE_LEVER_BADGE_CLASS: Record<
  MaintenanceLeverKind,
  string
> = {
  held: "bg-sky-500/10 text-sky-200 border-sky-500/30",
  partial: AUTHOR_RED,
  failed: AUTHOR_RED,
  released: INERT,
  not_held: INERT,
  nothing_to_delabel: INERT,
  overridden_externally: AUTHOR_RED,
  left_paused_quarantined: AUTHOR_RED,
  no_ci_host: AUTHOR_RED,
  no_ci_host_unpaused: WAITING_AMBER,
  drained_outside_window: AUTHOR_RED,
  window_expired: WAITING_AMBER,
  not_in_window: INERT,
  unknown: UNKNOWN_AMBER,
};

export const MAINTENANCE_LEVER_AUTHOR_GLYPH_KINDS: ReadonlySet<MaintenanceLeverKind> =
  new Set<MaintenanceLeverKind>([
    "partial",
    "failed",
    "overridden_externally",
    "left_paused_quarantined",
    "no_ci_host",
    "drained_outside_window",
  ]);

export const MAINTENANCE_LEVER_PALETTE: StatusPalette<MaintenanceLeverKind> = {
  badgeClass: MAINTENANCE_LEVER_BADGE_CLASS,
  authorGlyphKinds: MAINTENANCE_LEVER_AUTHOR_GLYPH_KINDS,
};

function leverStatus(
  kind: MaintenanceLeverKind,
  label: string,
  reason: string
): RowStatus<MaintenanceLeverKind> {
  return {
    kind,
    label,
    reason,
    attention: MAINTENANCE_LEVER_ATTENTION_BY_KIND[kind],
  };
}

function withDetail(base: string, detail: string | null): string {
  return detail ? `${base} — ${detail}` : base;
}

/**
 * One lever row's status. `machine` decides the CI lever's no-host arm: a
 * device machine with no declared host renders "No CI host linked — link
 * one", never "not paused".
 */
export function deriveLeverStatus(
  lever: MaintenanceLever,
  entry: MachineEntry,
  now: number,
  ctx: MaintenanceContext = NO_MAINTENANCE_CONTEXT
): RowStatus<MaintenanceLeverKind> {
  const window = entry.openWindow;
  if (entry.openWindowUnreadable) {
    return leverStatus(
      "unknown",
      UNKNOWN_LABEL,
      "coord reported a maintenance window this build could not read"
    );
  }
  const noHost = entry.kind === "machine" && entry.ciHosts.length === 0;
  if (lever === "agent_work" && entry.kind === "ci_host") {
    return leverStatus(
      "not_held",
      "No workstation device",
      "this CI host is linked to no workstation runner, so there is no agent work to pause"
    );
  }
  if (window === null) {
    if (ctx.refreshError !== null) {
      return leverStatus(
        "unknown",
        UNKNOWN_LABEL,
        `the last machines refresh failed (${ctx.refreshError}), so whether this lever is paused is not known`
      );
    }
    const lane = lever === "agent_work" ? "agent" : "ci";
    const drain = ctx.drain;
    if (drain?.state === "drained" && drainedLanes(drain).includes(lane)) {
      return leverStatus(
        "drained_outside_window",
        "Drained outside a maintenance window",
        `lanes ${lanesLabel(drainedLanes(drain))}, until ${formatUntil(drain.entry.until, now)}` +
          ` — ${drain.entry.reason ?? "no reason recorded"}` +
          (lane === "ci" ? "; GitHub may still route CI jobs here" : "") +
          ". Release it here, or open a window"
      );
    }
    if (drain?.state === "unknown") {
      return leverStatus(
        "unknown",
        UNKNOWN_LABEL,
        `whether a drain holds this machine is not known — ${drain.reason}`
      );
    }
    if (lever === "ci" && noHost) {
      return leverStatus(
        "no_ci_host_unpaused",
        "No CI host linked — link one",
        "GitHub may still route CI jobs to this machine; link its runner name to pause them"
      );
    }
    return leverStatus(
      "not_held",
      lever === "agent_work" ? "Agent work running" : "CI running",
      lever === "agent_work"
        ? "not paused — coord may start agent sessions and continuations here"
        : "not paused — coord and GitHub may send CI jobs here"
    );
  }
  if (window.state !== "open") {
    return leverStatus(
      "window_expired",
      "Window expired — restoring",
      `the window ended (${window.state}); coord is releasing what it held`
    );
  }
  const until = formatUntil(window.until, now);
  const inWindow =
    lever === "agent_work"
      ? window.levers.agentWork.inWindow
      : window.levers.ci.inWindow;
  const leverHeld =
    lever === "agent_work"
      ? window.levers.agentWork.held
      : window.levers.ci.held;
  if (inWindow === null && !leverHeld) {
    // An older coord sends no `requested_levers`: a lever that is not held may
    // be released OR never requested, and the two must not be guessed apart.
    return leverStatus(
      "unknown",
      UNKNOWN_LABEL,
      "coord does not say whether this window pauses this lever (it sends no requested_levers)"
    );
  }
  if (inWindow === false) {
    return leverStatus(
      "not_in_window",
      "Not part of this window",
      lever === "agent_work"
        ? "the open window does not pause agent work — coord may start sessions here"
        : "the open window does not pause CI — coord and GitHub may send jobs here"
    );
  }
  if (lever === "agent_work") {
    const a = window.levers.agentWork;
    switch (a.state) {
      case "held":
        return leverStatus(
          "held",
          `Paused until ${until}`,
          withDetail("no new agent sessions or continuations", a.detail)
        );
      case "released":
        return leverStatus(
          "released",
          "Running",
          withDetail("released while the window stays open", a.detail)
        );
      case "failed":
        return leverStatus(
          "failed",
          "Pause failed",
          withDetail("coord could not drain the agent lane", a.detail)
        );
      case null:
        return leverStatus(
          "unknown",
          UNKNOWN_LABEL,
          "coord sent an agent-lever state this build does not recognise"
        );
    }
  }
  const c = window.levers.ci;
  if (noHost && c.state !== "failed") {
    // The window's CI lever can hold coord's CI-node lane without a host, but
    // GitHub still routes by label — say so rather than calling it paused.
    return leverStatus(
      "no_ci_host",
      "No CI host linked — link one",
      withDetail(
        c.held
          ? "coord's CI-node lane is paused, but GitHub may still route jobs to this machine"
          : "GitHub may still route CI jobs to this machine",
        c.detail
      )
    );
  }
  switch (c.state) {
    case "held":
      return leverStatus(
        "held",
        `Paused until ${until}`,
        withDetail(
          `labels off on ${labelRepos(c.labels.filter((l) => l.outcome === "removed")).length} repo(s)`,
          c.detail
        )
      );
    case "partial": {
      const n = stillRoutingCount(c.labels);
      const unknownN = new Set(
        c.labels.filter((l) => l.outcome === null).map((l) => l.repo)
      ).size;
      return leverStatus(
        "partial",
        "CI partly paused",
        withDetail(
          `${n} repo${n === 1 ? "" : "s"} still route${n === 1 ? "s" : ""} here` +
            (unknownN > 0 ? ` (${unknownN} ${UNKNOWN_LABEL})` : "") +
            " — retry",
          c.detail
        )
      );
    }
    case "failed":
      return leverStatus(
        "failed",
        "CI pause failed",
        withDetail("no label came off; GitHub still routes here", c.detail)
      );
    case "released":
      return leverStatus(
        "released",
        "Running",
        withDetail("released while the window stays open", c.detail)
      );
    case "nothing_to_delabel":
      return leverStatus(
        "nothing_to_delabel",
        `Paused until ${until}`,
        withDetail(
          "no drawable routing label — GitHub cannot route fleet CI here",
          c.detail
        )
      );
    case "overridden_externally":
      return leverStatus(
        "overridden_externally",
        "Label restored by hand",
        withDetail(
          "someone put the label back while the window is open; coord will not fight it",
          c.detail
        )
      );
    case "left_paused_quarantined":
      return leverStatus(
        "left_paused_quarantined",
        "Left paused — quarantined",
        withDetail(
          "the host is quarantined as poison, so coord leaves its label off",
          c.detail
        )
      );
    case null:
      return leverStatus(
        "unknown",
        UNKNOWN_LABEL,
        "coord sent a CI-lever state this build does not recognise"
      );
  }
}

/** Plain words for one `(label, repo)` outcome. */

// ---------------------------------------------------------------------------
// CI registrations — "Still running" (a second audited table)
// ---------------------------------------------------------------------------

export type CiRegistrationKind =
  | "busy"
  | "idle_after_pause"
  | "idle_before_pause"
  | "offline"
  | "stale"
  | "unknown";

/**
 * - `busy` is `waiting`: a job is running and will finish on its own.
 * - `idle_before_pause` is `waiting`: the next registrar poll after the pause
 *   settles it.
 * - `stale` and `unknown` are `waiting` under the unknown exception.
 * - `idle_after_pause` and `offline` are calm — nothing will start there.
 */
export const CI_REGISTRATION_ATTENTION_BY_KIND: Record<
  CiRegistrationKind,
  Attention
> = {
  busy: "waiting",
  idle_before_pause: "waiting",
  stale: "waiting",
  unknown: "waiting",
  idle_after_pause: "none",
  offline: "none",
};

export const CI_REGISTRATION_BADGE_CLASS: Record<CiRegistrationKind, string> = {
  busy: WAITING_AMBER,
  idle_before_pause: WAITING_AMBER,
  stale: UNKNOWN_AMBER,
  unknown: UNKNOWN_AMBER,
  idle_after_pause: "bg-green-500/5 text-green-300 border-green-500/25",
  offline: INERT,
};

export const CI_REGISTRATION_AUTHOR_GLYPH_KINDS: ReadonlySet<CiRegistrationKind> =
  new Set<CiRegistrationKind>();

export const CI_REGISTRATION_PALETTE: StatusPalette<CiRegistrationKind> = {
  badgeClass: CI_REGISTRATION_BADGE_CLASS,
  authorGlyphKinds: CI_REGISTRATION_AUTHOR_GLYPH_KINDS,
};

/**
 * One registration's badge. `paused` is whether the CI lever is held: with it
 * released, an idle registration says nothing about the next job — GitHub may
 * assign one at any moment.
 */
export function deriveRegistrationStatus(
  r: CiRegistration,
  paused: boolean
): RowStatus<CiRegistrationKind> {
  const s = (kind: CiRegistrationKind, label: string, reason: string) => ({
    kind,
    label,
    reason,
    attention: CI_REGISTRATION_ATTENTION_BY_KIND[kind],
  });
  if (!r.fresh) {
    return s(
      "stale",
      UNKNOWN_LABEL,
      "coord's registrar has not seen this registration recently"
    );
  }
  switch (r.status) {
    case "busy":
      return s("busy", "busy", "a job is running on it");
    case "offline":
      return s("offline", "offline", "GitHub reports the runner offline");
    case "idle":
      if (!paused)
        return s(
          "idle_before_pause",
          "idle",
          "CI is not paused — a job may start at any moment"
        );
      return r.observedAfterPause
        ? s("idle_after_pause", "idle", "observed idle after the pause")
        : s(
            "idle_before_pause",
            "idle",
            "last seen idle BEFORE the pause — waiting for a newer poll"
          );
    case null:
      return s(
        "unknown",
        UNKNOWN_LABEL,
        "coord reports no status for this registration"
      );
  }
}

/** `seen after pause`: yes / no / n/a (CI not paused). */
export function seenAfterPauseLabel(
  r: CiRegistration,
  paused: boolean
): string {
  if (!paused) return "n/a — CI not paused";
  return r.observedAfterPause ? "yes" : "no";
}
