import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import type {
  SubprojectMemberGate,
  SubprojectMemberSession,
  SubprojectSummary,
} from "@/lib/api/operations/coordSubprojects";
import {
  NO_COUNTS,
  SUBPROJECT_ATTENTION_BY_HEADLINE,
  SUBPROJECT_GATE_ATTENTION_BY_KIND,
  SUBPROJECT_GATE_PALETTE,
  SUBPROJECT_HEADLINES,
  SUBPROJECT_HEADLINE_PALETTE,
  SUBPROJECT_SESSION_ATTENTION_BY_KIND,
  SUBPROJECT_SESSION_PALETTE,
  classifySubprojectReadFailure,
  countText,
  defaultContinueRepos,
  deriveMemberGateStatus,
  deriveMemberSessionStatus,
  deriveSubprojectStatus,
  deriveSubprojectsHealth,
  deriveVerdictStatus,
  describeStalledLine,
  foldedReason,
  githubPrUrl,
  headlineKindOf,
  isRouteMissing,
  joinedViaWords,
  memberSessionKey,
  nextStepWords,
  phasesRemainingWords,
  readFailureWords,
  reasonWords,
  refTarget,
  safeExternalUrl,
  sessionWorkWords,
  sessionsText,
  sortMemberGates,
  sortMemberSessions,
  tabOf,
  unreadSources,
  viewQuery,
  type SubprojectCounts,
} from "./subprojectStatus";

/** A rejection exactly as `readJson` throws one. */
function rejection(
  status: number,
  body: string,
  url = "/api/v1/operations/subprojects"
) {
  return new Error(`GET ${url} failed: ${status} - ${body}`);
}

function summary(over: Partial<SubprojectSummary> = {}): SubprojectSummary {
  return {
    id: "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
    slug: "dashboards",
    title: "dashboards-and-presentation",
    title_source: "root_session",
    goal: null,
    origin: "operator_prompt",
    status: "open",
    merged_into: null,
    root_agent_session_id: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-08T00:00:00Z",
    closed_at: null,
    headline: "stalled",
    top_reason: {
      kind: "gate_dependency_unowned",
      summary: "Waiting on qontinui-runner#2569, whose author session closed",
      refs: [],
      detail: null,
    },
    reasons_count: 1,
    sessions: { live: 0, total: 3 },
    work_units: { total: 2, open: 1 },
    last_activity_at: "2026-11-08T00:00:00Z",
    verdict_as_of: "2026-11-08T15:00:00Z",
    ...over,
  };
}

describe("the three palettes agree with their attention tables (§4.2)", () => {
  it.each([
    ["headline", SUBPROJECT_ATTENTION_BY_HEADLINE, SUBPROJECT_HEADLINE_PALETTE],
    [
      "member session",
      SUBPROJECT_SESSION_ATTENTION_BY_KIND,
      SUBPROJECT_SESSION_PALETTE,
    ],
    ["member gate", SUBPROJECT_GATE_ATTENTION_BY_KIND, SUBPROJECT_GATE_PALETTE],
  ] as const)("%s", (_name, table, palette) => {
    expect(
      paletteDisagreements(
        table as Readonly<Record<string, "author" | "waiting" | "none">>,
        palette as unknown as {
          badgeClass: Readonly<Record<string, string>>;
          authorGlyphKinds: ReadonlySet<string>;
        }
      )
    ).toEqual([]);
  });

  it("paints needs_you and stalled red, waiting and unknown amber, working and done calm", () => {
    expect(SUBPROJECT_ATTENTION_BY_HEADLINE).toEqual({
      needs_you: "author",
      stalled: "author",
      waiting: "waiting",
      unknown: "waiting",
      working: "none",
      done: "none",
    });
  });

  it("tells waiting (it clears itself) from unknown (we cannot tell) by the amber they use", () => {
    expect(SUBPROJECT_HEADLINE_PALETTE.badgeClass.waiting).not.toBe(
      SUBPROJECT_HEADLINE_PALETTE.badgeClass.unknown
    );
  });
});

describe("headlines", () => {
  it("knows exactly coord's vocabulary", () => {
    for (const h of SUBPROJECT_HEADLINES) expect(headlineKindOf(h)).toBe(h);
    expect(headlineKindOf("halted")).toBeNull();
    expect(headlineKindOf(undefined)).toBeNull();
  });

  it("words a cached verdict and carries its top reason", () => {
    const s = deriveSubprojectStatus(summary());
    expect(s).toEqual({
      kind: "stalled",
      label: "Stalled",
      reason: "Waiting on qontinui-runner#2569, whose author session closed",
      attention: "author",
    });
  });

  it("reads a verdict the tick has not reached as unknown, never as its stored headline", () => {
    const s = deriveSubprojectStatus(
      summary({ headline: "working", verdict_as_of: null })
    );
    expect(s.kind).toBe("unknown");
    expect(s.attention).toBe("waiting");
    expect(s.reason).toMatch(/not computed a verdict/);
  });

  it("floors a headline this build does not know at amber and names it", () => {
    const s = deriveSubprojectStatus(summary({ headline: "halted" }));
    expect(s.kind).toBe("unknown");
    expect(s.attention).toBe("waiting");
    expect(s.reason).toContain('"halted"');
  });

  it("never leaves a red headline without words", () => {
    expect(deriveSubprojectStatus(summary({ top_reason: null })).reason).toBe(
      "coord gave no reason"
    );
    expect(
      deriveSubprojectStatus(summary({ headline: "working", top_reason: null }))
        .reason
    ).toBeUndefined();
  });

  it("derives the detail's status from the LIVE verdict", () => {
    expect(
      deriveVerdictStatus({
        headline: "needs_you",
        reasons: [
          { kind: "needs_operator", summary: "", refs: [], detail: null },
        ],
        as_of: "2026-11-08T15:00:00Z",
      })
    ).toMatchObject({
      kind: "needs_you",
      label: "Needs you",
      reason: "Waiting on your answer",
    });
    expect(deriveVerdictStatus(null).kind).toBe("unknown");
  });
});

describe("reasons", () => {
  it("words every reason kind the contract names", () => {
    for (const kind of [
      "gate_dependency_unowned",
      "gate_unsatisfiable",
      "gate_failed_unreplaced",
      "gate_should_have_fired",
      "continuation_not_running",
      "abandoned",
      "session_stuck",
      "needs_operator",
      "source_unreadable",
    ]) {
      expect(reasonWords(kind).recognised, kind).toBe(true);
    }
  });

  it("keeps an unknown kind's own token rather than inventing a meaning", () => {
    expect(reasonWords("new_reason_kind")).toEqual({
      label: "coord reason: new reason kind",
      recognised: false,
    });
    // An own-property check: a kind spelled like an Object method is not one.
    expect(reasonWords("constructor").recognised).toBe(false);
  });
});

describe("refs open where they belong", () => {
  it("links sessions, gates, subprojects and questions inside the console", () => {
    expect(refTarget({ type: "session", id: "6c3e0aac", label: "" })).toEqual({
      kind: "internal",
      href: "/sessions/6c3e0aac",
    });
    expect(refTarget({ type: "gate", id: "132fc978", label: "" })).toEqual({
      kind: "internal",
      href: "/admin/coord/gates?gate=132fc978",
    });
    expect(refTarget({ type: "subproject", id: "x y", label: "" })).toEqual({
      kind: "internal",
      href: "/admin/coord/subprojects/x%20y",
    });
    expect(refTarget({ type: "question", id: "q1", label: "" })).toEqual({
      kind: "internal",
      href: "/admin/coord/questions/q1",
    });
  });

  it("links a PR to GitHub, preferring coord's own https url", () => {
    expect(
      refTarget({ type: "pr", id: "qontinui/qontinui-runner#2569", label: "" })
    ).toEqual({
      kind: "external",
      href: "https://github.com/qontinui/qontinui-runner/pull/2569",
    });
    expect(
      refTarget(
        { type: "pr", id: "qontinui/qontinui-web#7", label: "" },
        {
          prs: [
            {
              repo: "qontinui/qontinui-web",
              number: 7,
              url: "https://ghe.example/qontinui/qontinui-web/pull/7",
            },
          ],
        }
      )
    ).toEqual({
      kind: "external",
      href: "https://ghe.example/qontinui/qontinui-web/pull/7",
    });
    expect(refTarget({ type: "pr", id: "not a pr", label: "" }).kind).toBe(
      "none"
    );
  });

  it("never renders a non-https url coord sent as a link", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("http://github.com/a/b/pull/1")).toBeNull();
    expect(safeExternalUrl("https://github.com/a/b/pull/1")).toBe(
      "https://github.com/a/b/pull/1"
    );
    expect(githubPrUrl("a/b#12")).toBe("https://github.com/a/b/pull/12");
  });

  it("opens a work unit by slug, and only when its slug is known", () => {
    const units = [
      {
        work_unit_id: "11111111-1111-4111-8111-111111111111",
        slug: "2026-10-27-spawn-time",
      },
    ];
    expect(
      refTarget(
        {
          type: "work_unit",
          id: "11111111-1111-4111-8111-111111111111",
          label: "",
        },
        { units }
      )
    ).toEqual({
      kind: "internal",
      href: "/admin/coord/work-units/2026-10-27-spawn-time",
    });
    expect(
      refTarget({ type: "work_unit", id: "2026-11-08-a-slug", label: "" })
    ).toEqual({
      kind: "internal",
      href: "/admin/coord/work-units/2026-11-08-a-slug",
    });
    expect(
      refTarget({
        type: "work_unit",
        id: "22222222-2222-4222-8222-222222222222",
        label: "",
      }).kind
    ).toBe("none");
  });

  it("says why a ref of a type it does not know cannot open", () => {
    const t = refTarget({ type: "deploy", id: "d1", label: "" });
    expect(t).toEqual({
      kind: "none",
      why: 'a reference of kind "deploy" that this page cannot open',
    });
  });
});

describe("next steps", () => {
  it("names each step's source and remedy", () => {
    expect(
      nextStepWords({ source: "remedy", remedy_kind: "spawn_to_adopt_pr" })
    ).toEqual({
      source: "To restart it",
      remedy: "Spawn a session to adopt the pull request",
    });
    expect(nextStepWords({ source: "note", remedy_kind: null })).toEqual({
      source: "Note",
      remedy: null,
    });
  });

  it("says unknown, never none, for phases coord could not read", () => {
    expect(phasesRemainingWords(null)).toBe("phases left unknown");
    expect(phasesRemainingWords([])).toBe("no phases left");
    expect(phasesRemainingWords([5])).toBe("phase 5 left");
    expect(phasesRemainingWords([5, 6])).toBe("phases 5, 6 left");
  });
});

function session(
  over: Partial<SubprojectMemberSession> = {}
): SubprojectMemberSession {
  return {
    agent_session_id: "6c3e0aac-0000-4000-8000-000000000001",
    coord_session_id: null,
    allocation_agent_id: null,
    pending: false,
    name: "dashboards-and-presentations-27-10",
    device_id: null,
    device_name: "spaceship",
    liveness: "closed",
    session_status: "finished",
    finish_reason: null,
    first_seen: "2026-10-27T09:00:00Z",
    last_seen: "2026-11-08T10:49:00Z",
    closed_at: "2026-11-08T10:49:00Z",
    joined_via: "root",
    via_ref: null,
    added_at: "2026-10-27T09:00:00Z",
    ...over,
  };
}

describe("member sessions", () => {
  it("puts liveness in the hue and work in the words", () => {
    expect(deriveMemberSessionStatus(session())).toEqual({
      kind: "closed",
      label: "Closed",
      reason: "finished",
      attention: "none",
    });
    expect(
      deriveMemberSessionStatus(
        session({ liveness: "live", session_status: "working" })
      ).kind
    ).toBe("live");
  });

  it("reads a NULL work status as unknown, never unfinished", () => {
    expect(sessionWorkWords(null)).toBe("work status not recorded");
    expect(
      deriveMemberSessionStatus(session({ session_status: null })).reason
    ).toBe("work status not recorded");
  });

  it("shows a spawned allocation as pending until the runner reports it", () => {
    const s = deriveMemberSessionStatus(
      session({
        pending: true,
        agent_session_id: null,
        liveness: "unknown",
        allocation_agent_id: "a1",
      })
    );
    expect(s).toMatchObject({
      kind: "pending",
      label: "Pending",
      attention: "waiting",
    });
  });

  it("floors a liveness this build does not know at amber and names it", () => {
    const s = deriveMemberSessionStatus(session({ liveness: "zombie" }));
    expect(s.kind).toBe("unknown");
    expect(s.reason).toContain('"zombie"');
  });

  it("lists open sessions first and closed last, newest first within each", () => {
    const sorted = sortMemberSessions([
      session({ name: "closed-old", last_seen: "2026-10-01T00:00:00Z" }),
      session({ name: "live", liveness: "live" }),
      session({ name: "closed-new", last_seen: "2026-11-01T00:00:00Z" }),
      session({ name: "pending", pending: true }),
    ]);
    expect(sorted.map((s) => s.name)).toEqual([
      "live",
      "pending",
      "closed-new",
      "closed-old",
    ]);
  });

  it("opens a member by its harness id, else its coord id, else not at all", () => {
    expect(memberSessionKey(session())).toBe(
      "6c3e0aac-0000-4000-8000-000000000001"
    );
    expect(
      memberSessionKey(
        session({ agent_session_id: null, coord_session_id: "c1" })
      )
    ).toBe("c1");
    expect(memberSessionKey(session({ agent_session_id: null }))).toBeNull();
  });

  it("words how a member joined", () => {
    expect(joinedViaWords("gate_continuation")).toBe(
      "a member gate's continuation"
    );
    expect(joinedViaWords("brand_new_way")).toBe("brand new way");
  });
});

function gate(over: Partial<SubprojectMemberGate> = {}): SubprojectMemberGate {
  return {
    gate_id: "132fc978-0000-4000-8000-000000000001",
    phase_name: "Phase 5",
    predicate_kind: "pr_merged",
    verdict: "pending",
    attribution: "proven",
    registered_by_session: null,
    mover: {
      state: "watched",
      summary: "qontinui-runner#2569 is in the merge train",
    },
    continuation_state: null,
    ...over,
  };
}

describe("member gates", () => {
  it("paints a gate nothing is moving red with its dead dependency", () => {
    const s = deriveMemberGateStatus(
      gate({
        mover: { state: "not_watched", summary: "author session closed" },
      })
    );
    expect(s).toEqual({
      kind: "not_watched",
      label: "Nothing moving it",
      reason: "author session closed",
      attention: "author",
    });
  });

  it("words a terminal gate by its verdict, calm", () => {
    expect(deriveMemberGateStatus(gate({ verdict: "failed" }))).toMatchObject({
      kind: "closed",
      label: "Failed",
      attention: "none",
    });
  });

  it("floors an unrecognised mover state at amber and names it", () => {
    const s = deriveMemberGateStatus(
      gate({ mover: { state: "orbiting", summary: "" } })
    );
    expect(s.kind).toBe("unknown");
    expect(s.reason).toContain('"orbiting"');
  });

  it("lists open gates first, the one nothing is moving at the top", () => {
    const sorted = sortMemberGates([
      gate({ gate_id: "cleared", verdict: "cleared" }),
      gate({ gate_id: "watched" }),
      gate({ gate_id: "dead", mover: { state: "not_watched", summary: "" } }),
    ]);
    expect(sorted.map((g) => g.gate_id)).toEqual([
      "dead",
      "watched",
      "cleared",
    ]);
  });
});

describe("Continue's default repos", () => {
  it("takes each PR's repo name once, first appearance first", () => {
    expect(
      defaultContinueRepos([
        { repo: "qontinui/qontinui-web" },
        { repo: "qontinui/qontinui-coord" },
        { repo: "qontinui/qontinui-web" },
      ])
    ).toEqual(["qontinui-web", "qontinui-coord"]);
    expect(defaultContinueRepos([])).toEqual([]);
  });
});

describe("sources", () => {
  it("lists every source the verdict could not read", () => {
    expect(
      unreadSources([
        { source: "gates", state: "read", as_of: null, error: null },
        {
          source: "sessions",
          state: "could_not_read",
          as_of: null,
          error: "deadline",
        },
      ]).map((s) => s.source)
    ).toEqual(["sessions"]);
  });
});

describe("list views", () => {
  it("reads active headlines among open subprojects, and Done and All across every status", () => {
    expect(viewQuery("stalled", 1).toString()).toBe(
      "status=open&headline=stalled&limit=1"
    );
    expect(viewQuery("done", 50).toString()).toBe(
      "status=all&headline=done&limit=50"
    );
    expect(viewQuery("all", 50, "c1").toString()).toBe(
      "status=all&limit=50&cursor=c1"
    );
    expect(viewQuery("unknown", 1).toString()).toBe(
      "status=open&headline=unknown&limit=1"
    );
  });

  it("defaults the tab to All", () => {
    expect(tabOf(null)).toBe("all");
    expect(tabOf("stalled")).toBe("stalled");
    expect(tabOf("bogus")).toBe("all");
  });

  it("folds one-offs, scheduled and merged subprojects into All only", () => {
    expect(foldedReason(summary())).toBeNull();
    expect(foldedReason(summary({ origin: "scheduled" }))).toMatch(/scheduled/);
    expect(foldedReason(summary({ merged_into: "x" }))).toMatch(/merged/);
    expect(
      foldedReason(
        summary({
          headline: "done",
          sessions: { live: 0, total: 1 },
          work_units: { total: 0, open: 0 },
        })
      )
    ).toMatch(/one-off/);
    // An unknown count is not evidence of a one-off.
    expect(
      foldedReason(
        summary({
          headline: "done",
          sessions: { live: 0, total: null },
          work_units: { total: 0, open: 0 },
        })
      )
    ).toBeNull();
  });

  it("renders an uncounted number as a dash, never a zero", () => {
    expect(countText(null)).toBe("–");
    expect(countText(0)).toBe("0");
    expect(sessionsText({ live: null, total: 3 })).toBe("–/3");
  });
});

describe("read failures", () => {
  it("names a pending migration as what it is", () => {
    const f = classifySubprojectReadFailure(
      rejection(503, '{"error":"schema_migration_pending"}')
    );
    expect(f).toEqual({ kind: "migration_pending" });
    expect(readFailureWords(f)).toMatch(/not migrated yet/);
  });

  it("reads a spliced envelope and FastAPI's own detail shape alike", () => {
    expect(
      classifySubprojectReadFailure(
        rejection(503, '{"detail":{"error":"schema_migration_pending"}}')
      )
    ).toEqual({ kind: "migration_pending" });
  });

  it("tells a door that is not there from coord answering no such subproject", () => {
    const missing = rejection(
      404,
      '{"error":"no_such_route","path":"/coord/subprojects"}'
    );
    expect(isRouteMissing(missing)).toBe(true);
    expect(classifySubprojectReadFailure(missing)).toEqual({
      kind: "not_served",
      status: 404,
    });
    expect(
      isRouteMissing(
        rejection(404, '{"error":"NOT_FOUND","message":"Not Found"}')
      )
    ).toBe(true);
    expect(
      isRouteMissing(rejection(404, '{"error":"subproject_not_found"}'))
    ).toBe(false);
  });

  it("reads web's own 502/504 as nothing answered, and a network error as no status", () => {
    expect(
      classifySubprojectReadFailure(
        rejection(
          502,
          '{"error":"BAD_GATEWAY","message":"coord is not reachable"}'
        )
      )
    ).toMatchObject({
      kind: "unreachable",
      status: 502,
    });
    expect(
      classifySubprojectReadFailure(new TypeError("Failed to fetch"))
    ).toEqual({
      kind: "unreachable",
      status: null,
      detail: "Failed to fetch",
    });
  });

  it("keeps a refusal's status and coord's code", () => {
    expect(
      classifySubprojectReadFailure(
        rejection(403, '{"error":"tenant_not_resolved"}')
      )
    ).toEqual({
      kind: "refused",
      status: 403,
      code: "tenant_not_resolved",
      detail: "",
    });
  });
});

function counts(over: Partial<SubprojectCounts>): SubprojectCounts {
  return { ...NO_COUNTS, ...over };
}

const ALL_ZERO = counts({
  needs_you: 0,
  stalled: 0,
  working: 3,
  waiting: 2,
  done: 9,
  all: 14,
  unknown: 0,
});

describe("the list's health strip (R1, R6)", () => {
  it("is unknown — amber, dashed — when nothing ever answered, and says why", () => {
    const h = deriveSubprojectsHealth({
      counts: NO_COUNTS,
      unattached: null,
      loaded: false,
      failure: { kind: "migration_pending" },
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toMatch(/not migrated/);
    expect(h.detail).toMatch(/dash, not a zero/);
    expect(h.readIsCurrent).toBe(false);
  });

  it("is amber while the first read is in flight", () => {
    expect(
      deriveSubprojectsHealth({
        counts: NO_COUNTS,
        unattached: null,
        loaded: false,
        failure: null,
      }).level
    ).toBe("amber");
  });

  it("is red when anything needs you or is stalled", () => {
    const h = deriveSubprojectsHealth({
      counts: { ...ALL_ZERO, stalled: 2, needs_you: 1 },
      unattached: 0,
      loaded: true,
      failure: null,
    });
    expect(h).toMatchObject({
      level: "red",
      headline: "1 needs you · 2 stalled",
      readIsCurrent: true,
    });
  });

  it("is green only on a MEASURED zero, waiting and working included", () => {
    expect(
      deriveSubprojectsHealth({
        counts: ALL_ZERO,
        unattached: 0,
        loaded: true,
        failure: null,
      })
    ).toMatchObject({
      level: "green",
      headline: "Nothing is stalled or waiting on you",
    });
  });

  it("is amber when a needed count did not come back, never green", () => {
    const h = deriveSubprojectsHealth({
      counts: { ...ALL_ZERO, stalled: null },
      unattached: 0,
      loaded: true,
      failure: null,
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("Some counts did not come back");
  });

  it("is amber when any verdict is unknown", () => {
    const h = deriveSubprojectsHealth({
      counts: { ...ALL_ZERO, unknown: 2 },
      unattached: 0,
      loaded: true,
      failure: null,
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toMatch(/^2 unknown/);
  });

  it("keeps a stale count, dated as the last good read, and is never an all-clear", () => {
    const failure = { kind: "unreachable" as const, status: 502, detail: "" };
    const stale = deriveSubprojectsHealth({
      counts: ALL_ZERO,
      unattached: 0,
      loaded: true,
      failure,
    });
    const staleRed = deriveSubprojectsHealth({
      counts: { ...ALL_ZERO, stalled: 3 },
      unattached: 0,
      loaded: true,
      failure,
    });
    expect(stale.level).toBe("amber");
    expect(stale.headline).toBe(
      "Nothing was stalled or waiting on you at the last good read"
    );
    expect(staleRed.level).toBe("amber");
    expect(staleRed.headline).toBe("At the last good read: 3 stalled");
    // The stale arm and the current arm say different things.
    expect(stale.headline).not.toBe(
      deriveSubprojectsHealth({
        counts: ALL_ZERO,
        unattached: 0,
        loaded: true,
        failure: null,
      }).headline
    );
  });
});

describe("the home count line", () => {
  it("is a dash until a read answers, with the failure's reason", () => {
    expect(
      describeStalledLine({
        count: null,
        loaded: false,
        stale: false,
        failure: null,
      })
    ).toEqual({
      value: "–",
      note: null,
    });
    expect(
      describeStalledLine({
        count: null,
        loaded: false,
        stale: false,
        failure: { kind: "migration_pending" },
      })
    ).toEqual({
      value: "–",
      note: "coord's subproject tables are not migrated yet (schema_migration_pending) — unknown, not zero",
    });
  });

  it("keeps a count across a failed read and says it is the last good one", () => {
    const line = describeStalledLine({
      count: 2,
      loaded: true,
      stale: true,
      failure: { kind: "unreachable", status: 504, detail: "" },
    });
    expect(line.value).toBe("2");
    expect(line.note).toMatch(/^as of the last good read/);
  });

  it("reads an uncounted answer as unknown, not zero", () => {
    expect(
      describeStalledLine({
        count: null,
        loaded: true,
        stale: false,
        failure: null,
      })
    ).toEqual({
      value: "–",
      note: "coord answered without counting them — unknown, not zero",
    });
    expect(
      describeStalledLine({
        count: 0,
        loaded: true,
        stale: false,
        failure: null,
      })
    ).toEqual({
      value: "0",
      note: null,
    });
  });
});
