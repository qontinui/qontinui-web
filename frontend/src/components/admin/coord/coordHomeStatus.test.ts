/**
 * coordHomeStatus — the pure half of `/admin/coord/home`.
 *
 * Plan
 * `2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen`
 * Phase 4 acceptance, the parts that can be asserted without a browser:
 *
 * - the strip is NEVER green when any block is not `read` — table-driven over
 *   every block and every non-read state;
 * - "Nothing needs you" is permitted ONLY on a read block with an exact zero;
 * - the `stalled` class never reaches the screen as the word "stalled";
 * - the parser drops counts from any block that is not `read`, and reads an
 *   absent count as unknown (null), never as zero;
 * - the surface's palette agrees with its attention table.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  BLOCK_STATES,
  HOME_ATTENTION_BY_KIND,
  HOME_STATUS_PALETTE,
  NOTHING_READ,
  UNIT_CLASSES,
  deriveHomeStrip,
  nothingNeedsYou,
  parseBlockState,
  parseOptions,
  withoutVerdictWords,
  planeFreshnessPhrase,
  watcherReasonWords,
  decisionDomainLabel,
  parseProjectState,
  unitClassLabel,
  type BlockState,
  type HomeBlock,
} from "./coordHomeStatus";

const CLASSES = Object.fromEntries(UNIT_CLASSES.map((c) => [c, 1]));

/** A body whose every block is `read` and calm — the only green one. */
function calmBody(): Record<string, unknown> {
  return {
    schema: 1,
    generated_at: "2026-09-30T12:00:00Z",
    tenant_id: "11111111-1111-1111-1111-111111111111",
    scope: "operator",
    on_track: {
      state: "read",
      totals: { row_count: 9, classes: { ...CLASSES, stalled: 0 } },
      groups: [],
      stall_window_secs: 1_209_600,
    },
    correctness: { state: "read", reason: null, inputs: {} },
    needs_me: { state: "read", items: [], total: 0, omitted: 0 },
    degradations: {
      state: "read",
      headline: "none",
      open: [],
      declared: [],
      recently_cleared: [],
    },
    does_not_know: [
      { source: "work_units", state: "read", as_of: "2026-09-30T12:00:00Z" },
    ],
  };
}

const BLOCK_KEY: Record<HomeBlock, string> = {
  needs_me: "needs_me",
  degradations: "degradations",
  on_track: "on_track",
  correctness: "correctness",
};

const NOT_READ = BLOCK_STATES.filter((s) => s !== "read");

describe("deriveHomeStrip — never green over what it does not know", () => {
  it("is green for a body whose every block is read and calm (the control)", () => {
    const strip = deriveHomeStrip(parseProjectState(calmBody()));
    expect(strip.level).toBe("green");
  });

  const cases = (Object.keys(BLOCK_KEY) as HomeBlock[]).flatMap((block) =>
    NOT_READ.map((state) => ({ block, state }))
  );

  it.each(cases)(
    "is not green when $block is $state",
    ({ block, state }: { block: HomeBlock; state: BlockState }) => {
      const body = calmBody();
      body[BLOCK_KEY[block]] = {
        ...(body[BLOCK_KEY[block]] as Record<string, unknown>),
        state,
      };
      const strip = deriveHomeStrip(parseProjectState(body));
      expect(strip.level).not.toBe("green");
      expect(strip.detail).toContain("Not read");
    }
  );

  it.each(["", "fine", "READ", null, 3, undefined])(
    "reads an unrecognised block state (%p) as unknown, and so not green",
    (raw) => {
      expect(parseBlockState(raw)).toBe("unknown");
      const body = calmBody();
      body.needs_me = { ...(body.needs_me as object), state: raw };
      expect(deriveHomeStrip(parseProjectState(body)).level).not.toBe("green");
    }
  );

  it("is not green when a does_not_know source is not read", () => {
    const body = calmBody();
    body.does_not_know = [{ source: "fleet_health roster", state: "stale" }];
    const strip = deriveHomeStrip(parseProjectState(body));
    expect(strip.level).toBe("amber");
  });

  it("is not green when does_not_know is absent", () => {
    const body = calmBody();
    delete body.does_not_know;
    expect(deriveHomeStrip(parseProjectState(body)).level).toBe("amber");
  });

  it("is amber 'cannot tell' before any read", () => {
    const strip = deriveHomeStrip(null);
    expect(strip.level).toBe("amber");
    expect(strip.headline).toMatch(/Cannot tell/);
    expect(strip.badges.every((b) => b.label.endsWith("–"))).toBe(true);
  });

  it("is red when an operator fork is waiting, even beside an unread block", () => {
    const body = calmBody();
    body.needs_me = {
      state: "read",
      total: 2,
      omitted: 0,
      items: [{ id: "q-1", fork: "Pick one", shape: "open_question" }],
    };
    body.correctness = {
      state: "unknown",
      reason: "verification_metrics_door_absent",
    };
    const strip = deriveHomeStrip(parseProjectState(body));
    expect(strip.level).toBe("red");
    expect(strip.headline).toBe("2 decisions need you");
    expect(strip.detail).toContain("correct? unknown");
  });

  it("is amber when something is degrading, and a declared drain is not a fault", () => {
    const body = calmBody();
    body.degradations = {
      state: "read",
      headline: "degraded",
      open: [{ id: "alert:1", plane: "runner", declared: false }],
    };
    expect(deriveHomeStrip(parseProjectState(body)).level).toBe("amber");

    const drained = calmBody();
    drained.degradations = {
      state: "read",
      headline: "none",
      open: [],
      declared: [{ id: "drain:1", declared: true }],
    };
    expect(deriveHomeStrip(parseProjectState(drained)).level).toBe("green");
  });

  it("renders the stall badge as 'no change 14 d', never 'stalled'", () => {
    const strip = deriveHomeStrip(parseProjectState(calmBody()));
    const labels = strip.badges.map((b) => b.label);
    expect(labels).toContain("no change 14 d 0");
    expect(labels.join(" ")).not.toMatch(/stall/i);
  });

  it("shows a dash, not a zero, for a count its block did not read", () => {
    const body = calmBody();
    body.needs_me = { state: "not_implemented", total: 0 };
    const strip = deriveHomeStrip(parseProjectState(body));
    expect(strip.badges.find((b) => b.key === "needs")?.label).toBe(
      "needs you –"
    );
  });
});

describe("nothingNeedsYou — the one gate on 'Nothing needs you'", () => {
  it("is true only for a read block with an exact zero", () => {
    expect(nothingNeedsYou(parseProjectState(calmBody())!.needsMe)).toBe(true);
  });

  it.each(NOT_READ)(
    "is false when needs_me is %s, even if it says total 0",
    (state) => {
      const view = parseProjectState({
        needs_me: { state, total: 0, items: [] },
      })!;
      expect(nothingNeedsYou(view.needsMe)).toBe(false);
    }
  );

  it("is false on a read block that served no total", () => {
    const view = parseProjectState({ needs_me: { state: "read", items: [] } })!;
    expect(nothingNeedsYou(view.needsMe)).toBe(false);
  });

  it("is false before any read", () => {
    expect(nothingNeedsYou(NOTHING_READ.needsMe)).toBe(false);
  });
});

describe("parseProjectState — counts only from a read block, absence is unknown", () => {
  it.each(NOT_READ)(
    "drops on_track totals and groups when it is %s",
    (state) => {
      const view = parseProjectState({
        on_track: {
          state,
          totals: { row_count: 3, classes: CLASSES },
          groups: [{ key: "r", kind: "repo", row_count: 3, classes: CLASSES }],
        },
      })!;
      expect(view.onTrack.totals).toBeNull();
      expect(view.onTrack.rowCount).toBeNull();
      expect(view.onTrack.groups).toBeNull();
    }
  );

  it("reads a missing class as null, not 0", () => {
    const view = parseProjectState({
      on_track: {
        state: "read",
        totals: { row_count: 1, classes: { shipped: 1 } },
      },
    })!;
    expect(view.onTrack.totals?.shipped).toBe(1);
    expect(view.onTrack.totals?.in_flight).toBeNull();
  });

  it("serves degradation rows on stale (positive facts) but not on could_not_read", () => {
    const row = { id: "alert:9", plane: "disk" };
    const stale = parseProjectState({
      degradations: { state: "stale", headline: "degraded", open: [row] },
    })!;
    expect(stale.degradations.open?.map((r) => r.id)).toEqual(["alert:9"]);
    const failed = parseProjectState({
      degradations: {
        state: "could_not_read",
        headline: "unknown",
        open: [row],
      },
    })!;
    expect(failed.degradations.open).toBeNull();
  });

  it("reads coord's current needs_me placeholder as not_implemented with no counts", () => {
    const view = parseProjectState({ needs_me: { state: "not_implemented" } })!;
    expect(view.needsMe.state).toBe("not_implemented");
    expect(view.needsMe.total).toBeNull();
    expect(view.needsMe.items).toBeNull();
  });

  it("returns null for a body that is not an object", () => {
    expect(parseProjectState(null)).toBeNull();
    expect(parseProjectState([])).toBeNull();
    expect(parseProjectState("x")).toBeNull();
  });
});

describe("R8 — the stalled class is never worded 'stalled'", () => {
  it.each(UNIT_CLASSES)("labels %s without internal vocabulary", (cls) => {
    const label = unitClassLabel(cls, 1_209_600);
    expect(label).not.toMatch(/stall/i);
    expect(label).not.toContain("_");
  });

  it("words the stalled class as the measurement it is", () => {
    expect(unitClassLabel("stalled", 1_209_600)).toBe(
      "no recorded change in 14 days"
    );
    expect(unitClassLabel("stalled", 7 * 86_400)).toBe(
      "no recorded change in 7 days"
    );
  });
});

describe("the surface's palette", () => {
  it("agrees with its attention table", () => {
    expect(
      paletteDisagreements(HOME_ATTENTION_BY_KIND, HOME_STATUS_PALETTE)
    ).toEqual([]);
  });
});

describe("review fixes — the strip over a partly-known view", () => {
  it("is not green when the latest poll failed over a calm last-good view (R6)", () => {
    const view = parseProjectState(calmBody());
    expect(deriveHomeStrip(view).level).toBe("green");
    const strip = deriveHomeStrip(view, { stale: true });
    expect(strip.level).toBe("amber");
    expect(strip.headline).toMatch(/at the last good read \(/);
  });

  it("keeps red over a stale view, still qualified by the last good read", () => {
    const body = calmBody();
    body.needs_me = {
      state: "read",
      total: 1,
      omitted: 0,
      items: [{ id: "q" }],
    };
    const strip = deriveHomeStrip(parseProjectState(body), { stale: true });
    expect(strip.level).toBe("red");
    expect(strip.headline).toMatch(/at the last good read/);
  });

  it("is not green and shows a dash when a read degradations block has no open list", () => {
    const body = calmBody();
    body.degradations = {
      state: "read",
      headline: "none",
      declared: [],
      recently_cleared: [],
    };
    const view = parseProjectState(body)!;
    expect(view.degradations.open).toBeNull();
    const strip = deriveHomeStrip(view);
    expect(strip.level).toBe("amber");
    expect(strip.badges.find((b) => b.key === "degraded")?.label).toBe(
      "degraded –"
    );
  });

  it("is not green when needs_me is read with no total", () => {
    const body = calmBody();
    body.needs_me = { state: "read", items: [] };
    expect(deriveHomeStrip(parseProjectState(body)).level).toBe("amber");
  });

  it("is red when needs_me lists items even without a total", () => {
    const body = calmBody();
    body.needs_me = { state: "read", items: [{ id: "q-1", fork: "Pick" }] };
    const strip = deriveHomeStrip(parseProjectState(body));
    expect(strip.level).toBe("red");
    expect(strip.headline).toMatch(/how many is unknown/);
  });
});

describe("review fixes — parsing", () => {
  it("reads options as bare strings, {label} objects, or a single object", () => {
    expect(parseOptions(["a", { label: "b", value: 2 }])).toEqual(["a", "b"]);
    expect(parseOptions({ label: "only" })).toEqual(["only"]);
    expect(parseOptions(undefined)).toEqual([]);
  });

  it("marks options unreadable rather than dropping an entry", () => {
    expect(parseOptions(["a", { value: 1 }])).toBeNull();
    expect(parseOptions(42)).toBeNull();
  });

  it("parses by_domain, retirement and blocking", () => {
    const view = parseProjectState({
      needs_me: {
        state: "read",
        total: 1,
        by_domain: { repo_pull: 3, unclassified: 1 },
        retirement: "unsupported",
        items: [{ id: "q", blocking: { work_unit_slug: "s", plan_phase: 2 } }],
      },
    })!;
    expect(view.needsMe.byDomain).toEqual({ repo_pull: 3, unclassified: 1 });
    expect(view.needsMe.retirement).toBe("unsupported");
    expect(view.needsMe.items?.[0].blocking).toEqual({
      workUnitSlug: "s",
      planPhase: "2",
    });
    expect(
      parseProjectState({ needs_me: { state: "read" } })!.needsMe.retirement
    ).toBe("unknown");
  });

  it("parses per-plane watcher freshness from degradations.planes", () => {
    const view = parseProjectState({
      degradations: {
        state: "stale",
        headline: "unknown",
        open: [],
        planes: {
          merge_train: {
            fresh: false,
            watchers: [
              {
                name: "train_health",
                state: "stale",
                reason: "no_successful_tick",
              },
            ],
            detection_bound_secs: 90,
          },
        },
      },
    })!;
    expect(view.degradations.planes).toEqual([
      {
        plane: "merge_train",
        fresh: false,
        watchers: [
          {
            name: "train_health",
            state: "stale",
            asOf: null,
            reason: "no_successful_tick",
          },
        ],
        detectionBoundSecs: 90,
      },
    ]);
  });

  it("reads the bookkeeping exclusion from on_track totals", () => {
    const view = parseProjectState({
      on_track: {
        state: "read",
        totals: {
          row_count: 1,
          classes: CLASSES,
          excluded: { merge_shepherd_bookkeeping: 7 },
        },
      },
    })!;
    expect(view.onTrack.excludedBookkeeping).toBe(7);
  });

  it("rewords coord free text that names the stalled class", () => {
    const text =
      "in_progress units with NO status-history row cannot be judged stalled; they are classed in_flight";
    expect(withoutVerdictWords(text)).not.toMatch(/stalled/i);
  });
});

describe("round-2 review — R8 for watchers and domains, honest red headline", () => {
  it.each([
    ["no_successful_tick", "has not completed a run"],
    ["last_success_older_than_3x_interval", "last run is overdue"],
    ["heartbeat_read_failed", "status could not be read"],
    ["no_declared_interval", "no expected interval declared"],
    ["something_new", "state unknown"],
    [null, "state unknown"],
  ])("words watcher reason %p as %p", (token, words) => {
    expect(watcherReasonWords(token)).toBe(words);
  });

  it("keeps watcher names and reason tokens out of the plane sentence", () => {
    const phrase = planeFreshnessPhrase({
      plane: "merge_train",
      fresh: false,
      watchers: [
        {
          name: "train_health",
          state: "stale",
          asOf: null,
          reason: "no_successful_tick",
        },
        { name: "pr_merge_tick", state: "fresh", asOf: null, reason: null },
      ],
      detectionBoundSecs: null,
    });
    expect(phrase).toBe("1 of 2 watchers not fresh — has not completed a run");
    expect(phrase).not.toMatch(/_/);
  });

  it("labels known decision domains and spaces unknown ones", () => {
    expect(decisionDomainLabel("repo_pull")).toBe("pulling a repository");
    expect(decisionDomainLabel("pr_fix")).toBe("fixing a pull request");
    expect(decisionDomainLabel("brand_new_domain")).toBe("brand new domain");
  });

  it("never prints '0 decisions' when items are listed", () => {
    const body = calmBody();
    body.needs_me = {
      state: "read",
      total: 0,
      omitted: 0,
      items: [{ id: "q-1", fork: "Pick" }],
    };
    const strip = deriveHomeStrip(parseProjectState(body));
    expect(strip.level).toBe("red");
    expect(strip.headline).toBe("Decisions need you — how many is unknown");
  });
});
