/**
 * homeLens — the pure half of `/admin/coord/home`'s presentation lens (plan
 * `2026-10-23-console-presentation-spaces` Phase 2). The rendered half is
 * pinned in `../page.presentation.test.tsx`.
 */

import { describe, expect, it } from "vitest";
import {
  PROJECT_STATE_ROUTE_UNAVAILABLE_TEXT,
  parseProjectState,
  type DegradationView,
  type NamedList,
  type NeedsMeItem,
  type RepoGroup,
} from "@/components/admin/coord/coordHomeStatus";
import { WITHHELD, describeRedacted } from "@/components/presentation";
import { ROUTE_DISABLED_TEXT } from "@/components/operations/coordPollError";
import { FAILURE_REASON_WITHHELD } from "@/components/operations/presentedFailure";
import {
  BLOCKED_UNIT_DESCRIPTOR,
  COORD_TIMEOUT_TEXT,
  COORD_UNREACHABLE_TEXT,
  INITIATIVE_ITEM_DESCRIPTOR,
  INITIATIVE_KEYS_DESCRIPTOR,
  PROJECT_STATE_KEPT_SOURCE,
  PROJECT_STATE_SOURCE,
  REPOSITORY_DESCRIPTOR,
  RowKeyAliases,
  TENANT_DESCRIPTOR,
  UNLABELLED_SOURCE,
  UNNAMED_DECISION_KIND,
  UNNAMED_DECISION_KINDS,
  degradationDescriptor,
  degradationRepo,
  isMachineSubject,
  namedUnitDescriptor,
  namedUnitRepos,
  needsDescriptor,
  needsStatusWord,
  presentableProjectStateFailure,
  presentedDecisionDomains,
  presentedHomeFailure,
  presentedInitiativeDate,
  presentedInitiativeStatus,
  presentedPlanPhase,
  presentedSourceLabel,
  reasonDescriptor,
  regionSources,
  subjectDescriptor,
} from "./homeLens";

const AT = "2026-10-20T08:00:00Z";

function item(over: Partial<NeedsMeItem> = {}): NeedsMeItem {
  return {
    source: "agent_question",
    id: "q-1",
    askedAt: AT,
    ageSecs: 60,
    fork: "Ship it?",
    options: [],
    recommendation: null,
    ifOverturned: null,
    shape: null,
    answerAt: null,
    blocking: null,
    ...over,
  };
}

/** One degradation row, as the page parses coord's body. */
function degradation(raw: Record<string, unknown>): DegradationView {
  const view = parseProjectState({
    degradations: { state: "read", open: [raw] },
  });
  const row = view?.degradations.open?.[0];
  if (!row) throw new Error("fixture row did not parse");
  return row;
}

function list(slugs: string[], omitted: number | null = 0): NamedList {
  return {
    units: slugs.map((slug) => ({
      slug,
      title: null,
      firstInProgressAt: null,
      lastRecordedChangeAt: null,
      ageSecs: null,
      ageBasis: null,
    })),
    omitted,
  };
}

function group(
  key: string | null,
  stalled: NamedList | null,
  waitingOnGate: NamedList | null = list([]),
  kind: RepoGroup["kind"] = key === null ? "unattributed_repo" : "repo"
): RepoGroup {
  const classes = {} as RepoGroup["classes"];
  return {
    key,
    kind,
    rowCount: null,
    classes,
    named: { stalled, waitingOnGate },
  };
}

describe("regionSources — one read, dated by coord's answer", () => {
  it("names coord's project state and dates it by generated_at", () => {
    expect(regionSources({ generatedAt: AT, kept: false })).toEqual([
      { source: PROJECT_STATE_SOURCE, asOf: AT },
    ]);
  });

  it("names a kept reading as the last read, still dated by its own answer", () => {
    expect(regionSources({ generatedAt: AT, kept: true })).toEqual([
      { source: PROJECT_STATE_KEPT_SOURCE, asOf: AT },
    ]);
    expect(PROJECT_STATE_KEPT_SOURCE).toMatch(/last read/);
  });

  it("leaves the time unknown when nothing was read — never now", () => {
    expect(regionSources({ generatedAt: null, kept: false })[0]!.asOf).toBe(
      null
    );
  });
});

describe("presentableProjectStateFailure — fixed words, decided by structure", () => {
  /** An `httpClient` rejection, in `readJson`'s message shape. */
  const answered = (status: number, body: string) =>
    new Error(
      `GET /api/v1/operations/project-state failed: ${status} - ${body}`
    );
  const refusal = (status: number, code: string, discriminator: string) =>
    answered(
      status,
      JSON.stringify({
        error: "X",
        message: "globex-gateway-7 said no",
        refusal: {
          code,
          detail: "globex-gateway-7 said no",
          discriminator,
          glossary_terms: ["coord"],
          next_action: { kind: "retry_later" },
          observed_at: "2026-10-27T16:27:56Z",
          source: "web_backend",
        },
        path: "https://api.globex.internal/x",
      })
    );

  it("explains the arms the page words itself, and nothing they quote", () => {
    expect(
      presentableProjectStateFailure(answered(404, '{"detail":"globex"}'))
    ).toBe(PROJECT_STATE_ROUTE_UNAVAILABLE_TEXT);
    expect(
      presentableProjectStateFailure(
        answered(404, '{"error":"route_disabled"}')
      )
    ).toBe(ROUTE_DISABLED_TEXT);
    // coord's deadline: its budget, never the loader coord names.
    expect(
      presentableProjectStateFailure(
        answered(
          503,
          '{"error":"deadline","budget_ms":8000,"loader":"globex_census"}'
        )
      )
    ).toBe("coord read deadline (8000 ms) exceeded — unknown");
    expect(
      presentableProjectStateFailure(
        refusal(502, "upstream_unavailable", "coord_unreachable")
      )
    ).toBe(COORD_UNREACHABLE_TEXT);
    expect(
      presentableProjectStateFailure(
        refusal(504, "upstream_timeout", "coord_timeout")
      )
    ).toBe(COORD_TIMEOUT_TEXT);
  });

  it("withholds every other failure: its words are not the page's", () => {
    for (const err of [
      answered(502, '{"error":"upstream build-host-acme-07"}'),
      answered(500, '{"error":"INTERNAL","message":"coord: globex down"}'),
      refusal(503, "service_unavailable", "globex_maintenance"),
      refusal(504, "upstream_timeout", "coord_write_timeout"),
      new TypeError("Failed to fetch"),
      new Error("GET https://coord.globex.internal failed"),
    ]) {
      expect(presentableProjectStateFailure(err), String(err)).toBeNull();
    }
  });

  it("shows the operator's words for the operator, and the fixed words or the withheld reason while presenting", () => {
    expect(presentedHomeFailure("raw text", "fixed", false)).toBe("raw text");
    expect(presentedHomeFailure("raw text", "fixed", true)).toBe("fixed");
    expect(presentedHomeFailure("raw text", null, true)).toBe(
      FAILURE_REASON_WITHHELD
    );
    expect(presentedHomeFailure(null, null, true)).toBeNull();
    expect(presentedHomeFailure(null, null, false)).toBeNull();
  });
});

describe("descriptors — built from fixed fields, never from the text", () => {
  it("words a needs-you item by its own badge, and its parts by what they are", () => {
    const question = item({ recommendation: "Hold" });
    expect(needsStatusWord(question)).toBe("decide");
    expect(needsStatusWord(item())).toBe("open question");
    const gate = item({ source: "operator_gate", recommendation: "x" });
    expect(needsStatusWord(gate)).toBe("approval");
    expect(needsDescriptor(question)).toEqual({
      kind: "Question",
      area: null,
      status: "decide",
      at: AT,
    });
    expect(needsDescriptor(gate).kind).toBe("Approval");
    expect(needsDescriptor(question, "Recommendation").kind).toBe(
      "Recommendation"
    );
    for (const d of [needsDescriptor(question), needsDescriptor(gate)]) {
      expect(JSON.stringify(d)).not.toMatch(/Ship it|Hold/);
    }
  });

  it("dates an open degradation by its observed onset and a cleared one by when it cleared", () => {
    const d = degradation({
      id: "alert:1",
      plane: "merge_train",
      subject: { kind: "repo", name: "acme/secret", id: "acme/secret" },
      headline: "A repo's merge train is wedged",
      onset_observed_at: AT,
      resolved_at: "2026-10-20T09:00:00Z",
    });
    expect(degradationDescriptor(d, "degrading")).toEqual({
      kind: "Degradation",
      area: "merge train",
      status: "degrading",
      at: AT,
    });
    expect(degradationDescriptor(d, "cleared").at).toBe("2026-10-20T09:00:00Z");
    expect(subjectDescriptor(d, "degrading").kind).toBe("Repository");
  });

  it("attributes a headline only to a repository coord names as the subject", () => {
    const repo = degradation({
      subject: { kind: "repo", name: "qontinui/web", id: "qontinui/web" },
    });
    const device = degradation({
      subject: { kind: "device", name: "box-1", id: "dev-1" },
    });
    const service = degradation({
      subject: { kind: "service", name: "rds:db", id: "rds:db" },
    });
    expect(degradationRepo(repo)).toBe("qontinui/web");
    expect(degradationRepo(device)).toBeNull();
    expect(degradationRepo(service)).toBeNull();
    expect(isMachineSubject(device)).toBe(true);
    expect(isMachineSubject(repo)).toBe(false);
    expect(subjectDescriptor(service, "degrading").kind).toBe("Service");
    expect(
      subjectDescriptor(degradation({ subject: { name: "x" } }), "cleared").kind
    ).toBe("Subject");
  });

  it("words a named unit by its list, and a reason by its status", () => {
    const u = list(["s"]).units[0]!;
    expect(namedUnitDescriptor(u, "stalled").status).toBe("no recorded change");
    expect(namedUnitDescriptor(u, "waitingOnGate").status).toBe("waiting");
    expect(reasonDescriptor("excluded", AT)).toEqual({
      kind: "Reason",
      status: "excluded",
      at: AT,
      notApplicable: ["area"],
    });
  });

  it("describes each referent by its own fields, and leaves out the ones it does not have", () => {
    const ready = {
      status: "ready",
      scope: { firstPartyOwners: ["qontinui"], confidentialTerms: [] },
    } as const;
    const now = Date.parse("2026-10-20T09:00:00Z");
    const line = (d: Parameters<typeof describeRedacted>[0]) =>
      describeRedacted(d, ready, { now });
    expect(line(TENANT_DESCRIPTOR)).toBe("Project");
    expect(line(REPOSITORY_DESCRIPTOR)).toBe("Repository");
    expect(line(INITIATIVE_ITEM_DESCRIPTOR)).toBe("Initiative item · in scope");
    expect(line(INITIATIVE_KEYS_DESCRIPTOR)).toBe("Item keys · not listed");
    expect(line(reasonDescriptor("excluded", AT))).toBe(
      "Reason · excluded · 1h ago"
    );
    // The unit a decision blocks: its own fact, never the question's status
    // word or asked-at age.
    expect(line(BLOCKED_UNIT_DESCRIPTOR)).toBe(
      "Work unit · area unknown · blocked · age unknown"
    );
    const asked = needsDescriptor(item({ recommendation: "Hold" }));
    expect(line(BLOCKED_UNIT_DESCRIPTOR)).not.toContain(asked.status!);
  });
});

describe("presentedDecisionDomains — the table's words, or fixed words", () => {
  it("names a kind the table holds, in coord's order", () => {
    expect(
      presentedDecisionDomains({ pr_fix: 2, operator_gate: 1, unscanned: 4 })
    ).toEqual([
      "fixing a pull request 2",
      "operator approval gate 1",
      "not yet scanned 4",
    ]);
  });

  it("folds every kind the table does not name into one fixed entry, last, with their summed count", () => {
    expect(
      presentedDecisionDomains({
        "Acme Corp contract renewal": 1,
        operator_gate: 2,
        quarterly_board_pack: 3,
      })
    ).toEqual(["operator approval gate 2", `${UNNAMED_DECISION_KINDS} 4`]);
    expect(presentedDecisionDomains({ "Globex merger": 5 })).toEqual([
      `${UNNAMED_DECISION_KIND} 5`,
    ]);
    // None of a folded key's words reach the line, however it is spelled.
    const line = presentedDecisionDomains({
      "Acme Corp contract renewal": 1,
      acme_audit: 1,
    }).join(" · ");
    expect(line).not.toMatch(/acme|contract|audit/i);
  });

  it("does not take a key Object.prototype carries for one the table names", () => {
    expect(
      presentedDecisionDomains({ constructor: 1, toString: 2, valueOf: 4 })
    ).toEqual([`${UNNAMED_DECISION_KINDS} 7`]);
  });

  it("is empty for no kinds", () => {
    expect(presentedDecisionDomains({})).toEqual([]);
  });
});

describe("presentedSourceLabel — the table's words, or fixed words", () => {
  it("labels a source the table knows, and a watcher by the area it feeds", () => {
    expect(presentedSourceLabel("work_units", null)).toBe("Work units");
    const planes = parseProjectState({
      degradations: {
        state: "read",
        planes: {
          runner: { fresh: false, watchers: [{ name: "w1", state: "stale" }] },
        },
      },
    })!.degradations.planes;
    expect(presentedSourceLabel("watcher:w1", planes)).toBe(
      "Watcher feeding runner"
    );
  });

  it("words any other source in fixed words, never as coord's identifier", () => {
    for (const source of [
      "coord.alerts visibility (operator-plane kinds this caller can be served)",
      "fleet_health resource headroom (live machines)",
      "acme_partner_feed",
      // Keys Object.prototype carries are not the table's.
      "constructor",
      "toString",
    ]) {
      expect(presentedSourceLabel(source, null), source).toBe(
        UNLABELLED_SOURCE
      );
    }
  });
});

describe("namedUnitRepos — a unit's repositories are bounded, or withheld", () => {
  it("is the groups that name the unit when every list is complete", () => {
    const reposOf = namedUnitRepos(
      [
        group("qontinui/web", list(["only-web", "both"])),
        group("acme/secret", list(["both"])),
      ],
      "stalled"
    );
    expect(reposOf("only-web")).toEqual(["qontinui/web"]);
    expect(reposOf("both")).toEqual(["qontinui/web", "acme/secret"]);
  });

  it("adds every repository whose list of the SAME kind may hide the unit", () => {
    const groups = [
      group("qontinui/web", list(["u"]), list(["w"])),
      // Cut short: its stalled list could hold `u` too.
      group("acme/secret", list([], 3), list([])),
    ];
    expect(namedUnitRepos(groups, "stalled")("u")).toEqual([
      "qontinui/web",
      "acme/secret",
    ]);
    // A truncated list of the OTHER kind hides nothing of this one.
    expect(namedUnitRepos(groups, "waitingOnGate")("w")).toEqual([
      "qontinui/web",
    ]);
  });

  it("treats an unknown omitted count, or a list not served, as one that may hide", () => {
    for (const hiding of [list([], null), null]) {
      const reposOf = namedUnitRepos(
        [group("qontinui/web", list(["u"])), group("acme/secret", hiding)],
        "stalled"
      );
      expect(reposOf("u")).toEqual(["qontinui/web", "acme/secret"]);
    }
  });

  it("withholds a unit that names no repository, and lets that group's truncation hide nothing", () => {
    const reposOf = namedUnitRepos(
      [group("qontinui/web", list(["u"])), group(null, list(["orphan"], 9))],
      "stalled"
    );
    expect(reposOf("orphan")).toBeNull();
    expect(reposOf("u")).toEqual(["qontinui/web"]);
  });

  it("cannot bound a group whose repository is unknown", () => {
    const named = namedUnitRepos(
      [
        group("qontinui/web", list(["u"])),
        group("x", list(["v"]), list([]), "unknown"),
      ],
      "stalled"
    );
    expect(named("v")).toBeNull();
    expect(named("u")).toEqual(["qontinui/web"]);
    // ...and when such a group's list may hide units, no unit is bounded.
    const hidden = namedUnitRepos(
      [
        group("qontinui/web", list(["u"])),
        group("x", list([], 1), list([]), "unknown"),
      ],
      "stalled"
    );
    expect(hidden("u")).toBeNull();
  });

  it("withholds everything when coord served no groups, and a slug no group names", () => {
    expect(namedUnitRepos(null, "stalled")("u")).toBeNull();
    expect(
      namedUnitRepos([group("qontinui/web", list(["u"]))], "stalled")("z")
    ).toBeNull();
  });
});

describe("values shown verbatim only in a shape that names no one", () => {
  it("keeps a phase number and withholds any other phase text", () => {
    expect(presentedPlanPhase("3")).toBe("3");
    expect(presentedPlanPhase(" 12b ")).toBe("12b");
    expect(presentedPlanPhase("the Acme phase")).toBe(WITHHELD);
  });

  it("says live or not live, never the frontmatter's own word", () => {
    expect(presentedInitiativeStatus("live")).toBe("live");
    expect(presentedInitiativeStatus("draft for Acme")).toBe("not live");
    expect(presentedInitiativeStatus(null)).toBe("unknown");
  });

  it("shows an ISO date and withholds any other date text", () => {
    expect(presentedInitiativeDate("2026-10-31")).toBe("2026-10-31");
    expect(presentedInitiativeDate("2026-10-31T09:00:00Z")).toBe(
      "2026-10-31T09:00:00Z"
    );
    expect(presentedInitiativeDate("when Acme signs")).toBe(WITHHELD);
    expect(presentedInitiativeDate(null)).toBeNull();
  });

});

describe("RowKeyAliases — a presented row key is an alias of the operator's", () => {
  it("carries none of the operator key, only the list's name", () => {
    const aliases = new RowKeyAliases();
    const key = aliases.key("needs", "agent_question:9f3b2a71-q:0");
    expect(key).toBe("needs:row-1");
    expect(key).not.toMatch(/agent_question|9f3b2a71/);
  });

  it("gives the same operator key the same alias on every poll", () => {
    const aliases = new RowKeyAliases();
    const first = aliases.key("needs", "operator_gate:g-1:1");
    aliases.key("needs", "agent_question:q-2:2");
    expect(aliases.key("needs", "operator_gate:g-1:1")).toBe(first);
  });

  it("gives a row whose operator key changed a new alias — so it collapses as the operator's does", () => {
    // A poll removed the row above: the operator key's index moved, so the
    // operator's open key matches nothing, and the alias must not either.
    const aliases = new RowKeyAliases();
    const open = aliases.key("needs", "operator_gate:g-1:1");
    const moved = aliases.key("needs", "operator_gate:g-1:0");
    const below = aliases.key("needs", "agent_question:q-3:1");
    expect(new Set([open, moved, below]).size).toBe(3);
  });

  it("keeps two lists' rows apart even when their operator keys agree", () => {
    const aliases = new RowKeyAliases();
    expect(aliases.key("degrading", "x:1:0")).not.toBe(
      aliases.key("cleared", "x:1:0")
    );
  });
});
