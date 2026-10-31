/**
 * The follow-up scope's verdict while coord's rollout mode is itself unknown.
 *
 * Coord might be enforcing the scopes, in which case a repository set to
 * `none` gets no follow-up at all, so `on` is said only when no repository is
 * `none`; anything else is `unknown`, never `on` while a scope could stop it.
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY_READING,
  type RepoDialReading,
} from "@/app/(app)/admin/coord/agent-registry/_lib/repoFollowupStatus";
import { followupScopeVerdict } from "./followupGates";
import type { GateCell, GateEnforcement } from "./spawnPathGates";

type Scope = "all" | "code_only" | "none";

function reading(repo: string, scope: Scope): RepoDialReading {
  return {
    ...EMPTY_READING,
    scope: {
      repo,
      scope,
      code_paths: [],
      resolved_scope: "repo",
      mode: "enforce",
      can_edit: true,
    },
  };
}

const MODE_UNKNOWN: GateEnforcement = {
  kind: "unknown",
  text: "unknown",
  title: "The rollout mode could not be read.",
};
const ENFORCE: GateEnforcement = {
  kind: "enforce",
  text: "enforced",
  title: "",
};
const KNOWN: GateCell = {
  state: "known",
  text: "",
  tone: "known",
  stale: false,
};

function verdict(scopes: Scope[], enforced: GateEnforcement) {
  const repos = scopes.map((_, i) => `acme/repo-${i}`);
  const readings = repos.map((r, i) => reading(r, scopes[i]!));
  return followupScopeVerdict(
    {
      loading: false,
      repos,
      reposError: null,
      readings: Object.fromEntries(repos.map((r, i) => [r, readings[i]!])),
    },
    readings,
    enforced,
    KNOWN
  );
}

describe("followupScopeVerdict with the rollout mode unknown", () => {
  it("is unknown, never on, when every repository is set to none", () => {
    expect(verdict(["none", "none"], MODE_UNKNOWN)).toBe("unknown");
  });

  it("is unknown when any one repository is set to none", () => {
    expect(verdict(["all", "none"], MODE_UNKNOWN)).toBe("unknown");
  });

  it("is on when no repository is set to none", () => {
    expect(verdict(["all", "code_only"], MODE_UNKNOWN)).toBe("on");
  });

  it("reads every none as off once the mode is known to be enforce", () => {
    expect(verdict(["none", "none"], ENFORCE)).toBe("off");
  });
});
