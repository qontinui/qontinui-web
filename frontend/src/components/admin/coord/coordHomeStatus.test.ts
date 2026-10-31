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

import { summarizeMachineHealth } from "@/components/admin/coord/machineHealth";
import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  BLOCK_STATES,
  HOME_ATTENTION_BY_KIND,
  HOME_STATUS_PALETTE,
  NOTHING_READ,
  UNIT_CLASSES,
  boundText,
  correctnessHasNoSource,
  degradationRawLine,
  degradationSubjectText,
  degradationsGapPhrase,
  degradationsGapTitle,
  deriveHomeStrip,
  nothingNeedsYou,
  sourceAgePhrase,
  sourceErrorSentence,
  sourceErrorWords,
  sourceLabel,
  sourceRawLine,
  sourceRowReason,
  sourceTimeWords,
  unservedDecisionsSentence,
  parseBlockState,
  parseOptions,
  withoutVerdictWords,
  planeFreshnessPhrase,
  watcherReasonWords,
  decisionDomainLabel,
  initiativeAttributionPhrase,
  namedUnitAgePhrase,
  needsYouReason,
  parseProjectState,
  projectStateErrorText,
  unitClassLabel,
  internalHref,
  windowLabel,
  type BlockState,
  type HomeBlock,
  isKnownDecisionDomain,
  isKnownPlane,
  isLabelledSource,
  planeLabel,
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

/**
 * The machine roster read and every machine healthy: the strip's tests below
 * are about coord's project state, so they hold the roster calm. What an
 * unread or unhealthy roster does is pinned in `coordHomeStatus.ux.test.ts`.
 */
const CALM_MACHINES = {
  machines: {
    stale: false,
    counts: summarizeMachineHealth([{ device_id: "d-0", state: "healthy" }]),
    exclusions: { kind: "none_withheld" },
  },
} as const;

const BLOCK_KEY: Record<HomeBlock, string> = {
  needs_me: "needs_me",
  degradations: "degradations",
  on_track: "on_track",
  correctness: "correctness",
};

const NOT_READ = BLOCK_STATES.filter((s) => s !== "read");

describe("deriveHomeStrip — never green over what it does not know", () => {
  it("is green for a body whose every block is read and calm (the control)", () => {
    const strip = deriveHomeStrip(parseProjectState(calmBody()), CALM_MACHINES);
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
      const strip = deriveHomeStrip(parseProjectState(body), CALM_MACHINES);
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
      expect(
        deriveHomeStrip(parseProjectState(body), CALM_MACHINES).level
      ).not.toBe("green");
    }
  );

  it("is not green when a does_not_know source is not read", () => {
    const body = calmBody();
    body.does_not_know = [{ source: "fleet_health roster", state: "stale" }];
    const strip = deriveHomeStrip(parseProjectState(body), CALM_MACHINES);
    expect(strip.level).toBe("amber");
  });

  it("is not green when does_not_know is absent", () => {
    const body = calmBody();
    delete body.does_not_know;
    expect(deriveHomeStrip(parseProjectState(body), CALM_MACHINES).level).toBe(
      "amber"
    );
  });

  it("answers 'nothing needs you' on coord's real calm shape (correctness unknown), staying amber", () => {
    // coord serves correctness as `unknown` and a not_implemented
    // verification_metrics source on EVERY response until that door deploys.
    const body = calmBody();
    body.correctness = {
      state: "unknown",
      reason: "verification_metrics_door_absent",
    };
    body.does_not_know = [
      { source: "work_units", state: "read", as_of: "2026-09-30T12:00:00Z" },
      { source: "verification_metrics", state: "not_implemented" },
    ];
    const strip = deriveHomeStrip(parseProjectState(body), CALM_MACHINES);
    expect(strip.level).toBe("amber");
    expect(strip.headline).toMatch(
      /^Nothing needs you and nothing is degrading — part of this view is not read$/
    );
    expect(strip.headline).not.toMatch(/Cannot tell/);
  });

  it("is amber 'cannot tell' before any read", () => {
    const strip = deriveHomeStrip(null);
    expect(strip.level).toBe("amber");
    expect(strip.headline).toMatch(/Cannot tell/);
    // Every count is a dash; the no-change badge leads with its count.
    expect(
      strip.badges.every((b) =>
        b.key === "no-change" ? b.label.startsWith("– ") : b.label.endsWith("–")
      )
    ).toBe(true);
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
    const strip = deriveHomeStrip(parseProjectState(body), CALM_MACHINES);
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
    expect(deriveHomeStrip(parseProjectState(body), CALM_MACHINES).level).toBe(
      "amber"
    );

    const drained = calmBody();
    drained.degradations = {
      state: "read",
      headline: "none",
      open: [],
      declared: [{ id: "drain:1", declared: true }],
    };
    expect(
      deriveHomeStrip(parseProjectState(drained), CALM_MACHINES).level
    ).toBe("green");
  });

  it("renders the stall badge in plain words with its unit, never 'stalled'", () => {
    const strip = deriveHomeStrip(parseProjectState(calmBody()), CALM_MACHINES);
    const labels = strip.badges.map((b) => b.label);
    expect(labels).toContain("0 units with no recorded change in 14 days");
    expect(labels.join(" ")).not.toMatch(/stall/i);
  });

  it("shows a dash, not a zero, for a count its block did not read", () => {
    const body = calmBody();
    body.needs_me = { state: "not_implemented", total: 0 };
    const strip = deriveHomeStrip(parseProjectState(body), CALM_MACHINES);
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
    expect(deriveHomeStrip(view, CALM_MACHINES).level).toBe("green");
    const strip = deriveHomeStrip(view, { ...CALM_MACHINES, stale: true });
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
    const strip = deriveHomeStrip(parseProjectState(body), {
      ...CALM_MACHINES,
      stale: true,
    });
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
    const strip = deriveHomeStrip(view, CALM_MACHINES);
    expect(strip.level).toBe("amber");
    expect(strip.badges.find((b) => b.key === "degraded")?.label).toBe(
      "degraded –"
    );
  });

  it("is not green when needs_me is read with no total", () => {
    const body = calmBody();
    body.needs_me = { state: "read", items: [] };
    expect(deriveHomeStrip(parseProjectState(body), CALM_MACHINES).level).toBe(
      "amber"
    );
  });

  it("is red when needs_me lists items even without a total", () => {
    const body = calmBody();
    body.needs_me = { state: "read", items: [{ id: "q-1", fork: "Pick" }] };
    const strip = deriveHomeStrip(parseProjectState(body), CALM_MACHINES);
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
  // Each says only what coord's heartbeat table can show: a row keeps its
  // replica's LAST outcome, and a departed replica's row is deleted after
  // seven days — so neither "never ran" nor "never reported" is knowable.
  it.each([
    ["no_successful_tick", "no successful run on record"],
    ["last_success_older_than_3x_interval", "last run is overdue"],
    ["heartbeat_read_failed", "status could not be read"],
    ["no_declared_interval", "no expected interval declared"],
    ["no_heartbeat_row", "no heartbeat on record"],
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
    expect(phrase).toBe(
      "1 of 2 watchers not fresh — no successful run on record"
    );
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
    const strip = deriveHomeStrip(parseProjectState(body), CALM_MACHINES);
    expect(strip.level).toBe("red");
    expect(strip.headline).toBe("Decisions need you — how many is unknown");
    const badge = strip.badges.find((b) => b.key === "needs")!;
    expect(badge.label).toBe("needs you –");
    expect(strip.badges.map((b) => b.label).join(" ")).not.toMatch(
      /needs you 0/
    );
  });

  it("words a watcher by its state when coord gives no reason", () => {
    expect(watcherReasonWords(null, "stale")).toBe("stale");
    expect(watcherReasonWords("no_successful_tick", "stale")).toBe(
      "no successful run on record"
    );
    expect(watcherReasonWords(null, "weird")).toBe("state unknown");
    expect(watcherReasonWords(null, null)).toBe("state unknown");
  });
});

describe("coord needs_me wire at 4907c36ff", () => {
  it.each([
    ["supported", "supported"],
    ["unsupported", "unsupported"],
    ["unknown", "unknown"],
    [undefined, "unknown"],
    ["maybe", "unknown"],
  ])(
    "reads retirement %p as %p — never supported unless coord says so",
    (raw, want) => {
      const view = parseProjectState({
        needs_me: { state: "read", total: 0, items: [], retirement: raw },
      })!;
      expect(view.needsMe.retirement).toBe(want);
    }
  );

  it("reads a gate item as coord serves it", () => {
    const view = parseProjectState({
      needs_me: {
        state: "read",
        total: 1,
        omitted: 0,
        by_domain: { operator_gate: 1 },
        items: [
          {
            source: "operator_gate",
            id: "0b5e…",
            fork: "Deploy gate — coord build_sha is an ancestor",
            options: ["mark met", "reject"],
            recommendation: null,
            if_overturned: null,
            shape: "open_question",
            blocking: { work_unit_slug: "2026-09-20-x", plan_phase: "Phase 4" },
            answer_at: "/admin/coord/gates",
          },
        ],
      },
    })!;
    const item = view.needsMe.items![0];
    expect(needsYouReason(item)).toBe("approval — no recommendation");
    expect(item.options).toEqual(["mark met", "reject"]);
    expect(item.answerAt).toBe("/admin/coord/gates");
    expect(item.blocking).toEqual({
      workUnitSlug: "2026-09-20-x",
      planPhase: "Phase 4",
    });
  });

  it("labels coord's reserved by_domain buckets", () => {
    expect(decisionDomainLabel("operator_gate")).toBe("operator approval gate");
    expect(decisionDomainLabel("unscanned")).toBe("not yet scanned");
    expect(decisionDomainLabel("unclassified")).toBe("unclassified");
  });

  describe("an initiative's typed status and dates", () => {
    const initiative = (fields: Record<string, unknown>) =>
      parseProjectState({
        on_track: {
          state: "read",
          initiative: { state: "read", alignment: "read", ...fields },
        },
      })!.onTrack.initiative!;

    it.each([
      ["empty", ""],
      ["spaces", "   "],
      ["tabs and a newline", "\t\n "],
    ])("reads %s as no value, like an absent one", (_case, blank) => {
      const i = initiative({ status: blank, starts: blank, ends: blank });
      expect(i.status).toBeNull();
      expect(i.starts).toBeNull();
      expect(i.ends).toBeNull();
    });

    it("keeps what a person typed, verbatim", () => {
      const i = initiative({
        status: "draft",
        starts: "2026-10-01",
        ends: " when Acme Corp signs ",
      });
      expect(i.status).toBe("draft");
      expect(i.starts).toBe("2026-10-01");
      expect(i.ends).toBe(" when Acme Corp signs ");
    });
  });

  it("reads initiative attribution only when alignment is read", () => {
    const linked = parseProjectState({
      on_track: {
        state: "read",
        initiative: {
          state: "read",
          alignment: "read",
          in_scope: [
            {
              text: "a",
              key: "a",
              units: { total: 3, in_flight: 1, shipped: 1 },
            },
            {
              text: "b",
              key: "b",
              units: { total: 0, in_flight: 0, shipped: 0 },
            },
          ],
          unattributed: { total: 1, in_flight: 1, shipped: 0 },
          unknown_key: { total: 0, in_flight: 0, shipped: 0, keys: [] },
        },
      },
    })!.onTrack.initiative!;
    expect(linked.inScope![0].units).toEqual({
      total: 3,
      inFlight: 1,
      shipped: 1,
    });
    expect(linked.unattributed).toEqual({ total: 1, inFlight: 1, shipped: 0 });
    expect(linked.unknownKey).toEqual({
      total: 0,
      inFlight: 0,
      shipped: 0,
      keys: [],
    });
    const withKeys = parseProjectState({
      on_track: {
        state: "read",
        initiative: {
          state: "read",
          alignment: "read",
          unknown_key: {
            total: 2,
            in_flight: 1,
            shipped: 1,
            keys: ["old-key", 7, null, "other-key"],
          },
        },
      },
    })!.onTrack.initiative!;
    expect(withKeys.unknownKey?.keys).toEqual(["old-key", "other-key"]);
    expect(initiativeAttributionPhrase(linked)).toBe(
      "work attributed to it: 1 in flight"
    );

    const unlinked = parseProjectState({
      on_track: {
        state: "read",
        initiative: {
          state: "read",
          alignment: "unknown",
          in_scope: [
            { text: "a", key: "a", units: null, reason: "no_declared_link" },
          ],
        },
      },
    })!.onTrack.initiative!;
    expect(unlinked.inScope![0].units).toBeNull();
    expect(initiativeAttributionPhrase(unlinked)).toBe(
      "work attributed to it: not yet attributable"
    );
  });

  // coord#3053 serves `unknown` for two reasons. A failed unit read is not
  // "not yet attributable": nothing was counted this time.
  it("says the work units could not be read, not 'not yet', when that is coord's reason", () => {
    const failed = parseProjectState({
      on_track: {
        state: "could_not_read",
        initiative: {
          state: "read",
          status: "live",
          alignment: "unknown",
          reason:
            "work_units_could_not_read — the unit read failed, so no attribution was counted",
          in_scope: [
            {
              text: "a",
              key: "a",
              units: null,
              reason: "work_units_could_not_read",
            },
          ],
        },
      },
    })!.onTrack.initiative!;
    expect(initiativeAttributionPhrase(failed)).toBe(
      "work attributed to it: the work units could not be read, so it was not counted"
    );
    const noLink = parseProjectState({
      on_track: {
        state: "read",
        initiative: {
          state: "read",
          alignment: "unknown",
          reason:
            "no_declared_link — no work unit carries metadata.initiative_item yet",
        },
      },
    })!.onTrack.initiative!;
    expect(initiativeAttributionPhrase(noLink)).toBe(
      "work attributed to it: not yet attributable"
    );
    const unstated = parseProjectState({
      on_track: { state: "read", initiative: { state: "read" } },
    })!.onTrack.initiative!;
    expect(initiativeAttributionPhrase(unstated)).toBe(
      "work attributed to it: unknown"
    );
  });
});

describe("round-7 review — blank recommendations, link targets, windows", () => {
  it("reads a whitespace-only recommendation as none, as coord's shape does", () => {
    const view = parseProjectState({
      needs_me: {
        state: "read",
        total: 1,
        items: [{ id: "q-1", fork: "Pick one", recommendation: "   " }],
      },
    })!;
    const item = view.needsMe.items![0];
    expect(item.recommendation).toBeNull();
    expect(needsYouReason(item)).toBe("open question — no recommendation");
  });

  it.each([
    ["/admin/coord/inbox?q=1", "/admin/coord/inbox?q=1"],
    ["https://evil.example/", null],
    ["//evil.example/", null],
    ["/\\evil.example/", null],
    ["javascript:alert(1)", null],
    [null, null],
  ])("internalHref(%p) is %p", (raw, want) => {
    expect(internalHref(raw)).toBe(want);
  });

  it("names the failed poll in the headline even beside coord's always-unread correctness", () => {
    const body = calmBody();
    body.correctness = {
      state: "unknown",
      reason: "verification_metrics_door_absent",
    };
    const strip = deriveHomeStrip(parseProjectState(body), {
      ...CALM_MACHINES,
      stale: true,
    });
    expect(strip.level).toBe("amber");
    expect(strip.headline).toMatch(
      /^Cannot tell now — the latest read failed, at the last good read/
    );
  });

  it.each([
    [86_400, "24 h"],
    [3600, "1 h"],
    [7 * 86_400, "7 d"],
    [null, null],
    [0, null],
  ])("windowLabel(%p) is %p", (secs, want) => {
    expect(windowLabel(secs)).toBe(want);
  });
});

describe("round-8 review — the partial and unread captions say what is true", () => {
  /** coord's degradations block, through the real parser. */
  function deg(block: Record<string, unknown>) {
    return parseProjectState({ degradations: block })!.degradations;
  }

  const STALE_MERGE_TRAIN = {
    merge_train: {
      fresh: false,
      watchers: [
        {
          name: "stuck_pr_watcher",
          state: "stale",
          reason: "no_successful_tick",
        },
      ],
    },
    runner: {
      fresh: true,
      watchers: [{ name: "health_ledger", state: "fresh" }],
    },
  };

  it("never gives the degraded headline's reason as the cause of a stale block's gap", () => {
    // coord: any open row makes the headline `degraded`, and its reason
    // explains that headline, not the staleness.
    const phrase = degradationsGapPhrase(
      deg({
        state: "stale",
        headline: "degraded",
        headline_reason: "at least one operator-plane degradation is open",
        open: [{ id: "alert:1", plane: "runner" }],
        planes: STALE_MERGE_TRAIN,
      })
    );
    expect(phrase).toBe("not every watcher is fresh (merge train)");
  });

  // A label that names only the merge train: every other area is one it
  // will not name, which the phrase must COUNT, never fold into one.
  const onlyMergeTrain = (plane: string | null) =>
    plane === "merge_train" ? "merge train" : null;
  const NO_WATCHER = { fresh: false, watchers: [] };

  it("counts each area its label will not name, one by one", () => {
    const phrase = degradationsGapPhrase(
      deg({
        state: "stale",
        planes: {
          merge_train: STALE_MERGE_TRAIN.merge_train,
          build_capacity: STALE_MERGE_TRAIN.merge_train,
          cloud_service: STALE_MERGE_TRAIN.merge_train,
          disk: NO_WATCHER,
          coord_itself: NO_WATCHER,
        },
      }),
      null,
      onlyMergeTrain
    );
    expect(phrase).toBe(
      "not every watcher is fresh (merge train and 2 areas not named here); readings for 2 other areas not named here could not be taken"
    );
  });

  it("says 1 area, in the singular, when one is not named", () => {
    const phrase = degradationsGapPhrase(
      deg({
        state: "stale",
        planes: {
          build_capacity: STALE_MERGE_TRAIN.merge_train,
          disk: NO_WATCHER,
        },
      }),
      null,
      onlyMergeTrain
    );
    expect(phrase).toBe(
      "not every watcher is fresh (1 area not named here); the reading for 1 other area not named here could not be taken"
    );
  });

  it.each([
    [0, 2, "readings for 2 areas not named here could not be taken"],
    [
      1,
      2,
      "not every watcher is fresh (1 area not named here); readings for 2 other areas not named here could not be taken",
    ],
    [
      2,
      1,
      "not every watcher is fresh (2 areas not named here); the reading for 1 other area not named here could not be taken",
    ],
  ])(
    "counts %i watched and %i unwatched areas not named here as distinct",
    (watchedCount, unwatchedCount, expected) => {
      const planes: Record<string, unknown> = {};
      for (let i = 0; i < watchedCount; i += 1) {
        planes[`watched_${i}`] = STALE_MERGE_TRAIN.merge_train;
      }
      for (let i = 0; i < unwatchedCount; i += 1) {
        planes[`unwatched_${i}`] = NO_WATCHER;
      }
      const phrase = degradationsGapPhrase(
        deg({ state: "stale", planes }),
        null,
        onlyMergeTrain
      );
      expect(phrase).toBe(expected);
    }
  );

  it("lists several named watched areas before the count, without a serial comma", () => {
    const phrase = degradationsGapPhrase(
      deg({
        state: "stale",
        planes: {
          merge_train: STALE_MERGE_TRAIN.merge_train,
          build_capacity: STALE_MERGE_TRAIN.merge_train,
          cloud_service: STALE_MERGE_TRAIN.merge_train,
        },
      }),
      null,
      (plane) => (plane === "cloud_service" ? null : planeLabel(plane))
    );
    expect(phrase).toBe(
      "not every watcher is fresh (merge train, build capacity and 1 area not named here)"
    );
  });

  it("names the areas its label names beside the count of those it will not", () => {
    const phrase = degradationsGapPhrase(
      deg({
        state: "stale",
        planes: {
          merge_train: NO_WATCHER,
          disk: NO_WATCHER,
        },
      }),
      null,
      onlyMergeTrain
    );
    expect(phrase).toBe(
      "the merge train reading could not be taken; the reading for 1 area not named here could not be taken"
    );
  });

  it("(operator) names every distinct key, even two that space to one label", () => {
    const phrase = degradationsGapPhrase(
      deg({
        state: "stale",
        planes: {
          merge_train: NO_WATCHER,
          "merge train": NO_WATCHER,
        },
      })
    );
    expect(phrase).toBe(
      "the merge train reading could not be taken; the merge train reading could not be taken"
    );
  });

  it("names every watched plane served as not fresh, and none served fresh or unstated", () => {
    const phrase = degradationsGapPhrase(
      deg({
        state: "stale",
        headline: "degraded",
        headline_reason: "at least one operator-plane degradation is open",
        planes: {
          ...STALE_MERGE_TRAIN,
          build_capacity: {
            fresh: false,
            watchers: [
              {
                name: "ci_queue_wait",
                state: "unknown",
                reason: "no_heartbeat_row",
              },
            ],
          },
          cloud_service: {
            watchers: [{ name: "github_ratelimit_watcher", state: "fresh" }],
          },
        },
      })
    );
    expect(phrase).toBe(
      "not every watcher is fresh (merge train, build capacity)"
    );
  });

  // coord's real disk shape: the one plane with NO watcher
  // (`PLANE_WATCHERS` `(InfraPlane::Disk, &[])`), whose `fresh` is whether
  // the fleet roster was read with its resource dimension scraped. When that
  // read fails no watcher is involved, so none may be blamed.
  const DISK_NOT_TAKEN = {
    disk: {
      kinds: [],
      joined_sources: [
        "fleet_health resource headroom (a machine whose worst lane reads `breach`)",
      ],
      as_of: null,
      interval_secs: null,
      watchers: [],
      fresh: false,
      detection_bound_secs: 180,
    },
  };

  it("words a no-watcher plane that is not fresh as a reading not taken, never as a watcher", () => {
    const phrase = degradationsGapPhrase(
      deg({
        state: "stale",
        headline: "degraded",
        headline_reason: "at least one operator-plane degradation is open",
        planes: { ...STALE_MERGE_TRAIN, ...DISK_NOT_TAKEN },
      })
    );
    expect(phrase).toBe(
      "not every watcher is fresh (merge train); the disk reading could not be taken"
    );
    const diskOnly = degradationsGapPhrase(
      deg({ state: "stale", headline: "unknown", planes: DISK_NOT_TAKEN })
    );
    expect(diskOnly).toBe("the disk reading could not be taken");
    expect(diskOnly).not.toMatch(/watcher/);
  });

  it.each([
    [true, "read directly, no watcher"],
    [false, "no watcher; its reading could not be taken"],
    [null, "no watcher; freshness not stated"],
  ] as const)(
    "words a no-watcher plane served fresh=%p as %p",
    (fresh, words) => {
      expect(
        planeFreshnessPhrase({
          plane: "disk",
          fresh,
          watchers: [],
          detectionBoundSecs: 180,
        })
      ).toBe(words);
    }
  );

  it.each([
    ["no planes served", undefined],
    ["every plane fresh", { runner: { fresh: true, watchers: [] } }],
  ])(
    "falls back to what `stale` guarantees when the planes show no cause (%s)",
    (_case, planes) => {
      expect(
        degradationsGapPhrase(
          deg({
            state: "stale",
            headline: "degraded",
            headline_reason: "at least one operator-plane degradation is open",
            planes,
          })
        )
      ).toBe(
        "a source feeding it was not fully read, or a watcher feeding it is not fresh"
      );
    }
  );

  /** does_not_know rows, through the real parser. */
  function sources(rows: Record<string, unknown>[]) {
    return parseProjectState({ does_not_know: rows })!.doesNotKnow;
  }

  // coord's `unknown` headline lists the partial sources by their raw ids
  // ("source `fleet_drain` was not fully read"). R8: the page builds the
  // clause from the does_not_know rows instead, in words.
  it("names partial degradation sources in words on the unknown headline, never quoting coord's ids", () => {
    const phrase = degradationsGapPhrase(
      deg({
        state: "stale",
        headline: "unknown",
        headline_reason:
          "a watcher feeding this view is stale or has no heartbeat; source `fleet_drain` was not fully read; source `train_health` was not fully read",
        planes: STALE_MERGE_TRAIN,
      }),
      sources([
        { source: "work_units", state: "read" },
        { source: "fleet_drain", state: "could_not_read", error: "timeout" },
        {
          source: "train_health (per authority repo)",
          state: "stale",
          error: "qontinui-web: derivation timed out",
        },
        { source: "fleet_health roster", state: "read" },
      ])
    );
    expect(phrase).toBe(
      "not every watcher is fresh (merge train); not fully read: machine drains, merge train health"
    );
    expect(phrase).not.toMatch(/`|_|source /);
  });

  it.each([
    [
      "the open-alert read hit its row ceiling",
      { source: "coord.alerts (operator-plane kinds)", state: "stale" },
      "not fully read: infrastructure alerts",
    ],
    [
      "the roster's resource dimension was not scraped",
      { source: "fleet_health roster", state: "stale" },
      "not fully read: machines in the fleet",
    ],
    [
      "the cloud breach read failed",
      {
        source: "infra_health_observations (cloud, latest per resource)",
        state: "could_not_read",
      },
      "not fully read: cloud service health",
    ],
    [
      "the heartbeats could not be read",
      { source: "worker_heartbeats", state: "could_not_read" },
      "not fully read: watcher heartbeats",
    ],
  ])("names a partial source when %s", (_case, row, want) => {
    expect(
      degradationsGapPhrase(
        deg({ state: "stale", headline: "unknown" }),
        sources([row])
      )
    ).toBe(want);
  });

  it.each([
    [
      "a cloud breach read withheld from this caller (not_implemented)",
      {
        source: "infra_health_observations (cloud, latest per resource)",
        state: "not_implemented",
      },
    ],
    [
      "a degradation source read in full",
      { source: "fleet_drain", state: "read" },
    ],
    [
      "a source the degradations block does not read",
      { source: "work_units", state: "could_not_read" },
    ],
  ])("does not count %s as a partial source", (_case, row) => {
    expect(
      degradationsGapPhrase(
        deg({ state: "stale", headline: "unknown" }),
        sources([row])
      )
    ).toBe(
      "a source feeding it was not fully read, or a watcher feeding it is not fresh"
    );
  });

  it("never quotes coord's reason, on any headline", () => {
    for (const headline of ["unknown", "degraded"]) {
      expect(
        degradationsGapPhrase(
          deg({
            state: "stale",
            headline,
            headline_reason: "the train watcher stalled",
          })
        )
      ).toBe(
        "a source feeding it was not fully read, or a watcher feeding it is not fresh"
      );
    }
  });

  // The gap line's title is coord's reason only where that reason explains
  // the gap: the `unknown` headline lists why the block is partial; the
  // `degraded` headline's reason explains only that a row is open.
  it("titles the gap line with coord's reason on the unknown headline only", () => {
    expect(
      degradationsGapTitle(
        deg({
          state: "stale",
          headline: "unknown",
          headline_reason:
            "a watcher feeding this view is stale or has no heartbeat; source `fleet_drain` was not fully read",
        })
      )
    ).toBe(
      "a watcher feeding this view is stale or has no heartbeat; source `fleet_drain` was not fully read"
    );
    expect(
      degradationsGapTitle(
        deg({
          state: "stale",
          headline: "unknown",
          headline_reason: "the train watcher stalled",
        })
      )
    ).toBe("the train watcher without recorded change");
    expect(
      degradationsGapTitle(
        deg({
          state: "stale",
          headline: "degraded",
          headline_reason: "at least one operator-plane degradation is open",
          open: [{ id: "alert:1", plane: "runner" }],
        })
      )
    ).toBeNull();
    expect(
      degradationsGapTitle(deg({ state: "stale", headline: "unknown" }))
    ).toBeNull();
  });

  it.each([
    ["unknown", "verification_metrics_door_absent", true],
    ["not_implemented", "verification_metrics_door_absent", true],
    ["unknown", null, false],
    ["could_not_read", "timeout", false],
    ["stale", null, false],
    ["could_not_read", null, false],
    // A read block is measured: there is a source.
    ["read", "verification_metrics_door_absent", false],
  ] as const)("correctnessHasNoSource(%s, %p) is %p", (state, reason, want) => {
    expect(correctnessHasNoSource({ state, reason })).toBe(want);
  });

  it("reads an absent correctness block as not saying 'no source'", () => {
    expect(correctnessHasNoSource(parseProjectState({})!.correctness)).toBe(
      false
    );
  });

  it.each([
    [1, "Coord counted 1 decision for you but did not serve it"],
    [2, "Coord counted 2 decisions for you but served none of them"],
    [
      null,
      "Coord counted an unknown number of decisions for you but served none of them",
    ],
  ])("unservedDecisionsSentence(%p)", (count, want) => {
    expect(unservedDecisionsSentence(count)).toBe(want);
  });
});

describe("round-8 review — R8 for what the view does not know", () => {
  // Every `source` string coord's door writes into does_not_know, verbatim
  // from qontinui-coord crates/coord/src/project_state.rs (the one-screen
  // door, and its needs_me phase).
  const COORD_SOURCES: ReadonlyArray<readonly [string, string]> = [
    ["prompt_documents:initiative/current-initiative", "Current initiative"],
    ["work_unit_dependency_frontier", "Work unit dependencies"],
    ["work_units", "Work units"],
    ["work_unit_status_history", "Work unit status changes"],
    [
      "work_unit_pr_citations (cited PR state)",
      "Pull requests the work units cite",
    ],
    ["coord.alerts (operator-plane kinds)", "Infrastructure alerts"],
    [
      "coord.alerts visibility (operator-plane kinds this caller can be served)",
      "Which infrastructure alerts the operator can be shown",
    ],
    ["fleet_health roster", "Machines in the fleet"],
    [
      "fleet_health resource headroom (live machines)",
      "Spare capacity on live machines",
    ],
    ["train_health (per authority repo)", "Merge train health, per repository"],
    [
      "infra_health_observations (cloud, latest per resource)",
      "Cloud service health",
    ],
    ["fleet_drain", "Machine drains"],
    ["worker_heartbeats", "Watcher heartbeats"],
    ["fault_to_visibility_metric", "Time for a fault to reach this view"],
    ["verification_metrics", "Verification measurements"],
    [
      "needs_me (agent_questions operator audience + operator gates)",
      "Decisions waiting on you",
    ],
    [
      "agent_questions (pending, audience operator)",
      "Questions waiting on you",
    ],
    [
      "gates (open operator_approval, clearance_audience operator)",
      "Approvals waiting on you",
    ],
    [
      "agent_questions.recommendation / if_overturned",
      "Recommendations on your questions",
    ],
    ["agent_questions.withdrawn_at", "Whether questions were withdrawn"],
  ];

  it.each(COORD_SOURCES)("labels coord's %p as %p", (source, label) => {
    expect(sourceLabel(source)).toBe(label);
  });

  it.each(COORD_SOURCES)(
    "puts no internal token in the label for %p",
    (source) => {
      expect(sourceLabel(source)).not.toMatch(/_|:|\(|\./);
    }
  );

  const PLANES = parseProjectState({
    degradations: {
      planes: {
        runner: {
          fresh: false,
          watchers: [{ name: "health_ledger", state: "stale" }],
        },
        credential: {
          fresh: false,
          watchers: [{ name: "health_ledger", state: "stale" }],
        },
        merge_train: {
          fresh: false,
          watchers: [{ name: "stuck_pr_watcher", state: "stale" }],
        },
      },
    },
  })!.degradations.planes;

  it("names a watcher row by the area it feeds, never by the watcher's name", () => {
    expect(sourceLabel("watcher:stuck_pr_watcher", PLANES)).toBe(
      "Watcher feeding merge train"
    );
    expect(sourceLabel("watcher:health_ledger", PLANES)).toBe(
      "Watcher feeding runner, credential"
    );
  });

  it.each([
    ["a watcher no plane lists", "watcher:leader_flap_watcher", PLANES],
    ["no planes served", "watcher:stuck_pr_watcher", null],
  ] as const)("still words a watcher row with %s", (_case, source, planes) => {
    expect(sourceLabel(source, planes)).toBe("Watcher feeding Degrading");
  });

  it("counts a watcher row's areas its label will not name", () => {
    const onlyRunner = (plane: string | null) =>
      plane === "runner" ? "runner" : null;
    // health_ledger feeds runner and credential; stuck_pr_watcher, merge train.
    expect(sourceLabel("watcher:health_ledger", PLANES, onlyRunner)).toBe(
      "Watcher feeding runner and 1 area not named here"
    );
    expect(sourceLabel("watcher:stuck_pr_watcher", PLANES, onlyRunner)).toBe(
      "Watcher feeding 1 area not named here"
    );
    expect(sourceLabel("watcher:health_ledger", PLANES, () => null)).toBe(
      "Watcher feeding 2 areas not named here"
    );
  });

  it("spaces a source it has no label for, as it does an unknown domain", () => {
    expect(sourceLabel("deploy_freshness_feed")).toBe("Deploy freshness feed");
  });

  const row = (over: Partial<Record<string, unknown>>) =>
    parseProjectState({ does_not_know: [{ source: "work_units", ...over }] })!
      .doesNotKnow![0];

  it("words a collapsed row in full, never as '–' shorthand", () => {
    expect(sourceRowReason(row({ state: "read" }))).toBe(
      "maximum age not stated · exclusions not stated"
    );
    expect(
      sourceRowReason(
        row({ state: "read", freshness_bound_secs: 600, rows_excluded: 2 })
      )
    ).toBe("may be up to 10m old · 2 excluded");
    expect(
      sourceRowReason(row({ state: "could_not_read", error: "timeout" }))
    ).toBe(
      "coord reported an error · maximum age not stated · exclusions not stated"
    );
  });

  it("words a watcher row's reason token, keeping the token for the raw line", () => {
    const w = row({
      source: "watcher:stuck_pr_watcher",
      state: "stale",
      freshness_bound_secs: 300,
      error: "no_successful_tick",
    });
    expect(sourceErrorWords(w)).toBe("no successful run on record");
    expect(sourceErrorSentence(w)).toBe("No successful run on record.");
    expect(sourceRowReason(w)).toBe(
      "no successful run on record · freshness bound 5m · exclusions not stated"
    );
    expect(sourceRawLine(w)).toBe(
      "watcher:stuck_pr_watcher · no_successful_tick"
    );
  });

  // A watcher row's `freshness_bound_secs` is coord's copy of the watcher's
  // `bound_secs`: the THRESHOLD its verdict applies, not the age of any data.
  // An overdue watcher's last success is OLDER than it, so "may be up to 1m
  // 30s old" would be false. 90 s is coord's smallest watcher bound: 3 x the
  // ledger's 30 s throttle floor — and it is not "1m".
  it("words an overdue watcher's bound as the threshold its last success passed", () => {
    const overdue = row({
      source: "watcher:merge_scheduler.dispatch",
      state: "stale",
      freshness_bound_secs: 90,
      error: "last_success_older_than_3x_interval",
    });
    expect(sourceRowReason(overdue)).toBe(
      "last run is overdue · last success older than its 1m 30s freshness bound · exclusions not stated"
    );
    expect(sourceRowReason(overdue)).not.toMatch(/may be up to/);
  });

  // coord's real train-health row: its bound is TRAIN_HEALTH_CACHE_TTL, 20 s
  // (qontinui-coord `pr_merge/train_health.rs`, copied by `project_state.rs`).
  // Rounded down to the minute it read "may be up to 0m old" — current data,
  // when the memo can be 20 s old.
  it("words coord's 20 s train-health bound to the second", () => {
    const train = {
      source: "train_health (per authority repo)",
      freshness_bound_secs: 20,
      rows_considered: 4,
    };
    expect(sourceAgePhrase(row({ ...train, state: "read" }))).toBe(
      "may be up to 20s old"
    );
    expect(sourceRowReason(row({ ...train, state: "read" }))).toBe(
      "may be up to 20s old · exclusions not stated"
    );
    expect(
      sourceAgePhrase(row({ ...train, state: "stale", rows_excluded: 1 }))
    ).toBe("freshness bound 20s");
  });

  it.each([
    [0, "0s"],
    [1, "1s"],
    [20, "20s"],
    [59, "59s"],
    [60, "1m"],
    [61, "1m 1s"],
    [90, "1m 30s"],
    [135, "2m 15s"],
    [300, "5m"],
    [3599, "59m 59s"],
    [3600, "1h"],
    [3690, "1h 1m 30s"],
    [5400, "1h 30m"],
    [86_399, "23h 59m 59s"],
    [86_400, "1d"],
    [90_061, "1d 1h 1m 1s"],
    [259_200, "3d"],
  ])("writes a %ps bound exactly, as %p", (secs, want) => {
    expect(boundText(secs)).toBe(want);
  });

  // Not values coord's integer seconds produce; quoted, never rounded into a
  // different bound.
  it.each([
    [-5, "-5s"],
    [20.5, "20.5s"],
  ])(
    "quotes a bound coord's integers cannot produce (%p) as itself",
    (secs, want) => {
      expect(boundText(secs)).toBe(want);
    }
  );

  it.each([
    [
      "a watcher row with no bound",
      { source: "watcher:x", state: "unknown", error: "no_heartbeat_row" },
      "freshness bound not stated",
    ],
    [
      "a source read in full",
      {
        source: "train_health (per authority repo)",
        state: "read",
        freshness_bound_secs: 300,
      },
      "may be up to 5m old",
    ],
    [
      "a source NOT read in full",
      {
        source: "train_health (per authority repo)",
        state: "stale",
        freshness_bound_secs: 300,
      },
      "freshness bound 5m",
    ],
    [
      "a source with no bound",
      { source: "fleet_drain", state: "read" },
      "maximum age not stated",
    ],
  ])("words the bound of %s as %p", (_case, over, want) => {
    expect(sourceAgePhrase(row(over))).toBe(want);
  });

  // R8: a non-watcher row's error is coord's error chain — internal
  // vocabulary — so it reaches only the expanded detail's last line.
  it("keeps a non-watcher error chain off the row and quotes it on the raw line, without the stalled class", () => {
    const r = row({
      state: "could_not_read",
      error:
        "SELECT coord.work_units (project-state class split): the work_units sub-read stalled",
    });
    expect(sourceErrorWords(r)).toBe("coord reported an error");
    expect(sourceRowReason(r)).not.toMatch(/SELECT|coord\.work_units|stalled/);
    expect(sourceErrorSentence(r)).toBe(
      "Coord reported an error; it is quoted on the last line."
    );
    expect(sourceRawLine(r)).toBe(
      "work_units · SELECT coord.work_units (project-state class split): the work_units sub-read without recorded change"
    );
    expect(sourceRawLine(row({ state: "read" }))).toBe("work_units");
  });

  // A watcher row's `as_of` is the watcher's freshest SUCCESSFUL run, not a
  // read; a source row's is when coord read it.
  it("captions a watcher row's time as its last successful run, never as a read", () => {
    expect(
      sourceTimeWords(row({ source: "watcher:health_ledger", state: "stale" }))
    ).toEqual({
      verb: "Last successful run",
      absentLabel: "last success: unknown",
      absentTitle: "No successful run time was served for this watcher",
    });
    expect(sourceTimeWords(row({ state: "read" }))).toEqual({
      verb: "Read",
      absentLabel: "as of: unknown",
      absentTitle: "Coord recorded no read time",
    });
  });
});

describe("round-2 review — what a named unit's age, a subject and a failed read say", () => {
  const unit = (over: Record<string, unknown>) =>
    parseProjectState({
      on_track: {
        state: "read",
        groups: [
          {
            key: "r",
            kind: "repo",
            named: {
              waiting_on_gate: { units: [{ slug: "s", ...over }], omitted: 0 },
            },
          },
        ],
      },
    })!.onTrack.groups![0].named.waitingOnGate!.units[0];

  // coord's waiting_on_gate list is aged from first_in_progress_at, and holds
  // ANY unfinished in-vocabulary unit with an open gate — a draft one too.
  it.each([
    [
      "a draft unit that never started",
      {
        first_in_progress_at: null,
        age_secs: null,
        age_basis: "first_in_progress",
      },
      "never recorded in progress",
    ],
    [
      "a vetted unit that was once in progress",
      {
        first_in_progress_at: "2026-08-21T00:00:00Z",
        age_secs: 40 * 86_400,
        age_basis: "first_in_progress",
      },
      "first in progress 40d 0h ago",
    ],
    [
      "a unit with no recorded change in the window",
      {
        last_recorded_change_at: "2026-09-02T00:00:00Z",
        age_secs: 28 * 86_400,
        age_basis: "last_recorded_change",
      },
      "last change 28d 0h ago",
    ],
    [
      "an age whose basis coord did not state",
      { age_secs: 3600 },
      "age not stated",
    ],
  ])("words %s as %p, never 'in progress for'", (_case, over, want) => {
    const phrase = namedUnitAgePhrase(unit(over));
    expect(phrase).toBe(want);
    expect(phrase).not.toMatch(/in progress for/);
  });

  it("labels the blocked class so it is true of a self-declared block too", () => {
    expect(unitClassLabel("blocked_on_dependency", null)).toBe(
      "blocked or waiting on other work"
    );
  });

  it("keeps a degradation's subject id off the collapsed row, on the raw line", () => {
    const d = parseProjectState({
      degradations: {
        state: "read",
        open: [
          {
            id: "fleet_health:resource:dev-1",
            subject: { kind: "device", name: "box-1", id: "dev-1" },
            auto_remediation: { bound: true, response: "agent:runner_restart" },
          },
          { id: "fleet_drain:dev-2", subject: { kind: "device", id: "dev-2" } },
        ],
      },
    })!.degradations.open!;
    expect(degradationSubjectText(d[0])).toBe("box-1");
    expect(degradationRawLine(d[0])).toBe(
      "fleet_health:resource:dev-1 · subject dev-1 · agent:runner_restart"
    );
    expect(degradationSubjectText(d[1])).toBe("unnamed subject");
    expect(degradationRawLine(d[1])).toBe("fleet_drain:dev-2 · subject dev-2");
  });

  /** A rejection from `readJson`, in its exact shape. */
  const rejected = (status: number, body: string) =>
    new Error(
      `GET /api/v1/operations/project-state failed: ${status} - ${body}`
    );

  const TIMEOUT_504 =
    '{"error":"GATEWAY_TIMEOUT","message":"timeout waiting for coord","refusal":{"code":"upstream_timeout","detail":"timeout waiting for coord","discriminator":"coord_timeout","glossary_terms":["coord"],"next_action":{"kind":"retry_later"},"observed_at":"2026-10-27T16:27:56.834400+00:00","source":"web_backend"},"timestamp":1793118476.83,"path":"https://api.example.test/api/v1/operations/project-state"}';
  const UNREACHABLE_502 =
    '{"error":"BAD_GATEWAY","message":"coord is not reachable","refusal":{"code":"upstream_unavailable","detail":"coord is not reachable","discriminator":"coord_unreachable","glossary_terms":["coord"],"next_action":{"kind":"retry_later"},"observed_at":"2026-10-27T16:27:56.834400+00:00","source":"web_backend"}}';

  it.each([
    [
      "the proxy's 504 coord_timeout refusal",
      rejected(504, TIMEOUT_504),
      "A service this operation depends on did not answer in time (coord_timeout). Try again later",
    ],
    [
      "the proxy's 502 coord_unreachable refusal",
      rejected(502, UNREACHABLE_502),
      "A service this operation depends on could not be reached (coord_unreachable). Try again later",
    ],
    [
      "a deployment without the route",
      rejected(404, '{"error":"NOT_FOUND","message":"Not Found"}'),
      "this deployment does not serve the project-state door yet — unknown",
    ],
    [
      "coord's read deadline",
      rejected(503, '{"error":"deadline","budget_ms":8000}'),
      "coord read deadline (8000 ms) exceeded — unknown",
    ],
    [
      "a coord 500 with no refusal envelope",
      rejected(500, '{"error":"INTERNAL","message":"coord: internal"}'),
      'GET /api/v1/operations/project-state failed: 500 - {"error":"INTERNAL","message":"coord: internal"}',
    ],
    ["a network failure", new TypeError("Failed to fetch"), "Failed to fetch"],
    [
      "a message that ends in a full stop",
      new Error(
        "Request timeout - backend may be starting up. Please try again."
      ),
      "Request timeout - backend may be starting up. Please try again",
    ],
  ])("words %s for the page, with no closing full stop", (_case, err, want) => {
    const text = projectStateErrorText(err);
    expect(text).toBe(want);
    expect(text).not.toMatch(/\.$/);
  });
});

describe("a served key spelled like an Object.prototype member", () => {
  // Coord serves these keys as strings, and its `needs_me` work
  // (qontinui-coord#3053 and its successor) parses some of them out of
  // caller-controlled text, so nothing stops one being spelled `constructor`.
  // Each lookup owes its fallback, never what the prototype carries.
  const PROTOTYPE_KEYS = [
    "constructor",
    "toString",
    "hasOwnProperty",
    "__proto__",
  ];

  it.each(PROTOTYPE_KEYS)(
    "%s is not a decision kind the table names",
    (key) => {
      expect(decisionDomainLabel(key)).toBe(key.replace(/_/g, " "));
      expect(isKnownDecisionDomain(key)).toBe(false);
    }
  );

  it.each(PROTOTYPE_KEYS)("%s is not a plane the table names", (key) => {
    expect(planeLabel(key)).toBe(key.replace(/_/g, " "));
    expect(isKnownPlane(key)).toBe(false);
  });

  it("names a plane the table holds, and calls no plane unclassified", () => {
    expect(isKnownPlane("merge_train")).toBe(true);
    expect(isKnownPlane("merge train")).toBe(false);
    expect(planeLabel("merge_train")).toBe("merge train");
    expect(planeLabel(null)).toBe("unclassified");
    expect(planeLabel("")).toBe("unclassified");
  });

  it.each(PROTOTYPE_KEYS)("%s is not a source the table labels", (key) => {
    const spaced = key.replace(/_/g, " ");
    expect(sourceLabel(key)).toBe(
      spaced.charAt(0).toUpperCase() + spaced.slice(1)
    );
    expect(isLabelledSource(key)).toBe(false);
  });

  it.each(PROTOTYPE_KEYS)("%s is not a watcher reason or state", (key) => {
    expect(watcherReasonWords(key)).toBe("state unknown");
    expect(watcherReasonWords(null, key)).toBe("state unknown");
    // A known state still words a reason the table does not hold.
    expect(watcherReasonWords(key, "stale")).toBe("stale");
  });

  it.each(PROTOTYPE_KEYS)(
    "%s is not a degradation source with words",
    (key) => {
      const body = parseProjectState({
        degradations: { state: "read", partial: true, planes: [] },
        does_not_know: [{ source: key, state: "could_not_read" }],
      })!;
      expect(degradationsGapPhrase(body.degradations, body.doesNotKnow)).toBe(
        "a source feeding it was not fully read, or a watcher feeding it is not fresh"
      );
    }
  );

  it("keeps a decision count keyed __proto__, as its own entry", () => {
    // `JSON.parse`, as the wire does: an object literal would set the prototype.
    const raw = JSON.parse(
      '{"state":"read","total":4,"items":[],"by_domain":{"__proto__":3,"pr_fix":1}}'
    ) as unknown;
    const byDomain = parseProjectState({ needs_me: raw })!.needsMe.byDomain!;
    expect(Object.entries(byDomain)).toEqual([
      ["__proto__", 3],
      ["pr_fix", 1],
    ]);
    expect(Object.getPrototypeOf(byDomain)).toBe(Object.prototype);
  });
});
