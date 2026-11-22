import { describe, expect, it } from "vitest";
import {
  basisSentence,
  deriveTopicStatus,
  inTopicTab,
  intentRefWords,
  lifecycleWords,
  sortMembers,
  topicReadFailureWords,
  topicTabCounts,
  topicTabOf,
  weightText,
  workingText,
} from "./topicStatus";

describe("deriveTopicStatus", () => {
  const base = {
    headline: "stalled",
    top_reason: "waits on a closed author",
    last_rollup_as_of: "2026-11-20T12:00:00Z",
    unknown_members: 0,
  };

  it("words coord's cached rollup and makes stalled red", () => {
    const s = deriveTopicStatus(base);
    expect(s.kind).toBe("stalled");
    expect(s.reason).toBe("waits on a closed author");
    expect(s.attention).toBe("author");
  });

  it("a topic never rolled up is unknown, never done", () => {
    const s = deriveTopicStatus({ ...base, headline: null, top_reason: null });
    expect(s.kind).toBe("unknown");
    expect(s.attention).toBe("waiting");
    expect(s.reason).toMatch(/not rolled this topic up/);
  });

  it("an unknown rollup names how many members could not be read", () => {
    const s = deriveTopicStatus({
      ...base,
      headline: "unknown",
      top_reason: null,
      unknown_members: 2,
    });
    expect(s.reason).toBe("2 members could not be read");
  });

  it("a headline this build does not know is unknown, not dropped", () => {
    const s = deriveTopicStatus({ ...base, headline: "frobbed" });
    expect(s.kind).toBe("unknown");
    expect(s.reason).toMatch(/frobbed/);
  });
});

describe("tabs and counts", () => {
  it("counts are null — rendered as a dash — until a read answered", () => {
    expect(topicTabCounts(null).all).toBeNull();
    expect(topicTabCounts(null).stalled).toBeNull();
  });

  it("counts each tab from the served list; a measured zero is 0", () => {
    const counts = topicTabCounts([
      { headline: "stalled" },
      { headline: "working" },
      { headline: null },
    ]);
    expect(counts).toEqual({
      needs_you: 0,
      stalled: 1,
      working: 1,
      waiting: 0,
      done: 0,
      all: 3,
    });
  });

  it("a topic never rolled up is listed under All only", () => {
    expect(inTopicTab({ headline: null }, "all")).toBe(true);
    expect(inTopicTab({ headline: null }, "done")).toBe(false);
  });

  it("an unknown tab in the URL falls back to All", () => {
    expect(topicTabOf("stalled")).toBe("stalled");
    expect(topicTabOf("bogus")).toBe("all");
    expect(topicTabOf(null)).toBe("all");
  });

  it("working/total renders a dash for an unknown half", () => {
    expect(
      workingText({ subprojects_working: null, subprojects_total: 3 })
    ).toBe("–/3");
  });
});

describe("basisSentence", () => {
  it("renders each signal as a plain sentence", () => {
    expect(
      basisSentence({ signal: "plan_family", ref: "2026-10-03-x", score: 0.9 })
    ).toBe("shares plan `2026-10-03-x`");
    expect(basisSentence({ signal: "declared", ref: "abc", score: 1 })).toBe(
      "tagged by session abc"
    );
  });

  it("a family that could not be read says so", () => {
    expect(
      basisSentence({ signal: "semantic", ref: "could_not_read", score: null })
    ).toBe("could not read similar wording");
  });
});

describe("members", () => {
  it("sorts confirmed first, heaviest first", () => {
    const sorted = sortMembers([
      { state: "proposed", weight: 0.9 },
      { state: "confirmed", weight: 0.4 },
      { state: "confirmed", weight: 0.8 },
      { state: "rejected", weight: 1 },
    ]);
    expect(sorted.map((m) => `${m.state}:${m.weight}`)).toEqual([
      "confirmed:0.8",
      "confirmed:0.4",
      "proposed:0.9",
      "rejected:1",
    ]);
  });

  it("a weight coord did not send is a dash", () => {
    expect(weightText(null)).toBe("–");
    expect(weightText(0.825)).toBe("83%");
  });
});

it("a pending migration says topics are not available yet", () => {
  expect(topicReadFailureWords({ kind: "migration_pending" })).toBe(
    "topics not available yet (migration pending)"
  );
});

it("names the lifecycle filter and the states the list served", () => {
  expect(
    lifecycleWords([
      { status: "proposed" },
      { status: "active" },
      { status: "active" },
    ])
  ).toBe(
    "Listed under coord's default lifecycle filter (active 2, proposed 1); topics in other states may not be shown."
  );
});

describe("intentRefWords", () => {
  it("is null for no anchor", () => {
    expect(intentRefWords(null)).toBeNull();
    expect(intentRefWords(undefined)).toBeNull();
    expect(intentRefWords({})).toBeNull();
  });
  it("names kind/name and the claim when present", () => {
    expect(intentRefWords({ kind: "product_intent", name: "roadmap" })).toBe(
      "product_intent/roadmap"
    );
    expect(
      intentRefWords({ kind: "domain_spec", name: "coord", claim: "c-1" })
    ).toBe('domain_spec/coord, claim "c-1"');
  });
  it("keeps an unrecognised shape visible as JSON", () => {
    expect(intentRefWords({ uri: "x" })).toBe('{"uri":"x"}');
  });
});
