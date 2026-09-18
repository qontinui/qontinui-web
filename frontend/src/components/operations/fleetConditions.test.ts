/**
 * fleetConditions — the Dev Ops Conditions verdict (plan
 * `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
 * Phase 8). Pure, so every rule it encodes is asserted here without a DOM;
 * the page's wiring is asserted in `admin/coord/devops/page.test.tsx`.
 */

import { describe, expect, it } from "vitest";
import {
  QUESTION_QUEUE_HREF,
  formatAgeSecs,
  questionsHrefFor,
  summarizeFleetConditions,
} from "./fleetConditions";
import type { FleetHealthConditions, FleetHealthPayload } from "./useFleetHealth";

const NOW = Date.parse("2026-09-18T12:00:00Z");

function measured(
  overrides: Partial<FleetHealthConditions> = {}
): FleetHealthConditions {
  return {
    open: 0,
    claimed: 0,
    unclaimed: 0,
    unclaimed_oldest_age_secs: null,
    unclaimed_by_domain: {
      merge_train: 0,
      dev_ops: 0,
      cleanup: 0,
      return_to_main: 0,
      pr_fix: 0,
      red_main_fix: 0,
      gate_owner: 0,
      plan_owner: 0,
    },
    awaiting_operator: 0,
    awaiting_operator_question_ids: [],
    settings_in_effect: [],
    scrape_up: true,
    ...overrides,
  };
}

function summarize(
  data: FleetHealthPayload | null,
  { loading = false, error = null as string | null } = {}
) {
  return summarizeFleetConditions({ data, loading, error, nowMs: NOW });
}

describe("summarizeFleetConditions — what may be called 'Nothing unhandled'", () => {
  it("says it on a measured zero with nothing waiting, in green", () => {
    const s = summarize({ conditions: measured({ open: 3, claimed: 3 }) });
    expect(s.state).toBe("clear");
    expect(s.headline).toBe("Nothing unhandled");
    expect(s.level).toBe("green");
    expect(s.detail).toContain("3 open conditions are all claimed by agents");
  });

  it("still says it, but not in green, when a question waits on the operator", () => {
    const s = summarize({
      conditions: measured({
        awaiting_operator: 2,
        awaiting_operator_question_ids: ["a", "b"],
      }),
    });
    expect(s.headline).toBe("Nothing unhandled");
    expect(s.level).toBe("red");
    expect(s.detail).toContain("2 questions are waiting on you");
  });

  it("holds amber when whether anything waits on the operator is unknown", () => {
    const s = summarize({ conditions: measured({ awaiting_operator: null }) });
    expect(s.headline).toBe("Nothing unhandled");
    expect(s.level).toBe("amber");
    expect(s.awaitingOperator).toBeNull();
  });

  it("never says it when coord did not say whether the query ran", () => {
    const s = summarize({ conditions: measured({ scrape_up: undefined }) });
    expect(s.headline).not.toBe("Nothing unhandled");
    expect(s.state).toBe("unknown-count-missing");
    expect(s.level).toBe("amber");
  });

  it("never says it when the unclaimed count is missing", () => {
    const s = summarize({ conditions: measured({ unclaimed: null }) });
    expect(s.headline).toBe("Unknown — coord served no unclaimed count");
    expect(s.unclaimed).toBeNull();
  });
});

describe("summarizeFleetConditions — the unknown states", () => {
  it("reads an ABSENT block as not reported, never as zero", () => {
    const s = summarize({ devices: [] });
    expect(s.state).toBe("unknown-not-reported");
    expect(s.headline).toBe("Unknown — coord does not report conditions yet");
    expect(s.level).toBe("amber");
    expect(s.unclaimed).toBeNull();
    expect(s.awaitingOperator).toBeNull();
    expect(s.settings).toBeNull();
  });

  it("reads scrape_up: false as a failed query, every count unknown", () => {
    const s = summarize({
      conditions: {
        open: null,
        claimed: null,
        unclaimed: null,
        unclaimed_oldest_age_secs: null,
        awaiting_operator: null,
        awaiting_operator_question_ids: [],
        settings_in_effect: [],
        scrape_up: false,
      },
    });
    expect(s.state).toBe("unknown-scrape-failed");
    expect(s.headline).toBe("Unknown — health query failed");
    expect(s.unclaimed).toBeNull();
    expect(s.settings).toBeNull();
  });

  it("does not believe zeros beside scrape_up: false", () => {
    const s = summarize({
      conditions: measured({ scrape_up: false }),
    });
    expect(s.headline).toBe("Unknown — health query failed");
    expect(s.unclaimed).toBeNull();
  });

  it("says the read failed when there is no body and an error", () => {
    const s = summarize(null, { error: "HTTP 502" });
    expect(s.state).toBe("unknown-read-failed");
    expect(s.headline).toBe("Unknown — fleet health read failed");
    expect(s.detail).toContain("HTTP 502");
  });

  it("is loading, not unknown-and-empty, before the first answer", () => {
    const s = summarize(null, { loading: true });
    expect(s.state).toBe("loading");
    expect(s.level).toBe("amber");
  });

  it("keeps a retained answer behind a failed latest read, and says so", () => {
    const s = summarize(
      { conditions: measured() },
      { error: "network down" }
    );
    expect(s.headline).toBe("Nothing unhandled");
    expect(s.detail).toContain("latest fleet-health read failed");
  });
});

describe("summarizeFleetConditions — unhandled conditions", () => {
  it("names the count, the oldest age and the owners with work", () => {
    const s = summarize({
      conditions: measured({
        open: 10,
        claimed: 3,
        unclaimed: 7,
        unclaimed_oldest_age_secs: 90 * 60,
        unclaimed_by_domain: {
          merge_train: 4,
          dev_ops: 0,
          cleanup: 3,
          return_to_main: 0,
          pr_fix: 0,
          red_main_fix: 0,
          gate_owner: 0,
          plan_owner: 0,
        },
      }),
    });
    expect(s.state).toBe("unhandled");
    expect(s.level).toBe("amber");
    expect(s.headline).toBe("7 conditions no agent is handling");
    expect(s.detail).toContain("the oldest has waited 1h 30m");
    expect(s.byDomain).toEqual([
      { domain: "merge_train", label: "merge train", count: 4 },
      { domain: "cleanup", label: "cleanup", count: 3 },
    ]);
  });

  it("uses the singular for one", () => {
    const s = summarize({
      conditions: measured({ unclaimed: 1, unclaimed_oldest_age_secs: 30 }),
    });
    expect(s.headline).toBe("1 condition no agent is handling");
  });

  it("says the oldest age is unknown rather than inventing one", () => {
    const s = summarize({
      conditions: measured({ unclaimed: 2, unclaimed_oldest_age_secs: null }),
    });
    expect(s.detail).toContain("the oldest one's age is unknown");
  });

  it("keeps a domain this build does not know, after the known ones", () => {
    const s = summarize({
      conditions: measured({
        unclaimed: 3,
        unclaimed_by_domain: { pr_fix: 1, release_owner: 2 },
      }),
    });
    expect(s.byDomain).toEqual([
      { domain: "pr_fix", label: "PR fix", count: 1 },
      { domain: "release_owner", label: "release owner", count: 2 },
    ]);
  });
});

describe("summarizeFleetConditions — settings in effect", () => {
  it("names each setting and ages it", () => {
    const s = summarize({
      conditions: measured({
        settings_in_effect: [
          { kind: "kill_switch_fired", since: "2026-09-18T09:00:00Z" },
          { kind: "some_new_setting", since: null },
        ],
      }),
    });
    expect(s.settings).toEqual([
      {
        kind: "kill_switch_fired",
        label: "merge kill switch on",
        since: "2026-09-18T09:00:00Z",
        sinceLabel: "3h ago",
      },
      {
        kind: "some_new_setting",
        label: "some new setting",
        since: undefined,
        sinceLabel: "since an unknown time",
      },
    ]);
    // Settings never move the level.
    expect(s.level).toBe("green");
  });

  it("separates 'none in effect' from 'not reported'", () => {
    expect(summarize({ conditions: measured() }).settings).toEqual([]);
    expect(
      summarize({ conditions: measured({ settings_in_effect: null }) }).settings
    ).toBeNull();
  });
});

describe("questionsHrefFor", () => {
  it("opens the one question directly, and the queue otherwise", () => {
    expect(questionsHrefFor(["abc"])).toBe(`${QUESTION_QUEUE_HREF}/abc`);
    expect(questionsHrefFor([])).toBe(QUESTION_QUEUE_HREF);
    expect(questionsHrefFor(["a", "b"])).toBe(QUESTION_QUEUE_HREF);
  });
});

describe("formatAgeSecs", () => {
  it("renders seconds, minutes, hours and days", () => {
    expect(formatAgeSecs(42)).toBe("42s");
    expect(formatAgeSecs(12 * 60)).toBe("12m");
    expect(formatAgeSecs(3 * 3600)).toBe("3h");
    expect(formatAgeSecs(3 * 3600 + 5 * 60)).toBe("3h 5m");
    expect(formatAgeSecs(3 * 86400)).toBe("3d");
    expect(formatAgeSecs(3 * 86400 + 4 * 3600)).toBe("3d 4h");
    expect(formatAgeSecs(-5)).toBe("0s");
  });
});
