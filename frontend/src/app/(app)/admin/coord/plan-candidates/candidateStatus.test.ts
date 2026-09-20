/**
 * `candidateStatus` — the readings `/plan-library/candidates` states and a
 * renderer gets wrong by default.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4c.
 * Two of these are absences that a length check reads as measurements: an
 * empty `unmet_depends_on` on a row with no artifact behind it, and a `null`
 * `corpus_health`. The third is the population flag whose `unavailable` arm
 * silently narrows `total` to the document layer alone.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console";
import {
  CANDIDATE_ATTENTION_BY_KIND,
  CANDIDATE_PALETTE,
  type PlanCandidate,
  type PlanCandidateResponse,
  deriveCandidateDisclosure,
  deriveCandidateHealth,
  describeCandidateWindow,
  describeCoordLink,
  describeCorpusHealth,
  describePopulation,
  describePrState,
  describeReadiness,
} from "./candidateStatus";

function candidate(over: Partial<PlanCandidate> = {}): PlanCandidate {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    kind: "plan",
    slug: "2026-09-05-a",
    title: "A plan",
    status: "vetted",
    document_state: "present",
    age_days: 15,
    unmet_depends_on: [],
    coord: { work_unit_state: "linked", linked_prs_state: "available" },
    ...over,
  };
}

function response(
  over: Partial<PlanCandidateResponse> = {}
): PlanCandidateResponse {
  return {
    items: [candidate()],
    count: 1,
    total: 606,
    offset: 0,
    limit: 25,
    ordering: "oldest_vetted_first",
    coord_available: true,
    work_unit_population_state: "included",
    work_unit_population_reason: null,
    open_followups: [],
    open_followup_total: 0,
    corpus_health: {
      artifact_count: 2100,
      plan_count: 1887,
      newest_updated_at: "2026-09-20T09:00:00Z",
      scan_roots: { state: "reported", count: 3, fresh_count: 2 },
    },
    corpus_health_unavailable_reason: null,
    ...over,
  };
}

describe("the palette agrees with its attention table (R3)", () => {
  it("has no disagreement, and claims no author kind", () => {
    expect(
      paletteDisagreements(CANDIDATE_ATTENTION_BY_KIND, CANDIDATE_PALETTE)
    ).toEqual([]);
    expect(CANDIDATE_PALETTE.authorGlyphKinds.size).toBe(0);
  });
});

describe("an empty unmet_depends_on is UNKNOWN on a row with no artifact", () => {
  it("reads document_state BEFORE the dependency list", () => {
    const status = describeReadiness(
      candidate({ document_state: "unsynced", unmet_depends_on: [] })
    );
    expect(status.kind).toBe("unknown");
    expect(status.label).toMatch(/not looked at/i);
    expect(status.reason).toMatch(/UNKNOWN/);
    expect(status.reason).toMatch(/not 'nothing does'/);
  });

  it("does the same for an absent document, with its own sentence", () => {
    const status = describeReadiness(
      candidate({ document_state: "absent", unmet_depends_on: [] })
    );
    expect(status.kind).toBe("unknown");
    expect(status.reason).toMatch(/no document anywhere/i);
  });

  it("only calls a row ready when its edges WERE walked", () => {
    const status = describeReadiness(candidate());
    expect(status.kind).toBe("ready");
    expect(status.attention).toBe("none");
    expect(status.reason).toMatch(/walked/);
  });

  it("reads an UNSTATED document_state as UNKNOWN, never as 'present'", () => {
    // The field is optional on the wire. A `?? "present"` default walked the
    // confident arm on the strength of a field nobody served — the cascade's
    // first question answered by the renderer instead of by the route.
    const status = describeReadiness(
      candidate({ document_state: undefined, unmet_depends_on: [] })
    );
    expect(status.kind).toBe("unknown");
    expect(status.label).not.toBe("no unmet dependency");
    expect(status.reason).toMatch(/UNKNOWN/);
  });

  it("reads an ABSENT dependency list as UNKNOWN, never as an empty one", () => {
    const status = describeReadiness(
      candidate({ unmet_depends_on: undefined })
    );
    expect(status.kind).toBe("unknown");
    expect(status.label).not.toBe("no unmet dependency");
  });

  it("counts real blockers, and waits rather than escalating", () => {
    const status = describeReadiness(
      candidate({
        unmet_depends_on: [
          { id: "d1", kind: "plan", slug: "x", title: "X", status: "draft" },
          { id: "d2", kind: "plan", slug: "y", title: "Y", status: "vetted" },
        ],
      })
    );
    expect(status.kind).toBe("blocked");
    expect(status.label).toBe("blocked on 2 plans");
    expect(status.attention).toBe("waiting");
  });
});

describe("coord unavailable is UNKNOWN; unlinked PRs is a real zero", () => {
  it("marks an unreadable work unit unknown and quotes the reason", () => {
    const reading = describeCoordLink({
      work_unit_state: "unavailable",
      unavailable_reason: "coord returned 504",
    });
    expect(reading.unknown).toBe(true);
    expect(reading.detail).toBe("coord returned 504");
  });

  it("does NOT call a dangling link unknown — coord answered", () => {
    const reading = describeCoordLink({ work_unit_state: "dangling" });
    expect(reading.unknown).toBe(false);
    expect(reading.detail).toMatch(/MAY dangle/);
  });

  it("keeps 'PRs unreadable' apart from 'no PR cited'", () => {
    expect(
      describeCoordLink({ linked_prs_state: "unavailable" }).prUnknown
    ).toBe(true);
    // `unlinked` IS a real zero: citations carry a hard FK to the work unit.
    const unlinked = describeCoordLink({ linked_prs_state: "unlinked" });
    expect(unlinked.prUnknown).toBe(false);
    expect(unlinked.prLabel).toBe("no PR cited");
    // So is an `available` empty list.
    const available = describeCoordLink({
      linked_prs_state: "available",
      linked_prs: [],
    });
    expect(available.prUnknown).toBe(false);
    expect(available.prLabel).toBe("no PR cited");
  });

  it("reads an ABSENT coord block as UNKNOWN — neither 'no unit link' nor 'no PR cited'", () => {
    // `coord` is optional on the wire type. A backend that omits it has said
    // nothing; defaulting either half to `unlinked` publishes this function's
    // own named failure — "coord is down" rendered as "this plan has no PRs".
    const reading = describeCoordLink(undefined);
    expect(reading.unknown).toBe(true);
    expect(reading.label).not.toBe("no unit link");
    expect(reading.prUnknown).toBe(true);
    expect(reading.prLabel).not.toBe("no PR cited");
    expect(reading.prs).toEqual([]);
  });

  it("reads a coord block with NO linked_prs_state as UNKNOWN on the PR half", () => {
    // The block came; this half did not. Only an explicit `unlinked` is the
    // real zero the citations' hard FK guarantees.
    const reading = describeCoordLink({ work_unit_state: "linked" });
    expect(reading.unknown).toBe(false);
    expect(reading.prUnknown).toBe(true);
    expect(reading.prLabel).not.toBe("no PR cited");
  });

  it("reads an ABSENT work_unit_state as UNKNOWN — only an explicit 'unlinked' is zero", () => {
    const reading = describeCoordLink({ linked_prs_state: "unlinked" });
    expect(reading.unknown).toBe(true);
    expect(reading.label).not.toBe("no unit link");
    // The PR half is independent and was explicitly served: a real zero.
    expect(reading.prUnknown).toBe(false);
  });

  it("still reads an EXPLICIT unlinked work unit as a real zero", () => {
    const reading = describeCoordLink({ work_unit_state: "unlinked" });
    expect(reading.unknown).toBe(false);
    expect(reading.label).toBe("no unit link");
  });

  it("carries a citation's unknown merge state rather than flattening it", () => {
    expect(describePrState({ state: "unknown" })).toBe("merge state unknown");
    expect(describePrState({})).toBe("merge state unknown");
    expect(describePrState({ state: "unmerged" })).toBe("not merged");
  });
});

describe("corpus_health: null is UNKNOWN, never healthy", () => {
  it("renders the reason verbatim when the block is absent", () => {
    const line = describeCorpusHealth(
      response({
        corpus_health: null,
        corpus_health_unavailable_reason:
          "read_failed: the corpus health block could not be read (OperationalError)",
      })
    );
    expect(line.level).toBe("caveat");
    expect(line.text).toMatch(/UNKNOWN/);
    expect(line.text).not.toMatch(/\bis healthy\b/);
    expect(line.items).toEqual([
      "read_failed: the corpus health block could not be read (OperationalError)",
    ]);
  });

  it("says so when even the reason is missing", () => {
    const line = describeCorpusHealth(
      response({ corpus_health: null, corpus_health_unavailable_reason: null })
    );
    expect(line.items?.[0]).toMatch(/named no reason/i);
  });

  it("names the corpus and its feeders when the block IS there", () => {
    const line = describeCorpusHealth(response());
    expect(line.text).toMatch(/1887 plans/);
    expect(line.text).toMatch(/2 of 3 feeding devices/);
    expect(line.text).toMatch(/ranks the corpus, not the work/);
  });

  it("reads 'no device reported' as UNKNOWN, not as current feeders", () => {
    const line = describeCorpusHealth(
      response({
        corpus_health: {
          plan_count: 1887,
          scan_roots: { state: "unknown", detail: "no rows", count: 0 },
        },
      })
    );
    expect(line.level).toBe("caveat");
    expect(line.text).toMatch(/UNKNOWN, not "every feeder is current"/);
  });
});

describe("the population flag is read before the total means anything", () => {
  it("is critical on the degraded arm and quotes the reason", () => {
    const line = describePopulation(
      response({
        work_unit_population_state: "unavailable",
        work_unit_population_reason: "coord returned 504: non-JSON body",
      })
    );
    expect(line.level).toBe("critical");
    expect(line.text).toMatch(/2% view/);
    expect(line.text).toMatch(/never “coord has no work units”/);
    expect(line.items).toEqual(["coord returned 504: non-JSON body"]);
  });

  it("treats an ABSENT flag as unknown, never as included", () => {
    const line = describePopulation(
      response({ work_unit_population_state: undefined })
    );
    expect(line.level).toBe("critical");
    expect(line.text).toMatch(/does not say/);
  });

  it("puts the population line FIRST in the disclosure", () => {
    const lines = deriveCandidateDisclosure(
      response({ coord_available: false })
    );
    expect(lines[0].key).toBe("population");
    expect(lines.map((l) => l.key)).toContain("coord-available");
    expect(lines.map((l) => l.key)).toContain("corpus-health");
  });

  it("marks the window's total inadmissible on the degraded arm", () => {
    expect(
      describeCandidateWindow(
        response({ work_unit_population_state: "unavailable" })
      ).totalAdmissible
    ).toBe(false);
    expect(describeCandidateWindow(response()).totalAdmissible).toBe(true);
  });

  it("DASHES the strip's candidate count when the population arm did not run", () => {
    const health = deriveCandidateHealth(
      response({ work_unit_population_state: "unavailable", total: 13 }),
      true,
      false
    );
    // 13 over a denominator that silently moved looks measured and is not.
    expect(health.badges.find((b) => b.key === "candidates")?.label).toBe(
      "candidates –"
    );
    expect(health.level).toBe("amber");
  });

  it("dashes both counts before the route has answered", () => {
    const health = deriveCandidateHealth(null, false, true);
    expect(health.headline).toMatch(/unknown, not empty/i);
    expect(health.badges.map((b) => b.label)).toEqual([
      "candidates –",
      "follow-ups –",
    ]);
  });
});

describe("the window reports the declared ordering and nothing else", () => {
  it("carries ordering, offset, limit and a paging predicate", () => {
    const w = describeCandidateWindow(response());
    expect(w.ordering).toBe("oldest_vetted_first");
    expect(w.shown).toBe(1);
    expect(w.hasMore).toBe(true);
  });

  it("infers 'more' from a full page when no total was served", () => {
    const w = describeCandidateWindow(response({ total: undefined, limit: 1 }));
    expect(w.total).toBeNull();
    expect(w.hasMore).toBe(true);
  });
});
