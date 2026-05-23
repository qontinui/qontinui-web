import { describe, it, expect } from "vitest";
import {
  filterEventsByPolicy,
  isClaimStolenVisible,
  type ClaimStolenPayload,
} from "./visibility";
import type { SessionEventRow } from "./types";

/**
 * Visibility filter tests — Phase 6 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * Validates the `claim_steal_visibility` enum semantics:
 *   - `public_to_tenant`: everyone in the tenant
 *   - `involved_only`: only stealer + victim
 *   - `audit_only`: never in the live feed
 */

function evt(payload: ClaimStolenPayload, seq = 1): SessionEventRow {
  return {
    id: seq,
    session_id: "s",
    seq,
    event_kind: "claim_stolen",
    payload: payload as Record<string, unknown>,
    occurred_at: new Date().toISOString(),
  };
}

describe("isClaimStolenVisible", () => {
  it("returns true for public_to_tenant to anyone", () => {
    const visible = isClaimStolenVisible(
      {
        policy: "public_to_tenant",
        stealing_machine_id: "stealer",
        originating_machine_id: "victim",
      },
      { viewerMachineId: "bystander" }
    );
    expect(visible).toBe(true);
  });

  it("returns false for audit_only to anyone (including involved)", () => {
    const visible = isClaimStolenVisible(
      {
        policy: "audit_only",
        stealing_machine_id: "stealer",
        originating_machine_id: "victim",
      },
      { viewerMachineId: "stealer" }
    );
    expect(visible).toBe(false);
  });

  it("involved_only: stealer sees it", () => {
    const visible = isClaimStolenVisible(
      {
        policy: "involved_only",
        stealing_machine_id: "stealer",
        originating_machine_id: "victim",
      },
      { viewerMachineId: "stealer" }
    );
    expect(visible).toBe(true);
  });

  it("involved_only: victim machine sees it via sessionDeviceId", () => {
    const visible = isClaimStolenVisible(
      {
        policy: "involved_only",
        stealing_machine_id: "stealer",
        originating_machine_id: "victim",
      },
      { sessionDeviceId: "victim" }
    );
    expect(visible).toBe(true);
  });

  it("involved_only: bystander does NOT see it", () => {
    const visible = isClaimStolenVisible(
      {
        policy: "involved_only",
        stealing_machine_id: "stealer",
        originating_machine_id: "victim",
      },
      { viewerMachineId: "bystander", sessionDeviceId: "other-session" }
    );
    expect(visible).toBe(false);
  });

  it("missing policy field defaults to public_to_tenant", () => {
    const visible = isClaimStolenVisible(
      {
        stealing_machine_id: "stealer",
        originating_machine_id: "victim",
      },
      { viewerMachineId: "bystander" }
    );
    expect(visible).toBe(true);
  });
});

describe("filterEventsByPolicy", () => {
  it("drops audit_only steals but keeps other event kinds", () => {
    const events: SessionEventRow[] = [
      {
        id: 1,
        session_id: "s",
        seq: 1,
        event_kind: "started",
        payload: {},
        occurred_at: new Date().toISOString(),
      },
      evt({ policy: "audit_only", stealing_machine_id: "x" }, 2),
      {
        id: 3,
        session_id: "s",
        seq: 3,
        event_kind: "heartbeat",
        payload: {},
        occurred_at: new Date().toISOString(),
      },
    ];
    const filtered = filterEventsByPolicy(events, { viewerMachineId: "x" });
    expect(filtered.map((e) => e.seq)).toEqual([1, 3]);
  });

  it("involved_only: only steals where viewer is involved are kept", () => {
    const events: SessionEventRow[] = [
      evt(
        {
          policy: "involved_only",
          stealing_machine_id: "viewer",
          originating_machine_id: "v",
        },
        1
      ),
      evt(
        {
          policy: "involved_only",
          stealing_machine_id: "stranger",
          originating_machine_id: "v",
        },
        2
      ),
    ];
    const filtered = filterEventsByPolicy(events, {
      viewerMachineId: "viewer",
    });
    expect(filtered.map((e) => e.seq)).toEqual([1]);
  });
});
