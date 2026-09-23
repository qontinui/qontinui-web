/**
 * spawnPlacement — the refusal and placement derivations behind SpawnModal's
 * automatic/pin choice (plan
 * `2026-09-20-runner-selector-drives-a-transport-not-a-target` Phase 5; coord
 * half qontinui-coord#2403). Bodies below are coord's, copied from
 * `agents_spawn.rs` `route_placement` / `drain_refusal_for` and
 * `spawn_authorization.rs` `drain_refusal_response`.
 */

import { describe, expect, it } from "vitest";
import {
  describeSpawnPlacement,
  describeSpawnRefusal,
  extractCoordRefusal,
  parseRequiredCapabilities,
} from "./spawnPlacement";

const DEV = "eb2155ed-4152-4a91-be82-5d4346f717fc";
const pin = { pinned: true, deviceName: "merytshost", deviceId: DEV };
const auto = { pinned: false, deviceName: "", deviceId: "" };

/** The web app's envelope around a `structured_errors=True` proxy refusal:
 *  coord's keys spliced into the top level (`error_handler.py`). */
function envelope(coord: Record<string, unknown>): string {
  return JSON.stringify({
    message: "{'python': 'repr'}",
    timestamp: 1,
    path: "http://x/api/v1/operations/agents/spawn",
    ...coord,
  });
}

describe("parseRequiredCapabilities", () => {
  it("splits on commas and whitespace, trims and de-duplicates", () => {
    expect(parseRequiredCapabilities(" os:linux, docker  os:linux,,")).toEqual([
      "os:linux",
      "docker",
    ]);
  });
  it("is empty for blank input, so the key is omitted", () => {
    expect(parseRequiredCapabilities("  ,  ")).toEqual([]);
  });
});

describe("extractCoordRefusal", () => {
  const coord = { error: "pin_ineligible", reason: "offline" };
  it("reads the spliced top-level envelope", () => {
    expect(extractCoordRefusal(envelope(coord))?.reason).toBe("offline");
  });
  it("reads FastAPI's bare {detail: {...}}", () => {
    expect(extractCoordRefusal(JSON.stringify({ detail: coord }))).toEqual(
      coord
    );
  });
  it("reads the pre-opt-in proxy, which stringified coord's body into message", () => {
    const text = JSON.stringify({
      error: "conflict",
      message: JSON.stringify(coord),
    });
    expect(extractCoordRefusal(text)).toEqual(coord);
  });
  it("returns null for a body that is not JSON", () => {
    expect(extractCoordRefusal("<html>502</html>")).toBeNull();
  });
});

describe("describeSpawnRefusal — pin_ineligible", () => {
  it("names an offline pin and points at automatic placement", () => {
    const r = describeSpawnRefusal(
      409,
      envelope({
        error: "pin_ineligible",
        device_id: DEV,
        reason: "offline",
        detail: `device ${DEV} has no fresh heartbeat`,
        missing_capabilities: [],
      }),
      pin
    );
    expect(r.kind).toBe("pin_ineligible");
    // R8: hostname in the headline, the raw id on the detail line only.
    expect(r.headline).toBe("merytshost is offline");
    expect(r.headline).not.toContain(DEV);
    expect(r.detail).toContain(`device id ${DEV}`);
    expect(r.detail).toMatch(/no fresh heartbeat/);
    expect(r.remedy).toMatch(/does not move a session off a device you named/);
    expect(r.remedy).toMatch(/automatic placement/);
    expect(r.offerOverride).toBe(false);
  });

  it("lists the missing capabilities", () => {
    const r = describeSpawnRefusal(
      409,
      envelope({
        error: "pin_ineligible",
        reason: "missing_capabilities",
        missing_capabilities: ["docker", "os:windows"],
      }),
      pin
    );
    expect(r.headline).toMatch(
      /lacks required capabilities: docker, os:windows/
    );
  });

  it("says a CI runner is not an agent host", () => {
    const r = describeSpawnRefusal(
      409,
      envelope({ error: "pin_ineligible", reason: "not_an_agent_host" }),
      pin
    );
    expect(r.headline).toMatch(/is a CI runner, not an agent host/);
  });

  it("passes an unrecognised reason through rather than inventing one", () => {
    const r = describeSpawnRefusal(
      409,
      envelope({ error: "pin_ineligible", reason: "brand_new" }),
      pin
    );
    expect(r.headline).toBe("merytshost cannot take this session");
    expect(r.detail).toMatch(/reason: brand_new/);
  });
});

describe("describeSpawnRefusal — no_eligible_device", () => {
  it("no_capable_device names what nobody advertises", () => {
    const r = describeSpawnRefusal(
      409,
      envelope({
        error: "no_eligible_device",
        outcome: "no_capable_device",
        missing_capabilities: ["gpu"],
        online_devices: 2,
      }),
      auto
    );
    expect(r.kind).toBe("no_eligible_device");
    expect(r.headline).toBe("No online device advertises gpu");
    expect(r.remedy).toMatch(/drop the requirement/);
  });

  it("no_capable_device with no requirement says nothing is online", () => {
    const r = describeSpawnRefusal(
      409,
      envelope({ error: "no_eligible_device", outcome: "no_capable_device" }),
      auto
    );
    expect(r.headline).toMatch(/No online device of this tenant/);
  });

  it("all_capable_drained", () => {
    const r = describeSpawnRefusal(
      409,
      envelope({ error: "no_eligible_device", outcome: "all_capable_drained" }),
      auto
    );
    expect(r.headline).toMatch(/is drained/);
    expect(r.offerOverride).toBe(false);
  });

  it("all_capable_at_capacity says a pin is never refused for capacity", () => {
    const r = describeSpawnRefusal(
      409,
      envelope({
        error: "no_eligible_device",
        outcome: "all_capable_at_capacity",
      }),
      auto
    );
    expect(r.headline).toMatch(/session cap/);
    // Plain words for the setting, not the column name (R8).
    expect(r.remedy).not.toMatch(/max_concurrent_agents/);
    expect(r.remedy).toMatch(/limit on concurrent/);
    expect(r.remedy).toMatch(/never refused for capacity/);
  });
});

describe("describeSpawnRefusal — drains", () => {
  const drained = {
    error: "device_drained",
    device_id: DEV,
    until: "2026-09-24T00:00:00Z",
    reason: "rebuild",
    drained_by: "ops@example.com",
    hint: "…",
  };

  it("offers the override for a drained device the operator NAMED", () => {
    const r = describeSpawnRefusal(409, envelope(drained), pin);
    expect(r.kind).toBe("device_drained");
    expect(r.headline).toBe("merytshost is drained");
    expect(r.detail).toContain(`device id ${DEV}`);
    expect(r.detail).toMatch(/reason: rebuild/);
    expect(r.detail).toMatch(/drained by ops@example.com/);
    expect(r.offerOverride).toBe(true);
  });

  it("does NOT offer the override when coord placed the session", () => {
    const r = describeSpawnRefusal(409, envelope(drained), auto);
    expect(r.offerOverride).toBe(false);
    expect(r.remedy).toMatch(/Spawn again/);
  });

  it("drain_unreadable fails closed and is never overridable", () => {
    for (const ctx of [pin, auto]) {
      const r = describeSpawnRefusal(
        409,
        envelope({
          error: "drain_unreadable",
          hint: "Check GET /coord/fleet/drain.",
        }),
        ctx
      );
      expect(r.kind).toBe("drain_unreadable");
      expect(r.headline).toMatch(/cannot read which devices are drained/);
      expect(r.remedy).toMatch(/does not cover this case/);
      expect(r.offerOverride).toBe(false);
    }
  });
});

describe("describeSpawnRefusal — the rest", () => {
  it("reads a pre-#2403 coord's 422 for a missing target as 'not supported yet'", () => {
    const r = describeSpawnRefusal(
      422,
      "Failed to deserialize the JSON body into the target type: missing field `target_device_id`",
      auto
    );
    expect(r.kind).toBe("automatic_unsupported");
    expect(r.remedy).toMatch(/Name a device/);
  });

  it("falls back to the status and coord's code for anything else", () => {
    const r = describeSpawnRefusal(
      400,
      envelope({ error: "invalid_body", detail: "bad repos" }),
      pin
    );
    expect(r.kind).toBe("other");
    expect(r.headline).toBe("Spawn refused — HTTP 400");
    expect(r.detail).toBe("coord error: invalid_body · bad repos");
  });
});

describe("describeSpawnPlacement", () => {
  const label = (id: string) => `host (${id})`;
  it("says coord placed it", () => {
    const r = describeSpawnPlacement(
      { target_device_id: DEV, placed_by: "coord" },
      label
    );
    expect(r.placedBy).toBe("coord");
    expect(r.text).toBe(`on host (${DEV}) — placed by coord`);
  });
  it("says it went to your pin", () => {
    const r = describeSpawnPlacement(
      { target_device_id: DEV, placed_by: "pin" },
      label
    );
    expect(r.placedBy).toBe("pin");
    expect(r.text).toMatch(/the device you named/);
  });
  it("reports an absent placed_by as not reported, never guessed", () => {
    const r = describeSpawnPlacement({ target_device_id: DEV }, label);
    expect(r.placedBy).toBeNull();
    expect(r.text).toMatch(/did not report who chose/);
  });
});

describe("describeSpawnRefusal — coord never answered", () => {
  it("a 502 is 'did not reach coord', not a refusal", () => {
    const r = describeSpawnRefusal(
      502,
      JSON.stringify({
        // The envelope the app stamps on the proxy's own 502.
        error: "BAD_GATEWAY",
        message: "coord is not reachable",
      }),
      auto
    );
    expect(r.kind).toBe("unreachable");
    expect(r.headline).toBe("The spawn did not reach coord");
    expect(r.detail).toBe("coord is not reachable");
  });
  it("a 504 warns the spawn may have landed", () => {
    const r = describeSpawnRefusal(504, "timeout waiting for coord", pin);
    expect(r.kind).toBe("outcome_unknown");
    expect(r.headline).toMatch(/may or may not have landed/);
    expect(r.remedy).toMatch(/Check the sessions list/);
  });
  it("a 502/503 that carries a coord error code shows coord's error, not 'did not reach coord'", () => {
    for (const status of [502, 503]) {
      const r = describeSpawnRefusal(
        status,
        envelope({ error: "upstream_nats_down", detail: "nats is down" }),
        auto
      );
      expect(r.kind).toBe("other");
      expect(r.headline).not.toMatch(/did not reach coord/);
      expect(r.detail).toContain("coord error: upstream_nats_down");
      expect(r.detail).toContain("nats is down");
    }
  });
  it("a 503 with no coord code is 'did not reach coord'", () => {
    const r = describeSpawnRefusal(
      503,
      JSON.stringify({ error: "SERVICE_UNAVAILABLE", message: "busy" }),
      auto
    );
    expect(r.kind).toBe("unreachable");
  });
});

describe("describeSpawnPlacement — capabilities vs an older coord", () => {
  const label = (id: string) => `host (${id})`;
  it("says plainly the capabilities were NOT checked when placed_by is absent", () => {
    const r = describeSpawnPlacement({ target_device_id: DEV }, label, true);
    expect(r.capabilitiesUnchecked).toBe(true);
    expect(r.text).toMatch(/required capabilities were NOT checked/);
  });
  it("says nothing about capabilities when none were sent", () => {
    const r = describeSpawnPlacement({ target_device_id: DEV }, label, false);
    expect(r.capabilitiesUnchecked).toBe(false);
    expect(r.text).not.toMatch(/capabilities/);
  });
  it("a placed_by answer means they were checked", () => {
    const r = describeSpawnPlacement(
      { target_device_id: DEV, placed_by: "pin" },
      label,
      true
    );
    expect(r.capabilitiesUnchecked).toBe(false);
  });
});
