/**
 * repoFollowupStatus — the pure derivations behind the per-repo follow-up
 * dials (plan `2026-09-01-post-merge-followup-spawn-is-repo-and-content-blind`
 * Phase 4b).
 */

import { describe, expect, it } from "vitest";
import {
  FOLLOWUP_SCOPE_ATTENTION_BY_KIND,
  UNKNOWN_DASH,
  buildScopeWrite,
  deliveryCurrentLabel,
  fleetRolloutMode,
  parseGlobLines,
  readErrorText,
  rolloutHeadline,
  scopeStatus,
  summarizeScopes,
  EMPTY_READING,
  type PostMergeFollowupScopeView,
  type RepoDialReading,
} from "./repoFollowupStatus";

function view(
  overrides: Partial<PostMergeFollowupScopeView> = {}
): PostMergeFollowupScopeView {
  return {
    repo: "qontinui/qontinui-dev-notes",
    scope: "all",
    code_paths: [],
    resolved_scope: "default",
    mode: "shadow",
    can_edit: true,
    ...overrides,
  };
}

describe("scopeStatus", () => {
  it("an unread scope is UNKNOWN, never the `all` default", () => {
    const s = scopeStatus(null, {
      error: 'GET x failed: 503 - {"error":"preference_unreadable"}',
    });
    expect(s.kind).toBe("unknown");
    expect(s.label).toBe(UNKNOWN_DASH);
    expect(s.attention).toBe("waiting");
    expect(s.reason).toContain("could not read");
  });

  it("the undeclared default says so in words", () => {
    const s = scopeStatus(view());
    expect(s.kind).toBe("all");
    expect(s.label).toBe("Every merge (default)");
    expect(s.reason).toContain("nobody has set this repo");
    expect(s.attention).toBe("none");
  });

  it("a declared `none` is calm — a setting, not an alarm", () => {
    const s = scopeStatus(view({ scope: "none", resolved_scope: "repo" }));
    expect(s.label).toBe("Never");
    expect(s.attention).toBe("none");
  });

  it("a retained value whose refresh failed is stale and raised to waiting", () => {
    const s = scopeStatus(
      view({
        scope: "code_only",
        resolved_scope: "repo",
        code_paths: ["a/**"],
      }),
      { error: "GET x failed: 502 - down" }
    );
    expect(s.kind).toBe("code_only");
    expect(s.attention).toBe("waiting");
    expect(s.reason).toContain("may be stale");
    expect(s.reason).toContain("1 glob(s)");
  });

  it("a failed read-back is UNKNOWN whatever is retained", () => {
    const s = scopeStatus(view({ scope: "none", resolved_scope: "repo" }), {
      readbackError: "read-back failed: coord returned 503",
    });
    expect(s.kind).toBe("unknown");
    expect(s.label).toBe(UNKNOWN_DASH);
  });

  it("only `unknown` asks for attention", () => {
    expect(FOLLOWUP_SCOPE_ATTENTION_BY_KIND).toEqual({
      all: "none",
      code_only: "none",
      none: "none",
      unknown: "waiting",
    });
  });
});

function reading(
  scope: PostMergeFollowupScopeView | null,
  extra: Partial<RepoDialReading> = {}
): RepoDialReading {
  return { ...EMPTY_READING, scope, ...extra };
}

describe("rollout mode", () => {
  it("shadow says nothing is suppressed", () => {
    const h = rolloutHeadline(fleetRolloutMode([reading(view())]));
    expect(h.label).toBe("Shadow");
    expect(h.detail).toContain("suppresses nothing");
    expect(h.amber).toBe(false);
  });

  it("agrees across repos, and is UNKNOWN on disagreement or a missing mode", () => {
    expect(
      fleetRolloutMode([reading(view()), reading(null), reading(view())]).mode
    ).toBe("shadow");
    const disagree = fleetRolloutMode([
      reading(view()),
      reading(view({ mode: "enforce" })),
    ]);
    expect(disagree.mode).toBeNull();
    expect(disagree.unknownCause).toBe("disagree");
    const missing = fleetRolloutMode([
      reading(view()),
      reading(view({ mode: null })),
    ]);
    expect(missing.unknownCause).toBe("missing");
    expect(rolloutHeadline(missing).detail).toContain(
      "without saying which rollout mode"
    );
  });

  it("names WHY it is unknown — in flight, no repos, or every read failed", () => {
    expect(
      fleetRolloutMode([reading(null)], { loading: true }).unknownCause
    ).toBe("loading");
    expect(fleetRolloutMode([]).unknownCause).toBe("no_repos");
    const failed = fleetRolloutMode([reading(null, { scopeError: "502" })]);
    expect(failed.unknownCause).toBe("all_failed");
    expect(rolloutHeadline(failed).detail).toContain(
      "no repo's scope could be read"
    );
    expect(
      rolloutHeadline(fleetRolloutMode([], { loading: true })).detail
    ).not.toContain("could be read");
  });

  it("a mode carried only by values whose refresh failed is labelled stale", () => {
    const r = fleetRolloutMode([
      reading(view({ mode: "enforce" }), {
        scopeError: "GET x failed: 502 - down",
      }),
    ]);
    expect(r).toEqual({ mode: "enforce", unknownCause: null, stale: true });
    const h = rolloutHeadline(r);
    expect(h.label).toBe("Enforced (stale)");
    expect(h.detail).toContain("last good read");
    expect(h.amber).toBe(true);
  });

  it("fresh values win over stale ones", () => {
    const r = fleetRolloutMode([
      reading(view({ mode: "enforce" }), { scopeError: "502" }),
      reading(view({ mode: "shadow" })),
    ]);
    expect(r).toEqual({ mode: "shadow", unknownCause: null, stale: false });
  });

  it("a failed write read-back does not lend its pre-write mode", () => {
    const r = fleetRolloutMode([
      reading(view({ mode: "enforce" }), { scopeReadbackError: "503" }),
    ]);
    expect(r.mode).toBeNull();
  });
});

describe("summarizeScopes", () => {
  it("counts unread repos as unknown, not as `all`", () => {
    expect(
      summarizeScopes([
        reading(view()),
        reading(view({ scope: "code_only" })),
        reading(view({ scope: "none" })),
        reading(null),
        undefined,
      ])
    ).toEqual({ all: 1, code_only: 1, none: 1, unknown: 2, stale: 0 });
  });

  it("a failed read-back counts as unknown, not as its pre-write scope", () => {
    expect(
      summarizeScopes([
        reading(view({ scope: "all" }), { scopeReadbackError: "503" }),
      ])
    ).toEqual({ all: 0, code_only: 0, none: 0, unknown: 1, stale: 0 });
  });

  it("a retained value whose refresh failed counts, and is flagged stale", () => {
    expect(
      summarizeScopes([reading(view({ scope: "none" }), { scopeError: "502" })])
    ).toEqual({ all: 0, code_only: 0, none: 1, unknown: 0, stale: 1 });
  });
});

describe("buildScopeWrite", () => {
  const repo = "qontinui/qontinui-dev-notes";

  it("code_only always carries its globs", () => {
    expect(buildScopeWrite(repo, "code_only", ["scripts/**"], [])).toEqual({
      body: { repo, scope: "code_only", code_paths: ["scripts/**"] },
    });
  });

  it("code_only with no glob is refused before any request", () => {
    expect("error" in buildScopeWrite(repo, "code_only", [], ["x/**"])).toBe(
      true
    );
  });

  it("all/none with UNCHANGED globs omits them — coord keeps the stored ones", () => {
    expect(buildScopeWrite(repo, "all", ["a/**"], ["a/**"])).toEqual({
      body: { repo, scope: "all" },
    });
  });

  it("all/none with an emptied box sends [] — a clear", () => {
    expect(buildScopeWrite(repo, "none", [], ["a/**"])).toEqual({
      body: { repo, scope: "none", code_paths: [] },
    });
  });
});

describe("parseGlobLines / readErrorText", () => {
  it("drops blank lines and trims", () => {
    expect(parseGlobLines(" scripts/** \n\n.github/**\r\n  ")).toEqual([
      "scripts/**",
      ".github/**",
    ]);
  });

  it("names coord's typed refusals in operator words", () => {
    expect(readErrorText("503 - column_not_present")).toContain(
      "migration is pending"
    );
    expect(readErrorText("GET x failed: 404 - Not Found")).toContain(
      "does not offer"
    );
  });
});

describe("deliveryCurrentLabel", () => {
  it("qualifies a value coord resolved but cannot confirm was set", () => {
    expect(deliveryCurrentLabel("notify_only", false)).toBe(
      "Notify only (resolved, not confirmed)"
    );
  });
  it("renders a confirmed value plainly, and unknown as a dash", () => {
    expect(deliveryCurrentLabel("spawn_always", true)).toBe(
      "Always a new session"
    );
    expect(deliveryCurrentLabel(null, false)).toBe(UNKNOWN_DASH);
  });
});
