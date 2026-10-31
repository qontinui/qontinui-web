/**
 * The follow-up scope gate names a write whose outcome is open as what it is:
 * unknown, never a failed read-back and never a value.
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY_READING,
  type RepoDialReading,
} from "@/app/(app)/admin/coord/agent-registry/_lib/repoFollowupStatus";
import { followupScopeGate } from "./followupGates";

const REPO = "acme/widgets";

function reading(extra: Partial<RepoDialReading>): RepoDialReading {
  return {
    ...EMPTY_READING,
    scope: {
      repo: REPO,
      scope: "all",
      code_paths: [],
      resolved_scope: "repo",
      mode: "shadow",
      can_edit: true,
    },
    ...extra,
  };
}

describe("followupScopeGate with an open write outcome", () => {
  it("counts the repository unknown and says whether the write was applied is unknown", () => {
    const gate = followupScopeGate(
      {
        loading: false,
        repos: [REPO],
        reposError: null,
        readings: {
          [REPO]: reading({
            scopeOutcomeUnknown: "timeout waiting for coord",
          }),
        },
      },
      false
    );
    expect(gate.effective.text).toContain("1 unknown");
    expect(gate.effective.title).toContain(
      "whether a write was applied is unknown (timeout waiting for coord)"
    );
    expect(gate.effective.title).not.toContain("read-back failed");
  });
});
