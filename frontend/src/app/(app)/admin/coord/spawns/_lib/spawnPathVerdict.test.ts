/**
 * spawnPathVerdict — the fold of a path's gates into its effective state, and
 * the gate verdicts it folds. Pinned: UNKNOWN wins over Off and On, Off wins
 * over On, a gate coord does not act on is left out, and a path with nothing
 * governing it is UNKNOWN — never On.
 */

import { describe, expect, it } from "vitest";
import type { GateVerdict, MatrixGate } from "./spawnPathGates";
import { pathVerdict } from "./spawnPathVerdict";
import { fixerDialGate } from "./mergeSettingsGates";
import { autonomyGate } from "./nextStepGates";
import { followupScopeGate } from "./followupGates";
import { EMPTY_READING } from "@/app/(app)/admin/coord/agent-registry/_lib/repoFollowupStatus";
import {
  mergeSettingsBody,
  mergeSettingsRead,
  nextStepBody,
  scopeBody,
} from "../__fixtures__/spawnPaths";

function gateFx(
  title: string,
  verdict: GateVerdict,
  stale = false
): MatrixGate {
  return {
    key: `test:${title}`,
    title,
    where: "",
    scope: "tenant",
    enforced: { kind: "enforce", text: "enforce", title: "" },
    effective: {
      state: verdict,
      text: verdict,
      tone: verdict === "unknown" ? "unknown" : "known",
      stale,
    },
    verdict,
    write: null,
  };
}

describe("pathVerdict", () => {
  it("is On only when every governing gate is on", () => {
    const v = pathVerdict([gateFx("A", "on"), gateFx("B", "on")]);
    expect(v.state).toBe("on");
    expect(v.text).toBe("On");
  });

  it("is UNKNOWN when any gate is unknown, even beside an off one", () => {
    const v = pathVerdict([
      gateFx("Registry", "on"),
      gateFx("Dial", "unknown"),
      gateFx("Flag", "off"),
    ]);
    expect(v.state).toBe("unknown");
    expect(v.title).toContain("the dial is unknown");
  });

  it("is Off when any gate is off and none is unknown, naming every one", () => {
    const v = pathVerdict([
      gateFx("Registry", "on"),
      gateFx("Dial", "off"),
      gateFx("Flag", "off"),
    ]);
    expect(v.state).toBe("off");
    expect(v.title).toBe("Off because the dial and flag are off.");
  });

  it("leaves out a gate coord does not act on", () => {
    expect(
      pathVerdict([gateFx("Registry", "on"), gateFx("Scope", "not_governing")])
        .state
    ).toBe("on");
  });

  it("is UNKNOWN, never On, when nothing governs the path", () => {
    expect(pathVerdict([gateFx("Scope", "not_governing")]).state).toBe(
      "unknown"
    );
  });

  it("carries a stale gate's staleness", () => {
    expect(
      pathVerdict([gateFx("A", "on", true), gateFx("B", "on")]).stale
    ).toBe(true);
  });
});

describe("the gate verdicts it folds", () => {
  it("reads a dial that follows the default by the value coord resolved", () => {
    const on = fixerDialGate(mergeSettingsRead(), undefined, false);
    expect(on.effective.state).toBe("default");
    expect(on.verdict).toBe("on");
    const off = fixerDialGate(
      mergeSettingsRead(
        mergeSettingsBody({ tenant: null, resolved: false, source: "default" })
      ),
      undefined,
      false
    );
    expect(off.verdict).toBe("off");
    const unknown = fixerDialGate(
      mergeSettingsRead(
        mergeSettingsBody({ tenant: null, resolved: false, source: "unknown" })
      ),
      undefined,
      false
    );
    expect(unknown.verdict).toBe("unknown");
  });

  it("reads an autonomy level below Auto as off", () => {
    const read = (level: "auto_decide" | "guidance_only" | "always_escalate") =>
      autonomyGate(
        {
          data: nextStepBody({ pr_fix: { autonomy_level: level } }),
          error: null,
          asOfMs: 1,
          loading: false,
        },
        "pr_fix",
        undefined,
        false
      ).verdict;
    expect(read("auto_decide")).toBe("on");
    expect(read("guidance_only")).toBe("off");
    expect(read("always_escalate")).toBe("off");
  });

  it("reads a follow-up scope in shadow mode as not governing, and under enforce by its repositories", () => {
    const followup = (
      mode: "shadow" | "enforce",
      scopes: Array<"all" | "none">
    ) => {
      const repos = scopes.map((_, i) => `owner/repo-${i}`);
      return followupScopeGate(
        {
          loading: false,
          repos,
          reposError: null,
          readings: Object.fromEntries(
            repos.map((r, i) => [
              r,
              {
                ...EMPTY_READING,
                scope: scopeBody(r, { scope: scopes[i], mode }),
              },
            ])
          ),
        },
        false
      ).verdict;
    };
    expect(followup("shadow", ["none", "none"])).toBe("not_governing");
    expect(followup("enforce", ["none", "none"])).toBe("off");
    expect(followup("enforce", ["none", "all"])).toBe("on");
  });
});
