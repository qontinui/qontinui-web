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

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

/**
 * Map a coord `DeviceState` value to a badge variant. Unrecognized /
 * missing states fall back to "outline" (rendered as "unknown").
 *
 * The mapping is a three-tier rule, not five ad-hoc choices:
 *
 * * `destructive` — **coord cannot reach the device at all.** Reserved for
 *   `partitioned` / `abandoned`; nothing else may borrow it.
 * * `secondary` — **coord still reaches it, and something about it is off.**
 *   `degraded`, and now `stale`.
 * * `outline` — **coord has no verdict**: an absent or unrecognized state.
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
  partitioned: "destructive",
  abandoned: "destructive",
};

export function deviceStateBadgeVariant(state?: string): BadgeVariant {
  return STATE_BADGE_VARIANT[state ?? ""] ?? "outline";
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
