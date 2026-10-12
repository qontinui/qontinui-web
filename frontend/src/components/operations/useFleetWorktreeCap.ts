"use client";

/**
 * `GET /api/v1/operations/fleet/worktree-cap` — which devices carry a
 * per-device worktree-cap override, and the two writes that change that.
 *
 * Amendment A3 / Phase 4 of plan
 * `2026-09-18-coord-allocation-budgets-ignore-the-machine-they-gate`. The parse
 * and every rule about what a body means live in `./fleetWorktreeCap.ts`; this
 * file is the transport and the polling cadence, and nothing else.
 *
 * ## Why this polls at all, and why slowly
 *
 * Unlike a drain, a cap does NOT expire — coord has no deadline on it and no
 * sweeper, so nothing changes it but an operator action. A once-only read would
 * therefore be defensible. It polls anyway, for one reason: an operator is not
 * the only writer. Once A3's agent twin lands, an agent holding
 * `coord_fleet_set_worktree_cap` will be able to change the same value
 * (`decision_record/fleet-drain-agent-authority` extends agent parity to
 * exactly this class of control), so a console that read once would show a
 * number the fleet had already moved past. That tool is door (c) of A3 and is
 * not built yet; the cadence is chosen for the surface this console will live
 * on, not the one it lands into.
 *
 * The cadence is the drain's, and slower than fleet health's 10 s, because the
 * fact is coarser still: this page's own writes force an immediate refresh
 * (`refresh()` is handed to the control), so the poll only has to catch another
 * principal's action.
 *
 * ## Every failure lands on UNKNOWN, and the 404 is GUARANTEED for a while
 *
 * `GET /coord/fleet/worktree-cap` ships in the coord half of A3, and the three
 * pieces deploy independently and in a fixed order: the alembic revision first,
 * this console second, coord third. So there is a window — not a hypothetical
 * one — in which this route answers 404, and the honest reading of that is
 * exactly the reading of a timeout: **the cap state is unknown**. It is not "no
 * device is capped", which is what a `?? []` would have said, and it is not an
 * error banner either, because a console that shouts through a planned deploy
 * window teaches the operator to stop reading it.
 */

import { useCallback, useState } from "react";
import { httpClient } from "@/services/service-factory";
import { COORD_DASHBOARD_POLL_OPTIONS } from "./coordPollError";
import { useSingleFlightPoll } from "./useSingleFlightPoll";
import { OPERATIONS_API } from "./utils";
import {
  normalizeDeviceId,
  parseFleetWorktreeCap,
  type FleetWorktreeCapRead,
} from "./fleetWorktreeCap";

export const FLEET_WORKTREE_CAP_API = `${OPERATIONS_API}/fleet/worktree-cap`;
export const FLEET_WORKTREE_CAP_CLEAR_API = `${OPERATIONS_API}/fleet/worktree-cap/clear`;

/** Poll cadence. Slow on purpose — see the module doc. */
export const FLEET_WORKTREE_CAP_POLL_MS = 30_000;

const LOADING: FleetWorktreeCapRead = { state: "loading" };

export interface UseFleetWorktreeCapResult {
  read: FleetWorktreeCapRead;
  /** Force a re-read. Wired to the control so a write is visible at once. */
  refresh: () => Promise<void>;
}

export function useFleetWorktreeCap(): UseFleetWorktreeCapResult {
  const [read, setRead] = useState<FleetWorktreeCapRead>(LOADING);

  const poll = useCallback(async (isCurrent: () => boolean) => {
    let next: FleetWorktreeCapRead;
    try {
      const res = await httpClient.fetch(
        FLEET_WORKTREE_CAP_API,
        COORD_DASHBOARD_POLL_OPTIONS
      );
      if (res.status === 404) {
        next = {
          state: "unknown",
          reason:
            "Coord serves no per-device worktree-cap read on this deployment " +
            "(GET /coord/fleet/worktree-cap answered 404). Devices may still " +
            "carry a cap — this build simply cannot ask. Expected while coord " +
            "is a deploy behind this console.",
        };
      } else if (!res.ok) {
        next = {
          state: "unknown",
          reason:
            `The worktree-cap read returned HTTP ${res.status}, so no ` +
            "device's cap could be determined from it.",
        };
      } else {
        // Two arms rather than a nullable payload: an unreadable body and a
        // body that reads as `undefined` are the same UNKNOWN to the operator,
        // but only one of them has a message worth showing.
        let parsed: unknown;
        try {
          parsed = await res.json();
        } catch (err) {
          throw new Error(
            `the worktree-cap read did not return valid JSON: ${
              err instanceof Error ? err.message : "parse error"
            }`
          );
        }
        next = parseFleetWorktreeCap(parsed);
      }
    } catch (err) {
      next = {
        state: "unknown",
        reason: `Coord's per-device worktree caps could not be read — ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    if (isCurrent()) setRead(next);
  }, []);

  const { refresh } = useSingleFlightPoll(poll, FLEET_WORKTREE_CAP_POLL_MS);

  return { read, refresh };
}

/**
 * The outcome of a cap write, as the control renders it.
 *
 * `changed` is TRI-STATE, not a boolean: `"unknown"` is a success whose body
 * could not be read, which is a different fact from either outcome coord
 * reports. Without that arm a `json()` failure had to be defaulted to one of
 * them, and the sibling drain hook's default (`true`) is justified by what it
 * avoids claiming — "the reading that does not claim a no-op happened" — while
 * the CLEAR path then renders "Cap removed", which is the matching positive
 * claim about a response nobody read. A third value is the only way to render
 * that honestly.
 */
export type WorktreeCapWriteResult =
  | { ok: true; changed: boolean | "unknown" }
  | { ok: false; status: number | null; body: string };

/**
 * `POST /api/v1/operations/fleet/worktree-cap`.
 *
 * The body is assembled here from the three fields coord's request struct
 * declares and nothing else: that struct is `#[serde(deny_unknown_fields)]`, so
 * one hopeful extra key is a 422 for the whole write. `set_by` is deliberately
 * absent — coord stamps the author from the authenticated operator context, and
 * an audit trail with a client-asserted author is not an audit trail.
 */
export async function postWorktreeCap(input: {
  deviceId: string;
  maxWorktrees: number;
  reason: string;
}): Promise<WorktreeCapWriteResult> {
  return postCapChange(FLEET_WORKTREE_CAP_API, {
    // Normalised, like the READ side keys its map. The ids on this page come
    // from several joins; one carrying surrounding whitespace would resolve
    // `capped` in the state line and then 422 on the write, which reads as coord
    // refusing an operator rather than as a local id that was never trimmed.
    device_id: normalizeDeviceId(input.deviceId),
    max_worktrees: input.maxWorktrees,
    reason: input.reason,
  });
}

/**
 * `POST /api/v1/operations/fleet/worktree-cap/clear`. Coord requires a reason
 * here too: removing a cap is as much an operator decision as setting one.
 */
export async function postClearWorktreeCap(input: {
  deviceId: string;
  reason: string;
}): Promise<WorktreeCapWriteResult> {
  return postCapChange(FLEET_WORKTREE_CAP_CLEAR_API, {
    device_id: normalizeDeviceId(input.deviceId),
    reason: input.reason,
  });
}

async function postCapChange(
  url: string,
  body: Record<string, string | number>
): Promise<WorktreeCapWriteResult> {
  try {
    const res = await httpClient.fetch(url, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // The response TEXT, not just the status. Route-missing,
      // `device_not_in_tenant`, `admin_required` and `schema_pending` are four
      // different remediations that render identically without it.
      return { ok: false, status: res.status, body: await res.text() };
    }
    // Coord reports `changed: false` for a request that altered nothing — a
    // clear of a device that carried no cap, or a re-set of the same number.
    // Passed through rather than dressed up as a change, so the operator can
    // tell "I set it" from "it was already that".
    let changed: boolean | "unknown" = "unknown";
    try {
      const payload: unknown = await res.json();
      if (
        typeof payload === "object" &&
        payload !== null &&
        "changed" in payload &&
        typeof (payload as { changed: unknown }).changed === "boolean"
      ) {
        changed = (payload as { changed: boolean }).changed;
      }
    } catch {
      // A success with an unreadable body still SUCCEEDED — the write landed —
      // but which of coord's two outcomes it was is UNKNOWN, and `"unknown"` is
      // how the control is told so. Defaulting to either boolean would make the
      // toast assert something no code here observed
      // [policy: verification-and-evidence unknown-must-not-render-as-a-default].
    }
    return { ok: true, changed };
  } catch (err) {
    return {
      ok: false,
      status: null,
      body: err instanceof Error ? err.message : String(err),
    };
  }
}
