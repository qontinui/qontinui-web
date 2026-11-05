import { describe, expect, it } from "vitest";
import { bodyOf, classifyImport, planRecordWrites } from "./writes";

/** A plain record: nothing here comes from an app page. */
interface Item {
  id: string;
  name: string;
  size: number;
  note: string;
  supplied?: readonly string[];
}

const WRITABLE = ["name", "size", "note"] as const;
const byName = (row: Item) => row.name.toLowerCase();

const item = (over: Partial<Item> = {}): Item => ({
  id: "",
  name: "Box",
  size: 1,
  note: "",
  ...over,
});

describe("planRecordWrites", () => {
  const a = item({ id: "a", name: "Alpha" });
  const b = item({ id: "b", name: "Beta" });

  it("turns an edit into a create, an update and a delete", () => {
    const next = [{ ...a, size: 2 }, item({ name: "Gamma" })];
    const plan = planRecordWrites([a, b], next, "edit", WRITABLE);
    expect(plan.creates.map((r) => r.name)).toEqual(["Gamma"]);
    expect(plan.updates).toEqual([{ row: a, patch: { size: 2 } }]);
    expect(plan.deletes).toEqual([b]);
  });

  it("writes nothing for an unchanged edit", () => {
    expect(planRecordWrites([a, b], [a, b], "edit", WRITABLE)).toEqual({
      creates: [],
      updates: [],
      deletes: [],
    });
  });

  it("never deletes on an import, and writes each row as its fate says", () => {
    const pasted = [
      item({ name: "alpha", size: 5, supplied: ["name", "size"] }),
      item({ name: "Beta", size: 1, supplied: ["name", "size"] }),
      item({ name: "Delta" }),
    ];
    const plan = planRecordWrites([a, b], pasted, "import", WRITABLE, byName);
    expect(plan.deletes).toEqual([]);
    expect(plan.updates).toEqual([
      { row: a, patch: { name: "alpha", size: 5 } },
    ]);
    // Beta is already recorded exactly as pasted: no write at all.
    expect(plan.creates.map((r) => r.name)).toEqual(["Delta"]);
  });

  it("without a match key an import only adds", () => {
    const plan = planRecordWrites(
      [a],
      [item({ name: "Alpha" })],
      "import",
      WRITABLE
    );
    expect(plan.creates).toHaveLength(1);
    expect(plan.updates).toEqual([]);
  });
});

describe("classifyImport", () => {
  const a = item({ id: "a", name: "Alpha", size: 1, note: "kept" });

  it("adds a row matching nothing", () => {
    const row = item({ name: "Omega" });
    expect(classifyImport([a], [row], WRITABLE, byName)).toEqual([
      { kind: "add", row },
    ]);
  });

  it("updates a single match in only the one changed supplied column", () => {
    const row = item({
      name: "Alpha",
      size: 3,
      note: "",
      supplied: ["name", "size"],
    });
    expect(classifyImport([a], [row], WRITABLE, byName)).toEqual([
      { kind: "update", row, match: a, patch: { size: 3 } },
    ]);
  });

  it("leaves a single match unchanged when nothing it gave differs", () => {
    const row = item({ name: "Alpha", size: 1, supplied: ["name", "size"] });
    expect(classifyImport([a], [row], WRITABLE, byName)).toEqual([
      { kind: "unchanged", row, match: a },
    ]);
  });

  it("adds a row whose key matches two records rather than guessing", () => {
    const twin = item({ id: "t", name: "alpha" });
    const row = item({ name: "ALPHA", size: 9 });
    expect(classifyImport([a, twin], [row], WRITABLE, byName)).toEqual([
      { kind: "add", row },
    ]);
  });

  it("compares every writable column when the row names none supplied", () => {
    const row = item({ name: "Alpha", size: 1, note: "" });
    expect(classifyImport([a], [row], WRITABLE, byName)).toEqual([
      { kind: "update", row, match: a, patch: { note: "" } },
    ]);
  });

  it("returns one fate per pasted row, in order", () => {
    const rows = [item({ name: "x" }), item({ name: "Alpha", note: "kept" })];
    expect(
      classifyImport([a], rows, WRITABLE, byName).map((f) => f.kind)
    ).toEqual(["add", "unchanged"]);
  });
});

describe("bodyOf", () => {
  it("sends exactly the writable fields", () => {
    expect(bodyOf(item({ id: "x", supplied: ["name"] }), WRITABLE)).toEqual({
      name: "Box",
      size: 1,
      note: "",
    });
  });
});
