import { describe, expect, it } from "vitest";
import {
  buildSchedulePatch,
  draftFromMetadata,
  draftIsUnchanged,
  parseUnitList,
  validateDraft,
} from "./scheduleDraft";

const STORED = {
  depends_on: ["unrelated"],
  phases: [
    { index: 1, name: "F1", milestone: "V1", planned_end: "2026-12-01" },
    { index: 2, name: "F2" },
  ],
  phase_units: { "1": ["child-a", "child-b"] },
  parent: "the-programme",
  parent_phase: 3,
  intent_initiative: "initiative/current-initiative",
};

describe("draftFromMetadata", () => {
  it("reads the five schedule keys and ignores every other key", () => {
    const d = draftFromMetadata(STORED);
    expect(d.phases).toHaveLength(2);
    expect(d.phases[0]).toMatchObject({
      index: "1",
      name: "F1",
      milestone: "V1",
      plannedEnd: "2026-12-01",
      units: "child-a, child-b",
    });
    expect(d.phases[1].units).toBe("");
    expect(d.parent).toBe("the-programme");
    expect(d.parentPhase).toBe("3");
    expect(d.intentInitiative).toBe("initiative/current-initiative");
    expect(d.unreadable).toBe(0);
  });

  it("counts, never drops, an entry it cannot read", () => {
    const d = draftFromMetadata({
      phases: [{ index: "x", name: "bad" }, { index: 4, name: "ok" }, 7],
      phase_units: { "4": "not-an-array" },
    });
    expect(d.phases.map((p) => p.index)).toEqual(["4"]);
    expect(d.unreadable).toBe(3);
  });

  it("counts an entry carrying a field the panel does not edit", () => {
    const d = draftFromMetadata({
      phases: [{ index: 1, name: "F1", owner: "somebody" }],
    });
    expect(d.phases).toHaveLength(0);
    expect(d.unreadable).toBe(1);
  });

  it("counts shapes a save would otherwise erase silently", () => {
    // phase_units for a phase the list does not declare.
    expect(
      draftFromMetadata({ phases: [], phase_units: { "5": ["x"] } }).unreadable
    ).toBe(1);
    // wrong-typed optional phase fields.
    expect(
      draftFromMetadata({ phases: [{ index: 1, name: "A", milestone: 3 }] })
        .unreadable
    ).toBe(1);
    // wrong-typed link fields.
    expect(
      draftFromMetadata({ parent: 3, intent_initiative: [], parent_phase: "2" })
        .unreadable
    ).toBe(3);
  });

  it("reads absent or non-object metadata as an empty schedule", () => {
    for (const m of [undefined, null, [], "x"]) {
      const d = draftFromMetadata(m);
      expect(d.phases).toEqual([]);
      expect(d.unreadable).toBe(0);
    }
  });
});

describe("buildSchedulePatch", () => {
  it("round-trips what is stored", () => {
    const patch = buildSchedulePatch(draftFromMetadata(STORED));
    expect(patch.phases).toEqual(STORED.phases);
    expect(patch.phase_units).toEqual(STORED.phase_units);
    expect(patch.parent).toBe("the-programme");
    expect(patch.parent_phase).toBe(3);
    expect(Object.keys(patch).sort()).toEqual(
      [
        "intent_initiative",
        "parent",
        "parent_phase",
        "phase_units",
        "phases",
      ].sort()
    );
  });

  it("sends null for an emptied field so coord removes the key", () => {
    const patch = buildSchedulePatch(draftFromMetadata({}));
    expect(patch).toEqual({
      phases: null,
      phase_units: null,
      parent: null,
      parent_phase: null,
      intent_initiative: null,
    });
  });

  it("links units by the typed index, deduplicated", () => {
    const d = draftFromMetadata({});
    d.phases = [
      {
        index: "02",
        name: "Two",
        milestone: "",
        plannedStart: "",
        plannedEnd: "",
        units: "a, b a,,b",
      },
    ];
    expect(buildSchedulePatch(d).phase_units).toEqual({ "2": ["a", "b"] });
  });
});

describe("validateDraft", () => {
  it("is quiet for a clean draft", () => {
    expect(validateDraft(draftFromMetadata(STORED))).toEqual([]);
  });

  it("names a duplicate index, a missing name and a bad date", () => {
    const d = draftFromMetadata(STORED);
    d.phases[1].index = "1";
    d.phases[1].name = " ";
    d.phases[0].plannedEnd = "soon";
    const problems = validateDraft(d).join("\n");
    expect(problems).toMatch(/index 1 is used twice/);
    expect(problems).toMatch(/name is required/);
    expect(problems).toMatch(/planned end must look like/);
  });

  it("refuses a start after an end and a parent phase without a parent", () => {
    const d = draftFromMetadata({});
    d.phases = [
      {
        index: "1",
        name: "A",
        milestone: "",
        plannedStart: "2026-12-18",
        plannedEnd: "2026-12-01",
        units: "",
      },
    ];
    d.parentPhase = "2";
    const problems = validateDraft(d).join("\n");
    expect(problems).toMatch(/start is after planned end/);
    expect(problems).toMatch(/needs a parent unit/);
  });

  it("blocks a save that would drop an entry it could not read", () => {
    const d = draftFromMetadata({ phases: [{ index: "x", name: "bad" }] });
    expect(validateDraft(d).join("\n")).toMatch(/could not be read/);
  });
});

describe("draftIsUnchanged / parseUnitList", () => {
  it("is unchanged for the stored draft and changed after an edit", () => {
    const d = draftFromMetadata(STORED);
    expect(draftIsUnchanged(d, STORED)).toBe(true);
    d.phases[0].name = "F1 renamed";
    expect(draftIsUnchanged(d, STORED)).toBe(false);
  });

  it("splits on commas and whitespace", () => {
    expect(parseUnitList(" a ,b  c,, a")).toEqual(["a", "b", "c"]);
  });
});
