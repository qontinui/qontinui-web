/**
 * Who is acting on an open degradation — the words the collapsed row and the
 * section's tally put on screen (one-screen acceptance q4).
 */
import { describe, expect, it } from "vitest";
import {
  remediationClass,
  remediationPhrase,
  remediationShort,
  remediationTallySentence,
  type DegradationView,
} from "./coordHomeStatus";

function row(
  autoRemediation: DegradationView["autoRemediation"],
  declared = false
): DegradationView {
  return {
    id: "x",
    plane: "runner",
    subjectKind: "device",
    subjectName: "box",
    subjectId: "dev",
    headline: "h",
    onsetObservedAt: null,
    lastSeenAt: null,
    ageSecs: null,
    autoRemediation,
    drill: null,
    declared,
    resolvedAt: null,
    durationSecs: null,
  };
}

describe("remediationClass", () => {
  it.each([
    [row(null), "unknown"],
    [row({ bound: null, response: "agent:dev_ops" }), "unknown"],
    [row({ bound: true, response: "agent:dev_ops" }), "bound"],
    [row({ bound: true, response: null }), "bound"],
    [row({ bound: false, response: "operator:page" }), "operator"],
    [row({ bound: false, response: "setting" }), "setting"],
    [row({ bound: false, response: null }), "none"],
    [row({ bound: true, response: "agent:dev_ops" }, true), "declared"],
  ] as const)("%# classifies as %s", (d, want) => {
    expect(remediationClass(d)).toBe(want);
  });

  it("keeps the detail's phrase and the row's short words on one classification", () => {
    expect(remediationPhrase(row(null))).toBe("remediation binding unknown");
    expect(remediationShort(row(null))).toBe("remediation unknown");
    expect(
      remediationShort(row({ bound: true, response: "agent:dev_ops" }))
    ).toBe("agent response bound");
    // The wire token never reaches the words.
    expect(
      remediationShort(row({ bound: true, response: "agent:dev_ops" }))
    ).not.toMatch(/agent:/);
  });
});

describe("remediationTallySentence", () => {
  it("is null with no open row", () => {
    expect(remediationTallySentence([], false)).toBeNull();
    expect(remediationTallySentence([row(null, true)], false)).toBeNull();
  });

  it("counts each class it saw, most automatic first, unknown last", () => {
    expect(
      remediationTallySentence(
        [
          row(null),
          row({ bound: false, response: "operator:x" }),
          row({ bound: true, response: "red_main_fix" }),
          row({ bound: true, response: "agent:dev_ops" }),
          row({ bound: false, response: null }),
        ],
        false
      )
    ).toBe(
      "Of 5 open: 2 with an agent response bound, 1 waiting on an operator, 1 with no automatic response, 1 whose remediation coord did not say."
    );
  });

  it("says the rows shown on a partial block", () => {
    expect(
      remediationTallySentence([row({ bound: true, response: null })], true)
    ).toBe("Of the 1 open shown: 1 with an agent response bound.");
  });
});
