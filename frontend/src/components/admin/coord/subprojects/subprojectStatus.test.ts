import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import type {
  SubprojectMemberGate,
  SubprojectMemberSession,
  SubprojectSummary,
} from "@/lib/api/operations/coordSubprojects";
import {
  NO_COUNTS,
  OPEN_HEADLINES,
  SUBPROJECT_ATTENTION_BY_HEADLINE,
  SUBPROJECT_GATE_ATTENTION_BY_KIND,
  SUBPROJECT_GATE_PALETTE,
  SUBPROJECT_HEADLINES,
  SUBPROJECT_HEADLINE_PALETTE,
  SUBPROJECT_SESSION_ATTENTION_BY_KIND,
  SUBPROJECT_SESSION_PALETTE,
  UNREAD_COUNT,
  answeredCount,
  classifySubprojectReadFailure,
  countNoteOf,
  countText,
  countsFromFacet,
  defaultContinueRepos,
  deriveMemberGateStatus,
  deriveMemberSessionStatus,
  deriveSubprojectStatus,
  deriveSubprojectsHealth,
  deriveVerdictStatus,
  describeEmptyView,
  describeStalledLine,
  facetQuery,
  failedCount,
  foldedReason,
  gateVerdictWords,
  githubPrUrl,
  headlineKindOf,
  historyEventWords,
  isRouteMissing,
  joinedViaWords,
  memberEmptyText,
  memberList,
  memberSessionKey,
  mergeStreamRows,
  nextStepWords,
  ofCountWords,
  openFromParts,
  phasesRemainingWords,
  predicateKindWords,
  readCountsFacet,
  readFailureWords,
  reasonWords,
  refTarget,
  safeExternalUrl,
  sessionWorkWords,
  sessionsText,
  sortMemberGates,
  sortMemberSessions,
  subprojectChipWords,
  tabOf,
  unreadSources,
  viewQuery,
  viewStreams,
  type CountReading,
  type EmptyViewInput,
  type SubprojectCounts,
  type SubprojectReadFailure,
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
  it("reads the not-done headlines among open subprojects, and Done and All across every status", () => {
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

  it("opens on Open — every headline but done — and names every other tab", () => {
    expect(tabOf(null)).toBe("open");
    expect(tabOf("all")).toBe("all");
    expect(tabOf("stalled")).toBe("stalled");
    expect(tabOf("bogus")).toBe("open");
    expect(OPEN_HEADLINES).not.toContain("done");
    expect(viewStreams("waiting")).toEqual(["waiting"]);
  });

  it("reads Open in ONE read that excludes done, and per headline only as the fallback", () => {
    expect(viewStreams("open")).toEqual(["open"]);
    expect(viewQuery("open", 100).toString()).toBe(
      "status=open&exclude_headline=done&limit=100"
    );
    expect(viewQuery("open", 100, "c2").toString()).toBe(
      "status=open&exclude_headline=done&limit=100&cursor=c2"
    );
    // A coord that answers 400/422 to `exclude_headline` gets five reads.
    expect(viewStreams("open", true)).toEqual([...OPEN_HEADLINES]);
    // The flag means nothing for any other tab.
    expect(viewStreams("stalled", true)).toEqual(["stalled"]);
  });

  it("merges Open's streams most-recently-active first, each subproject once", () => {
    const a = summary({ id: "a", last_activity_at: "2026-11-08T10:00:00Z" });
    const b = summary({ id: "b", last_activity_at: "2026-11-08T12:00:00Z" });
    const c = summary({
      id: "c",
      last_activity_at: null,
      updated_at: "2026-11-01T00:00:00Z",
    });
    expect(
      mergeStreamRows([
        [a, c],
        [b, a],
      ]).map((s) => s.id)
    ).toEqual(["b", "a", "c"]);
    // One stream keeps coord's own order.
    expect(mergeStreamRows([[a, b]]).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("folds one-offs (coord's rule), scheduled and merged subprojects into All only", () => {
    const done = { headline: "done" as const };
    expect(foldedReason(summary(done))).toBeNull();
    expect(foldedReason(summary({ ...done, origin: "scheduled" }))).toMatch(
      /scheduled/
    );
    expect(foldedReason(summary({ ...done, merged_into: "x" }))).toMatch(
      /merged/
    );
    // coord's rule as far as a row can show it, when coord sends no flag: a
    // done headline, one member session no longer live, no work unit.
    expect(
      foldedReason(
        summary({
          ...done,
          sessions: { live: 0, total: 1 },
          work_units: { total: 0, open: 0 },
        })
      )
    ).toMatch(/one-off/);
    expect(
      foldedReason(
        summary({
          ...done,
          sessions: { live: 1, total: 1 },
          work_units: { total: 0, open: 0 },
        })
      )
    ).toBeNull();
    // An uncounted half is not evidence of a one-off.
    expect(
      foldedReason(
        summary({
          ...done,
          sessions: { live: 0, total: null },
          work_units: { total: 0, open: 0 },
        })
      )
    ).toBeNull();
    // Not done is never a one-off (coord: "a stalled/needs_you subproject is
    // never a one-off"), working or waiting included.
    for (const headline of ["working", "waiting", "unknown"] as const)
      expect(
        foldedReason(
          summary({
            headline,
            sessions: { live: 0, total: 1 },
            work_units: { total: 0, open: 0 },
          })
        ),
        headline
      ).toBeNull();
  });

  it("NEVER folds a row that needs the operator, whatever else is true of it", () => {
    for (const headline of ["stalled", "needs_you"] as const) {
      for (const over of [
        { sessions: { live: 0, total: 1 }, work_units: { total: 0, open: 0 } },
        { one_off: true },
        { merged_into: "x" },
        { origin: "scheduled" },
      ])
        expect(
          foldedReason(summary({ headline, ...over })),
          `${headline} ${JSON.stringify(over)}`
        ).toBeNull();
    }
  });

  it("takes coord's one_off flag over the row heuristic when it sent one", () => {
    const looksLikeOne = {
      headline: "done" as const,
      sessions: { live: 0, total: 1 },
      work_units: { total: 0, open: 0 },
    };
    // coord says no (its session is closed, not finished): not folded.
    expect(
      foldedReason(summary({ ...looksLikeOne, one_off: false }))
    ).toBeNull();
    // coord says yes where the row cannot show it: folded.
    expect(
      foldedReason(
        summary({
          headline: "done",
          sessions: { live: null, total: null },
          work_units: { total: null, open: null },
          one_off: true,
        })
      )
    ).toMatch(/one-off/);
    // A null flag is coord not knowing: the row's own rule decides.
    expect(foldedReason(summary({ ...looksLikeOne, one_off: null }))).toMatch(
      /one-off/
    );
  });

  it("renders an uncounted number as a dash, never a zero", () => {
    expect(countText(null)).toBe("–");
    expect(countText(0)).toBe("0");
    expect(sessionsText({ live: null, total: 3 })).toBe("–/3");
  });
});

function emptyInput(over: Partial<EmptyViewInput> = {}): EmptyViewInput {
  return {
    tab: "done",
    loaded: true,
    failure: null,
    stale: false,
    query: "",
    loadedRows: 0,
    matched: 0,
    folded: 0,
    more: false,
    ...over,
  };
}

describe("the empty slot says what is true of THIS view", () => {
  it("never says 'No subproject is …' over rows it folded into All", () => {
    // A Done page made only of one-offs.
    const text = describeEmptyView(
      emptyInput({ loadedRows: 2, matched: 2, folded: 2, more: true })
    );
    expect(text).toBe(
      "The 2 subprojects on this page in this view are one-off, scheduled or merged, listed under All. More may be on the next page: Load more."
    );
    expect(text).not.toMatch(/^No subproject/);
    expect(
      describeEmptyView(emptyInput({ loadedRows: 1, matched: 1, folded: 1 }))
    ).toBe(
      "The 1 subproject on this page in this view is one-off, scheduled or merged, listed under All."
    );
  });

  it("says the same for a search whose every match was folded", () => {
    expect(
      describeEmptyView(
        emptyInput({ query: "dash", loadedRows: 5, matched: 1, folded: 1 })
      )
    ).toBe(
      'The 1 subproject matching "dash" on this page in this view is one-off, scheduled or merged, listed under All.'
    );
  });

  it("scopes a search that matched nothing to this page, and points at the next one", () => {
    expect(
      describeEmptyView(
        emptyInput({ query: "zzz", loadedRows: 4, matched: 0, more: true })
      )
    ).toBe(
      'No subproject on this page matches "zzz". More may be on the next page: Load more.'
    );
  });

  it("is unknown when nothing answered, and dated when a kept read failed", () => {
    const failure: SubprojectReadFailure = { kind: "migration_pending" };
    expect(describeEmptyView(emptyInput({ loaded: false, failure }))).toMatch(
      /^Whether any subproject is in this view is unknown: coord's subproject tables are not migrated yet/
    );
    expect(
      describeEmptyView(emptyInput({ tab: "stalled", stale: true, failure }))
    ).toMatch(
      /^No open subproject is stalled at the last good read; the latest read failed/
    );
  });

  it("states the absence only when it was measured", () => {
    expect(describeEmptyView(emptyInput({ tab: "open" }))).toBe(
      "No open subproject is working, waiting, stalled or waiting on you."
    );
  });
});

describe("words for coord's closed vocabularies (R8)", () => {
  it("words a gate's predicate and a history event, and spaces one it does not know", () => {
    expect(predicateKindWords("pr_merged")).toBe("PR merged");
    expect(predicateKindWords("gate_cleared")).toBe("another gate cleared");
    expect(predicateKindWords("new_predicate")).toBe("new predicate");
    expect(historyEventWords("member_moved")).toBe("member moved");
    expect(historyEventWords("created")).toBe("founded");
    expect(historyEventWords("odd_event")).toBe("odd event");
    expect(predicateKindWords("constructor")).toBe("constructor");
  });
});

describe("member lists", () => {
  const unread = [
    {
      source: "session_obligations",
      state: "could_not_read",
      as_of: null,
      error: "deadline",
    },
  ];

  it("reads a list coord did not send as unknown, never as empty", () => {
    expect(memberList(undefined)).toEqual({ items: [], known: false });
    expect(memberList([1, 2])).toEqual({ items: [1, 2], known: true });
    expect(memberEmptyText("member gate", false, [])).toBe(
      "coord did not send this subproject's member gates with this read — unknown, not none."
    );
    expect(memberEmptyText("next step", false, [], "next steps")).toBe(
      "coord did not send this subproject's next steps with this read — unknown, not none."
    );
  });

  it("qualifies 'none' when the verdict could not read a source", () => {
    expect(memberEmptyText("member session", true, [])).toBe(
      "coord lists no member session."
    );
    expect(memberEmptyText("member session", true, unread)).toBe(
      "coord lists no member session, but this verdict could not read session obligations, so the list may be incomplete."
    );
  });
});

describe("the session chip", () => {
  it("links only a member, with its headline in words", () => {
    expect(
      subprojectChipWords({
        kind: "member",
        id: "sp 1",
        title: "dashboards",
        headline: "stalled",
      })
    ).toEqual({
      text: "dashboards",
      title: "Subproject: dashboards — Stalled",
      href: "/admin/coord/subprojects/sp%201",
      label: "subproject: dashboards, stalled",
    });
  });

  it("is a dash that says which, never a guess, for every other state", () => {
    const failure: SubprojectReadFailure = {
      kind: "unreachable",
      status: 502,
      detail: "",
    };
    for (const chip of [
      { kind: "none" as const },
      { kind: "not_applicable" as const },
      { kind: "agent_unknown" as const },
      { kind: "looking_up" as const },
      { kind: "unanswered" as const },
      { kind: "failed" as const, failure },
    ]) {
      const words = subprojectChipWords(chip);
      expect(words.text, chip.kind).toBe("–");
      expect(words.href, chip.kind).toBeNull();
      expect(words.title.length, chip.kind).toBeGreaterThan(10);
      // The accessible name is a short phrase, never the whole sentence.
      expect(words.label, chip.kind).toMatch(/^subproject: [a-z ]+$/);
    }
    expect(subprojectChipWords({ kind: "failed", failure }).title).toMatch(
      /unknown, not none/
    );
    // An agent half that did not answer is unknown, not "no session id".
    expect(subprojectChipWords({ kind: "agent_unknown" }).title).toMatch(
      /^Unknown — the agent half did not answer/
    );
  });
});

describe("a member gate's verdict, in words (R8)", () => {
  it("words coord's verdicts and says when it has no reading for one", () => {
    expect(gateVerdictWords("passed")).toBe("cleared");
    expect(gateVerdictWords("PENDING")).toBe("not cleared yet");
    expect(gateVerdictWords("veto")).toBe("vetoed");
    expect(gateVerdictWords("in_progress")).toBe("being evaluated");
    expect(gateVerdictWords("")).toBe("not reported");
    expect(gateVerdictWords(null)).toBe("not reported");
    expect(gateVerdictWords("half_cleared")).toBe(
      '"half cleared", a verdict this console has no reading for'
    );
  });
});

describe("a count that is not current says so", () => {
  const DOWN: SubprojectReadFailure = {
    kind: "unreachable",
    status: 502,
    detail: "",
  };

  it("qualifies a kept, a failed and an untaken count on its tab — never a current one", () => {
    expect(countNoteOf(answeredCount(4))).toBeNull();
    expect(countNoteOf(UNREAD_COUNT)).toBeNull();
    expect(countNoteOf(failedCount(answeredCount(4), DOWN))).toBe(
      "the last good count; the latest read failed (coord did not answer (HTTP 502))"
    );
    expect(countNoteOf(failedCount(UNREAD_COUNT, DOWN))).toBe(
      "could not be read (coord did not answer (HTTP 502))"
    );
    expect(countNoteOf(answeredCount(null))).toBe(
      "coord did not take this count"
    );
  });

  it("qualifies 'of M' when M is the last good count, and drops it when there is none", () => {
    expect(ofCountWords(answeredCount(8))).toBe(" of 8");
    expect(ofCountWords(failedCount(answeredCount(8), DOWN))).toBe(
      " of 8 (the last good count; its latest read failed)"
    );
    expect(ofCountWords(answeredCount(null))).toBe("");
    expect(ofCountWords(UNREAD_COUNT)).toBe("");
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

const v = (n: number | null): CountReading => answeredCount(n);
const UNREACHABLE: SubprojectReadFailure = {
  kind: "unreachable",
  status: 502,
  detail: "",
};

function counts(over: Partial<SubprojectCounts>): SubprojectCounts {
  return { ...NO_COUNTS, ...over };
}

const ALL_ZERO = counts({
  open: v(5),
  needs_you: v(0),
  stalled: v(0),
  working: v(3),
  waiting: v(2),
  done: v(9),
  all: v(14),
  unknown: v(0),
});

describe("count readings and the facet", () => {
  const FACET = {
    counts: {
      by_headline: {
        needs_you: 1,
        stalled: 2,
        working: 3,
        waiting: 4,
        done: 9,
        unknown: 1,
      },
      folded: { one_off: 5, scheduled: 1, merged: 0 },
      as_of: "2026-11-08T15:00:00Z",
    },
  };

  it("reads a well-formed facet, and refuses an absent, null or malformed one", () => {
    expect(readCountsFacet(FACET)?.by_headline.stalled).toBe(2);
    expect(readCountsFacet({})).toBeNull();
    expect(readCountsFacet({ counts: null })).toBeNull();
    expect(
      readCountsFacet({
        counts: {
          ...FACET.counts,
          by_headline: { ...FACET.counts.by_headline, stalled: "2" },
        },
      })
    ).toBeNull();
  });

  it("answers the not-done views (and Open, their sum) from the open scope, Done and All from the all scope", () => {
    const facet = readCountsFacet(FACET);
    if (!facet) throw new Error("facet");
    expect(countsFromFacet("open", facet, 20)).toEqual({
      needs_you: 1,
      stalled: 2,
      working: 3,
      waiting: 4,
      unknown: 1,
      open: 11,
    });
    expect(countsFromFacet("all", facet, 40)).toEqual({ done: 9, all: 40 });
    expect(facetQuery("open").toString()).toBe("status=open&limit=1");
    expect(facetQuery("all").toString()).toBe("status=all&limit=1");
  });

  it("keeps the last good number across a failed read, and says it failed", () => {
    expect(failedCount(v(3), UNREACHABLE)).toEqual({
      value: 3,
      answered: true,
      failure: UNREACHABLE,
    });
    expect(failedCount(UNREAD_COUNT, UNREACHABLE)).toEqual({
      value: null,
      answered: false,
      failure: UNREACHABLE,
    });
  });

  it("sums Open from its parts only when every part was counted", () => {
    expect(openFromParts([v(1), v(2), v(3), v(0), v(1)])).toEqual(v(7));
    expect(openFromParts([v(1), v(null), v(3), v(0), v(1)])).toEqual({
      value: null,
      answered: true,
      failure: null,
    });
    expect(openFromParts([v(1), UNREAD_COUNT]).answered).toBe(false);
    expect(openFromParts([v(1), failedCount(v(2), UNREACHABLE)]).failure).toBe(
      UNREACHABLE
    );
  });
});

describe("the list's health strip (R1, R6)", () => {
  it("names every OTHER view whose count is not current, grouped by why", () => {
    const h = deriveSubprojectsHealth({
      ...ALL_ZERO,
      done: failedCount(v(9), UNREACHABLE),
      all: failedCount(v(14), UNREACHABLE),
      working: failedCount(UNREAD_COUNT, { kind: "migration_pending" }),
    });
    // The attention verdict is still the needs-you and stalled counts'.
    expect(h.level).toBe("green");
    expect(h.headline).toBe("Nothing is stalled or waiting on you");
    expect(h.detail).toContain(
      "Working could not be read — the latest read failed (coord's subproject tables are not migrated yet (schema_migration_pending))."
    );
    expect(h.detail).toContain(
      "Done and All are the last good counts — the latest read failed (coord did not answer (HTTP 502))."
    );
    // Not every count on screen is this poll's.
    expect(h.readIsCurrent).toBe(false);
    // Nothing stale: nothing named, and the read is current.
    expect(deriveSubprojectsHealth(ALL_ZERO).detail).not.toMatch(
      /last good|could not be read/
    );
    expect(deriveSubprojectsHealth(ALL_ZERO).readIsCurrent).toBe(true);
  });

  it("does not name the needs-you and stalled counts twice", () => {
    const h = deriveSubprojectsHealth({
      ...ALL_ZERO,
      stalled: failedCount(v(2), UNREACHABLE),
    });
    expect(h.detail.match(/stalled count/g)).toHaveLength(1);
    expect(h.detail).not.toMatch(/Stalled is the last good count/);
  });

  it("is unknown — amber, dashed — when nothing ever answered, and says why", () => {
    const h = deriveSubprojectsHealth(
      counts({
        needs_you: failedCount(UNREAD_COUNT, { kind: "migration_pending" }),
        stalled: failedCount(UNREAD_COUNT, { kind: "migration_pending" }),
      })
    );
    expect(h.level).toBe("amber");
    expect(h.headline).toMatch(/not migrated/);
    expect(h.detail).toMatch(/dash, not a zero/);
    expect(h.readIsCurrent).toBe(false);
  });

  it("is amber while the first read is in flight", () => {
    expect(deriveSubprojectsHealth(NO_COUNTS).level).toBe("amber");
  });

  it("is red when anything needs you or is stalled", () => {
    const h = deriveSubprojectsHealth({
      ...ALL_ZERO,
      stalled: v(2),
      needs_you: v(1),
    });
    expect(h).toMatchObject({
      level: "red",
      headline: "1 needs you · 2 stalled",
      readIsCurrent: true,
    });
  });

  it("is green only on a MEASURED zero, waiting and working included", () => {
    expect(deriveSubprojectsHealth(ALL_ZERO)).toMatchObject({
      level: "green",
      headline: "Nothing is stalled or waiting on you",
    });
  });

  it("says a count coord did not take was not taken, and is never green", () => {
    const h = deriveSubprojectsHealth({ ...ALL_ZERO, stalled: v(null) });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe(
      "Whether anything is stalled or waiting on you is unknown"
    );
    expect(h.detail).toBe("coord did not take the stalled count.");
  });

  it("words a failed per-view read as a failed read, not as 'not taken'", () => {
    const h = deriveSubprojectsHealth({
      ...ALL_ZERO,
      stalled: failedCount(UNREAD_COUNT, UNREACHABLE),
    });
    expect(h.level).toBe("amber");
    expect(h.detail).toMatch(
      /^the stalled count could not be read \(coord did not answer \(HTTP 502\)\)/
    );
  });

  it("keeps a stale count, dated as the last good read, and is never an all-clear", () => {
    const stale = deriveSubprojectsHealth({
      ...ALL_ZERO,
      needs_you: failedCount(v(0), UNREACHABLE),
      stalled: failedCount(v(0), UNREACHABLE),
    });
    expect(stale.level).toBe("amber");
    expect(stale.headline).toBe(
      "Nothing was stalled or waiting on you at the last good read"
    );
    expect(stale.detail).toMatch(
      /is from the last good read; its latest read failed/
    );
    const staleRed = deriveSubprojectsHealth({
      ...ALL_ZERO,
      stalled: failedCount(v(3), UNREACHABLE),
    });
    expect(staleRed.level).toBe("amber");
    expect(staleRed.headline).toBe("At the last good read: 3 stalled");
    // A failed read with no number ever taken is unknown, not "nothing".
    const staleUnknown = deriveSubprojectsHealth({
      ...ALL_ZERO,
      stalled: failedCount(UNREAD_COUNT, UNREACHABLE),
      needs_you: failedCount(v(0), UNREACHABLE),
    });
    expect(staleUnknown.headline).toBe(
      "Whether anything is stalled or waiting on you is unknown"
    );
    // The stale arm and the current arm say different things.
    expect(stale.headline).not.toBe(deriveSubprojectsHealth(ALL_ZERO).headline);
  });

  it("is amber when any verdict is unknown, or the unknown count was not taken", () => {
    expect(
      deriveSubprojectsHealth({ ...ALL_ZERO, unknown: v(2) })
    ).toMatchObject({
      level: "amber",
    });
    expect(
      deriveSubprojectsHealth({ ...ALL_ZERO, unknown: v(2) }).headline
    ).toMatch(/^2 unknown/);
    expect(
      deriveSubprojectsHealth({ ...ALL_ZERO, unknown: v(null) }).level
    ).toBe("amber");
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
    ).toEqual({ value: "–", note: null });
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
    expect(line.note).toMatch(/^as of the last good read; the latest failed/);
  });

  it("says a kept count is stale even when no failure reason is held", () => {
    expect(
      describeStalledLine({
        count: 2,
        loaded: true,
        stale: true,
        failure: null,
      })
    ).toEqual({
      value: "2",
      note: "as of the last good read; the latest read did not refresh it",
    });
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
    ).toEqual({ value: "0", note: null });
  });
});
