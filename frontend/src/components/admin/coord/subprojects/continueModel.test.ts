import { describe, expect, it } from "vitest";
import {
  APPLIED_EFFORT_NOT_REPORTED,
  EFFORTS,
  buildContinueRequestBody,
  canSubmitContinue,
  describeContinuePlacement,
  describeContinueRefusal,
  describeEffortDefault,
  describeEffortOutcome,
  effortDefaultAfterReadFailure,
  effortDefaultFromProfiles,
  parseRepoList,
  readContinueResponse,
} from "./continueModel";

/** The served playbook's shape (`agent_playbook/spawn-effort-profiles`),
 *  with the one fenced block the runner reads. */
function playbook(block: string, extra = ""): { body: string } {
  return {
    body: `# Spawn effort profiles\n\nProse.\n\n\`\`\`spawn-effort\n${block}\n\`\`\`\n${extra}`,
  };
}

const SERVED_BLOCK = JSON.stringify({
  version: 1,
  default: "implementation",
  profiles: {
    research: { effort: "max", ultracode: true },
    implementation: { effort: "max", ultracode: false },
  },
  skills: { "research-plan": "research" },
});

describe("the default effort", () => {
  it("is the implementation profile of the served playbook", () => {
    expect(effortDefaultFromProfiles(playbook(SERVED_BLOCK))).toEqual({
      source: "profile",
      effort: "max",
      ultracode: false,
      profile: "implementation",
      note: null,
    });
  });

  it("takes the FIRST of two blocks, as the planned runner reader will, and says so", () => {
    const second = JSON.stringify({
      version: 1,
      profiles: { implementation: { effort: "low", ultracode: false } },
    });
    const d = effortDefaultFromProfiles(
      playbook(SERVED_BLOCK, `\n\`\`\`spawn-effort\n${second}\n\`\`\``)
    );
    expect(d).toMatchObject({ source: "profile", effort: "max" });
    if (d.source === "profile")
      expect(d.note).toBe(
        "The document has 2 spawn-effort blocks; the first is used."
      );
    expect(describeEffortDefault(d)).toBe(
      "Default max: the implementation profile of agent_playbook/spawn-effort-profiles. The document has 2 spawn-effort blocks; the first is used."
    );
  });

  it("reads coord's agent-door shape, which wraps the document", () => {
    expect(
      effortDefaultFromProfiles({ document: playbook(SERVED_BLOCK) }).source
    ).toBe("profile");
  });

  it("carries the profile's ultracode", () => {
    const block = JSON.stringify({
      version: 1,
      profiles: { implementation: { effort: "high", ultracode: true } },
    });
    expect(effortDefaultFromProfiles(playbook(block))).toMatchObject({
      effort: "high",
      ultracode: true,
    });
  });

  it.each([
    ["no body", { title: "x" }, /without a body/],
    ["no block", { body: "# no block here" }, /no spawn-effort block/],
    ["bad JSON", playbook("{not json"), /not valid JSON/],
    [
      "version 2",
      playbook(JSON.stringify({ version: 2, profiles: {} })),
      /version 2/,
    ],
    [
      "no implementation profile",
      playbook(
        JSON.stringify({
          version: 1,
          profiles: { research: { effort: "max" } },
        })
      ),
      /no implementation profile/,
    ],
    [
      "an effort coord does not accept",
      playbook(
        JSON.stringify({
          version: 1,
          profiles: { implementation: { effort: "ludicrous" } },
        })
      ),
      /"ludicrous" is not one of/,
    ],
    [
      "a non-boolean ultracode",
      playbook(
        JSON.stringify({
          version: 1,
          profiles: { implementation: { effort: "max", ultracode: "yes" } },
        })
      ),
      /ultracode is not true or false/,
    ],
  ])("falls back to high, and says why, on %s", (_case, doc, why) => {
    const d = effortDefaultFromProfiles(doc);
    expect(d.source).toBe("fallback");
    expect(d.effort).toBe("high");
    expect(d.ultracode).toBe(false);
    if (d.source === "fallback") expect(d.reason).toMatch(why);
  });

  it("names a failed read, never presenting the fallback as the profile", () => {
    const d = effortDefaultAfterReadFailure("HTTP 403");
    expect(describeEffortDefault(d)).toBe(
      "Default high: the effort profiles could not be read (HTTP 403)."
    );
    expect(
      describeEffortDefault(effortDefaultFromProfiles(playbook(SERVED_BLOCK)))
    ).toBe(
      "Default max: the implementation profile of agent_playbook/spawn-effort-profiles."
    );
  });

  it("offers exactly coord's effort levels", () => {
    expect(EFFORTS).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });
});

describe("the request body", () => {
  it("omits the device, repos and addendum when empty — coord places, derives and composes", () => {
    expect(
      buildContinueRequestBody({
        effort: "medium",
        ultracode: false,
        deviceId: "  ",
        repos: [],
        addendum: "  ",
      })
    ).toEqual({ effort: "medium", ultracode: false });
  });

  it("sends a pin, the repos as objects and a trimmed addendum", () => {
    expect(
      buildContinueRequestBody({
        effort: "max",
        ultracode: true,
        deviceId: " 00000000-0000-0000-0000-deadbeefcafe ",
        repos: ["qontinui-web", "qontinui-coord"],
        addendum: "  Start from the failed gate.  ",
      })
    ).toEqual({
      effort: "max",
      ultracode: true,
      target_device_id: "00000000-0000-0000-0000-deadbeefcafe",
      repos: [{ repo: "qontinui-web" }, { repo: "qontinui-coord" }],
      prompt_addendum: "Start from the failed gate.",
    });
  });

  it("parses typed repos once each, in order", () => {
    expect(
      parseRepoList("qontinui-web, qontinui-coord\nqontinui-web  ")
    ).toEqual(["qontinui-web", "qontinui-coord"]);
    expect(parseRepoList("   ")).toEqual([]);
  });

  it("enables Continue for automatic placement or a uuid pin, never mid-submit", () => {
    const ready = { effortDefaultSettled: true, effortChosen: false };
    expect(
      canSubmitContinue({ submitting: false, deviceId: "", ...ready })
    ).toBe(true);
    expect(
      canSubmitContinue({
        submitting: false,
        deviceId: "00000000000000000000deadbeefcafe",
        ...ready,
      })
    ).toBe(true);
    expect(
      canSubmitContinue({ submitting: false, deviceId: "laptop", ...ready })
    ).toBe(false);
    expect(
      canSubmitContinue({ submitting: true, deviceId: "", ...ready })
    ).toBe(false);
  });

  it("waits for the effort profiles to answer, unless the operator chose an effort", () => {
    // The read is out: the select shows a fallback nobody chose.
    expect(
      canSubmitContinue({
        submitting: false,
        deviceId: "",
        effortDefaultSettled: false,
        effortChosen: false,
      })
    ).toBe(false);
    // An explicit choice needs no profile.
    expect(
      canSubmitContinue({
        submitting: false,
        deviceId: "",
        effortDefaultSettled: false,
        effortChosen: true,
      })
    ).toBe(true);
  });
});

const CTX = { pinned: false, deviceName: "", deviceId: "" };

describe("refusals, from coord's structured answer", () => {
  it("says a subproject has no repo, and both ways to fix it", () => {
    const r = describeContinueRefusal(
      422,
      JSON.stringify({ error: "subproject_has_no_repo", hint: "send repos[]" }),
      CTX
    );
    expect(r).toMatchObject({
      kind: "subproject_has_no_repo",
      detail: "send repos[]",
    });
    expect(r.remedy).toMatch(/Repos field/);
    expect(r.remedy).toMatch(/attach a work unit/);
  });

  it("reads coord's code wherever the envelope put it", () => {
    for (const body of [
      { error: "invalid_effort" },
      { detail: { error: "invalid_effort" } },
      { message: JSON.stringify({ error: "invalid_effort" }) },
    ]) {
      expect(describeContinueRefusal(422, JSON.stringify(body), CTX).kind).toBe(
        "invalid_effort"
      );
    }
  });

  it("words a capacity refusal", () => {
    expect(
      describeContinueRefusal(
        409,
        JSON.stringify({ error: "no_capacity" }),
        CTX
      )
    ).toMatchObject({
      kind: "no_capacity",
      headline: "Every runner is at its session cap",
    });
  });

  it("hands /agents/spawn's placement codes to its own reader", () => {
    const r = describeContinueRefusal(
      409,
      JSON.stringify({
        error: "pin_ineligible",
        reason: "offline",
        detail: "no heartbeat",
      }),
      { pinned: true, deviceName: "spaceship", deviceId: "d1" }
    );
    expect(r.kind).toBe("pin_ineligible");
    expect(r.headline).toBe("spaceship is offline");
  });

  it("never offers to override a drain, which Continue cannot send", () => {
    const r = describeContinueRefusal(
      409,
      JSON.stringify({ error: "device_drained", reason: "rebuild" }),
      { pinned: true, deviceName: "spaceship", deviceId: "d1" }
    );
    expect(r.kind).toBe("device_drained");
    expect(r.remedy).not.toMatch(/override/i);
    expect(r.remedy).toMatch(/next available runner/);
  });

  it("tells coord's 'no such subproject' from a missing door", () => {
    expect(
      describeContinueRefusal(
        404,
        JSON.stringify({ error: "subproject_not_found" }),
        CTX
      ).kind
    ).toBe("subproject_not_found");
    expect(
      describeContinueRefusal(
        404,
        JSON.stringify({ error: "no_such_route" }),
        CTX
      ).kind
    ).not.toBe("subproject_not_found");
  });

  it("names a pending migration", () => {
    expect(
      describeContinueRefusal(
        503,
        JSON.stringify({ error: "schema_migration_pending" }),
        CTX
      ).kind
    ).toBe("migration_pending");
  });

  it("reads a bare 500 as an unknown outcome, not as coord refusing", () => {
    for (const body of [
      JSON.stringify({ error: "INTERNAL_SERVER_ERROR", message: "boom" }),
      "Internal Server Error",
    ]) {
      const r = describeContinueRefusal(500, body, CTX);
      expect(r.kind).toBe("outcome_unknown");
      expect(r.headline).toMatch(/may or may not have landed/);
    }
    // A 500 that carries coord's own code is still coord's answer.
    expect(
      describeContinueRefusal(500, JSON.stringify({ error: "no_repos" }), CTX)
        .kind
    ).not.toBe("outcome_unknown");
  });

  it("says a timeout may have landed, rather than calling it refused", () => {
    const r = describeContinueRefusal(
      504,
      JSON.stringify({
        error: "GATEWAY_TIMEOUT",
        message: "timeout waiting for coord",
      }),
      CTX
    );
    expect(r.kind).toBe("outcome_unknown");
    expect(r.headline).toMatch(/may or may not have landed/);
  });
});

describe("the acknowledgement", () => {
  it("reads only the fields coord sent, with their types", () => {
    expect(readContinueResponse("nope")).toBeNull();
    expect(
      readContinueResponse({
        allocation_agent_id: "a1",
        placement: "pool",
        effort_requested: "medium",
        ultracode_requested: false,
        repos: ["qontinui-web", 7],
        target_device_id: null,
        extra: true,
      })
    ).toEqual({
      allocation_agent_id: "a1",
      placement: "pool",
      effort_requested: "medium",
      ultracode_requested: false,
      repos: ["qontinui-web"],
      target_device_id: null,
    });
  });

  it("says where the session went and who chose it", () => {
    const label = (id: string) => `host (${id})`;
    expect(
      describeContinuePlacement(
        { placement: "pool", target_device_id: "d1" },
        label
      )
    ).toBe("on host (d1) — placed by coord on the next available runner");
    expect(
      describeContinuePlacement(
        { placement: "pinned", target_device_id: "d1" },
        label
      )
    ).toBe("on host (d1) — the device you named");
    expect(describeContinuePlacement({}, label)).toBe(
      "on a device coord did not name (coord did not say how it placed the session)"
    );
  });

  it("reports the requested effort and never claims it was applied", () => {
    expect(describeEffortOutcome({ effort_requested: "medium" })).toBe(
      "effort requested medium · applied: not reported"
    );
    expect(
      describeEffortOutcome({
        effort_requested: "max",
        ultracode_requested: true,
      })
    ).toBe("effort requested max with ultracode · applied: not reported");
    expect(describeEffortOutcome({})).toBe(
      "effort requested not echoed by coord · applied: not reported"
    );
    expect(APPLIED_EFFORT_NOT_REPORTED).toMatch(
      /never assumed to be the one requested/
    );
  });
});
