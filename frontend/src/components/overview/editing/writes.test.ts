import { describe, expect, it } from "vitest";
import {
  bodyOf,
  classifyImport,
  planImportWrites,
  planRecordWrites,
} from "./writes";

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

  it("refuses a second line that matches a record an earlier line updates", () => {
    // Two writes to one record would count it twice, and the second would
    // go out with the version the first already moved past.
    const first = item({ name: "Alpha", size: 2, note: "kept" });
    const second = item({ name: "alpha", size: 3, note: "kept" });
    expect(classifyImport([a], [first, second], WRITABLE, byName)).toEqual([
      { kind: "update", row: first, match: a, patch: { size: 2 } },
      {
        kind: "refused",
        row: second,
        reason: "An earlier line already gives this record.",
      },
    ]);
  });

  it("refuses a second line after one that left the record unchanged", () => {
    const first = item({ name: "Alpha", note: "kept" });
    const second = item({ name: "Alpha", size: 4, note: "kept" });
    expect(
      classifyImport([a], [first, second], WRITABLE, byName).map((f) => f.kind)
    ).toEqual(["unchanged", "refused"]);
  });

  it("returns one fate per pasted row, in order", () => {
    const rows = [item({ name: "x" }), item({ name: "Alpha", note: "kept" })];
    expect(
      classifyImport([a], rows, WRITABLE, byName).map((f) => f.kind)
    ).toEqual(["add", "unchanged"]);
  });
});

describe("classifyImport with the table's rules", () => {
  const a = item({ id: "a", name: "Alpha", size: 1, note: "kept" });
  // A rule a stored record can complete: a big box needs a note.
  const rowProblem = (row: Item) =>
    row.size > 5 && !row.note ? "A big box needs a note." : null;
  const table = {
    identity: ["name", "size"] as ("name" | "size")[],
    fields: [{ field: "name" as const, label: "Name", kind: "text" as const }],
    singular: "box",
  };

  it("refuses a create that breaks the row rule", () => {
    const row = item({ name: "Omega", size: 9, note: "" });
    expect(
      classifyImport([a], [row], WRITABLE, byName, { rowProblem })
    ).toEqual([{ kind: "refused", row, reason: "A big box needs a note." }]);
  });

  it("does not refuse an update whose stored record completes it", () => {
    // The line gives no note; the record it updates already has one.
    const row = item({ name: "Alpha", size: 9, supplied: ["name", "size"] });
    expect(
      classifyImport([a], [row], WRITABLE, byName, { rowProblem })
    ).toEqual([{ kind: "update", row, match: a, patch: { size: 9 } }]);
  });

  it("refuses an update the record it would leave breaks", () => {
    const bare = item({ id: "b", name: "Bare", size: 1, note: "" });
    const row = item({ name: "Bare", size: 9, supplied: ["name", "size"] });
    expect(
      classifyImport([bare], [row], WRITABLE, byName, { rowProblem })
    ).toEqual([{ kind: "refused", row, reason: "A big box needs a note." }]);
  });

  it("refuses a create repeating an existing row's identity", () => {
    // No match key: every line is a would-be create.
    const row = item({ name: "Alpha", size: 1, note: "other" });
    expect(classifyImport([a], [row], WRITABLE, undefined, { table })).toEqual([
      {
        kind: "refused",
        row,
        reason: "There is already a box with this combination.",
      },
    ]);
  });

  it("refuses a create repeating an earlier pasted add", () => {
    const first = item({ name: "Omega", size: 2 });
    const again = item({ name: "Omega", size: 2, note: "twice" });
    const other = item({ name: "Omega", size: 3 });
    expect(
      classifyImport([a], [first, again, other], WRITABLE, undefined, {
        table,
      })
    ).toEqual([
      { kind: "add", row: first },
      {
        kind: "refused",
        row: again,
        reason: "An earlier line already gives this box.",
      },
      { kind: "add", row: other },
    ]);
  });

  it("compares identities as the server does when told how", () => {
    // A name unique ignoring case: "omega" repeats "Omega" though the exact
    // values differ, and "ALPHA" repeats a stored "Alpha".
    const named = {
      ...table,
      identity: ["name"] as "name"[],
    };
    const first = item({ name: "Omega" });
    const again = item({ name: "omega" });
    const stored = item({ name: "ALPHA", size: 7, note: "x" });
    expect(
      classifyImport([a], [first, again, stored], WRITABLE, undefined, {
        table: named,
        identityOf: byName,
      })
    ).toEqual([
      { kind: "add", row: first },
      {
        kind: "refused",
        row: again,
        reason: "An earlier line already gives this box.",
      },
      {
        kind: "refused",
        row: stored,
        reason: "There is already a box with this name.",
      },
    ]);
  });

  it("does not hold an update to the identity check", () => {
    const row = item({ name: "Alpha", size: 1, note: "changed" });
    expect(
      classifyImport([a], [row], WRITABLE, byName, { rowProblem, table })
    ).toEqual([{ kind: "update", row, match: a, patch: { note: "changed" } }]);
  });

  it("writes nothing for a refused line in an import plan", () => {
    const bad = item({ name: "Omega", size: 9 });
    const good = item({ name: "Gamma" });
    const plan = planRecordWrites(
      [a],
      [bad, good],
      "import",
      WRITABLE,
      byName,
      {
        rowProblem,
      }
    );
    expect(plan).toEqual({ creates: [good], updates: [], deletes: [] });
  });
});

describe("planImportWrites", () => {
  it("writes exactly the fates it is given", () => {
    const a = item({ id: "a", name: "Alpha" });
    const add = item({ name: "New" });
    const upd = item({ name: "Alpha", size: 5 });
    const plan = planImportWrites([
      { kind: "add", row: add },
      { kind: "update", row: upd, match: a, patch: { size: 5 } },
      { kind: "unchanged", row: a, match: a },
      { kind: "refused", row: add, reason: "no" },
    ]);
    expect(plan).toEqual({
      creates: [add],
      updates: [{ row: a, patch: { size: 5 } }],
      deletes: [],
    });
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
