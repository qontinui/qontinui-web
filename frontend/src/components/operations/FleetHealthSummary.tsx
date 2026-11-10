"use client";

/**
 * The coord `DeviceState` → badge mapping and the per-device cross-links.
 *
 * Both were page-locals on `admin/coord/fleet/page.tsx`, so nothing outside
 * that one page could render a coord `DeviceState`. Plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 1 lifted them
 * here, along with the `HealthSummaryCard` that used to render them as a
 * SECOND machine list beside `FleetOverview`'s.
 *
 * **That card is gone.** Phase 1 merged its content into the Dev Ops
 * Overview's one machine list — coord's `DeviceState` on each `MachineCard`
 * row, with these cross-links riding along — precisely because two lists with
 * two notions of "healthy" on one page is a correctness defect. Phase 4 then
 * deleted its last mount (the pipeline page's `System details` drawer), which
 * left the component with no caller at all, so it was deleted rather than
 * parked. What survives here is what the merged list actually renders through.
 *
 * `deviceStateBadgeVariant` renders an unrecognised or MISSING state as
 * `outline` and the label as `unknown`. That is the honesty rule the whole
 * surface rests on: a device coord has no verdict for is unknown, never
 * healthy.
 */

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { relativeTime } from "@/components/console/time";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

/**
 * Map a coord `DeviceState` value to a badge variant. Unrecognized /
 * missing states fall back to "outline" (rendered as "unknown").
 *
 * The mapping is a three-tier rule, not five ad-hoc choices:
 *
 * * `destructive` — **coord cannot reach a machine it still counts.** Reserved
 *   for `partitioned`; nothing else may borrow it.
 * * `secondary` — **coord has not given up on it, and something about it is
 *   off.** `degraded`, `stale`, `ci_offline`, and `ci_unrefreshed` (a CI
 *   registration coord's registrar has not refreshed recently: not a
 *   degradation, but never healthy and never unknown).
 * * `outline` — **no verdict that counts**: an absent or unrecognized state,
 *   and `abandoned`, which coord's project state treats as no degradation. On
 *   a long-lived tenant abandoned rows are most of the roster, and red on each
 *   would contradict the health strip's muted count and drown a live partition.
 *
 * `stale` is coord's FIFTH `DeviceState` (plan
 * `2026-08-27-fleet-telemetry-has-no-saturation-dimension-but-memory`,
 * Phase 4) and it is a derived overlay, never persisted. It means **the
 * heartbeat is fine and the SAMPLER has gone quiet** — coord hears the machine
 * and has stopped hearing its resource telemetry. That is deliberately NOT
 * `partitioned`, whose whole meaning is that the device stopped heartbeating:
 * on 2026-08-27 the fleet-health read said `{healthy: 4}` beside a WSL-lane
 * sample 22 minutes old, and calling that a network partition would have sent
 * an operator to debug the wrong layer. Painting the two the same red would
 * make the same mistake in one glyph.
 *
 * It is equally not `outline`: staleness is a positive observation coord made,
 * not an absence of one. **Stale is UNKNOWN — never healthy, and never dead.**
 */
const STATE_BADGE_VARIANT: Record<string, BadgeVariant> = {
  healthy: "default",
  degraded: "secondary",
  stale: "secondary",
  ci_offline: "secondary",
  ci_unrefreshed: "secondary",
  partitioned: "destructive",
  abandoned: "outline",
};

export function deviceStateBadgeVariant(state?: string): BadgeVariant {
  return STATE_BADGE_VARIANT[state ?? ""] ?? "outline";
}

/** A coord `DeviceState` in words, for the states whose wire spelling is not one. */
export function deviceStateLabel(state: string): string {
  if (state === "ci_offline") return "CI offline";
  if (state === "ci_unrefreshed") return "not refreshed by the registrar";
  return state;
}

/** The `/fleet/health` row fields {@link deviceRowStateLabel} reads. */
export interface DeviceRowStateRef {
  state?: string | null;
  ci_runner_status?: string | null;
  last_seen_at?: string | null;
}

/**
 * One machine row's coord state in words — {@link deviceStateLabel} plus what
 * only the row can say:
 *
 * * `ci_offline` with `ci_runner_status: "not_listed"` — coord polled the
 *   registration's repo and GitHub no longer lists it. Said outright, because
 *   "CI offline" alone reads as a runner that is down, and a finished one-job
 *   runner or a removed registration is a different thing to go and look at.
 * * `ci_unrefreshed` — aged from `last_seen_at`, the last time coord's
 *   registrar refreshed the row. With no usable `last_seen_at` the age is
 *   said to be unknown rather than left out.
 *
 * An absent state is `unknown` here, never healthy.
 */
export function deviceRowStateLabel(
  row: DeviceRowStateRef,
  { now }: { now?: number } = {}
): string {
  const state =
    typeof row.state === "string" && row.state !== "" ? row.state : null;
  if (state === null) return "unknown";
  if (state === "ci_offline" && row.ci_runner_status === "not_listed") {
    return "CI offline: GitHub no longer lists this registration";
  }
  if (state === "ci_unrefreshed") {
    const age = relativeTime(row.last_seen_at, { absent: "", now });
    return age === ""
      ? "not refreshed by the registrar (last seen unknown)"
      : `not refreshed by the registrar (last refreshed ${age})`;
  }
  return deviceStateLabel(state);
}

/**
 * The three per-device cross-links (trees / claims / sessions). Extracted so
 * the merged Dev Ops machine list can carry the SAME affordances the card
 * carries — Phase 1 requires them preserved, and a second hand-written copy
 * would be the thing that drifts.
 */
export function DeviceCrossLinks({ deviceId }: { deviceId: string }) {
  return (
    <div className="flex items-center gap-1" data-device-cross-links={deviceId}>
      <Link
        href={`/admin/coord/trees?device_id=${encodeURIComponent(deviceId)}`}
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
      >
        trees <ExternalLink className="h-3 w-3" />
      </Link>
      <span className="text-muted-foreground">·</span>
      <Link
        href={`/admin/agent-claims`}
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
      >
        claims <ExternalLink className="h-3 w-3" />
      </Link>
      <span className="text-muted-foreground">·</span>
      <Link
        href={`/sessions`}
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
      >
        sessions <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}
