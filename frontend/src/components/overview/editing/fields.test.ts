import { describe, expect, it } from "vitest";
import { ALLOCATION_SCHEMA, ROLE_SCHEMA } from "./__fixtures__/estimate-schema";
import {
  cellText,
  identityKey,
  isIsoDay,
  rowProblems,
  rowToText,
  textToRow,
} from "./fields";
import {
  ESTIMATE_ALLOCATIONS,
  ESTIMATE_ROLES,
  type TableDeclaration,
} from "./registry";

/**
 * A row edited as text comes back as exactly what the API would accept — or
 * as the sentence saying why not, on the field that is wrong. The bounds are
 * the SERVED schema's, so the form cannot accept a figure the API refuses.
 */

const role = {
  code: "BE",
  name: "Backend",
  responsibility: "Builds it",
  day_rate_micros: 750_000_000,
  currency: "EUR",
  client_side: false,
};

describe("a row round-trips through its text", () => {
  it("returns the row it was given", () => {
    const text = rowToText(ESTIMATE_ROLES, role);
    expect(text.day_rate_micros).toBe("750");
    expect(text.currency).toBe("EUR");
    expect(textToRow(ESTIMATE_ROLES, text, ROLE_SCHEMA, role)).toEqual({
      row: role,
    });
  });

  it("reads an amount into micros and upper-cases its currency", () => {
    const text = {
      ...rowToText(ESTIMATE_ROLES, role),
      day_rate_micros: "1,200.5",
      currency: "usd",
    };
    const read = textToRow(ESTIMATE_ROLES, text, ROLE_SCHEMA, role);
    expect(read).toEqual({
      row: { ...role, day_rate_micros: 1_200_500_000, currency: "USD" },
    });
  });

  it("clears a rate and its currency together", () => {
    const text = {
      ...rowToText(ESTIMATE_ROLES, role),
      day_rate_micros: "",
      currency: "",
    };
    expect(textToRow(ESTIMATE_ROLES, text, ROLE_SCHEMA, role)).toEqual({
      row: { ...role, day_rate_micros: null, currency: null },
    });
  });
});

describe("what a row is refused for", () => {
  it("names each field that cannot be read", () => {
    const text = {
      ...rowToText(ESTIMATE_ROLES, role),
      code: "  ",
      day_rate_micros: "lots",
    };
    const read = textToRow(ESTIMATE_ROLES, text, ROLE_SCHEMA, role);
    expect(read).toEqual({
      errors: {
        code: "Code can't be empty.",
        day_rate_micros: "Day rate must be an amount, e.g. 900.",
      },
    });
  });

  it("refuses a rate without its currency", () => {
    const text = { ...rowToText(ESTIMATE_ROLES, role), currency: "" };
    const read = textToRow(ESTIMATE_ROLES, text, ROLE_SCHEMA, role);
    expect("errors" in read && read.errors.day_rate_micros).toMatch(
      /three-letter code/
    );
  });

  it("refuses a rate the column cannot hold, by the served bound", () => {
    const text = {
      ...rowToText(ESTIMATE_ROLES, role),
      day_rate_micros: "9007199255",
    };
    const read = textToRow(ESTIMATE_ROLES, text, ROLE_SCHEMA, role);
    expect("errors" in read && read.errors.day_rate_micros).toBe(
      "Day rate is more than can be recorded."
    );
  });

  it("refuses a decimal past the served precision", () => {
    const row = { phase_code: "A0", role_code: "BE", fte: "100000" };
    expect(rowProblems(ESTIMATE_ALLOCATIONS, row, ALLOCATION_SCHEMA)).toEqual([
      "People (FTE) must be less than 100,000.",
    ]);
    expect(
      rowProblems(
        ESTIMATE_ALLOCATIONS,
        { ...row, fte: "99999.999" },
        ALLOCATION_SCHEMA
      )
    ).toEqual([]);
  });

  it("refuses a decimal that is not a number", () => {
    const row = { phase_code: "A0", role_code: "BE", fte: "1,5" };
    expect(rowProblems(ESTIMATE_ALLOCATIONS, row, ALLOCATION_SCHEMA)).toEqual([
      "People (FTE) must be a number, e.g. 1.5.",
    ]);
  });
});

describe("how a row reads", () => {
  it("says a missing rate is unpriced rather than zero", () => {
    const unpriced = { ...role, day_rate_micros: null, currency: null };
    const rate = ESTIMATE_ROLES.fields.find(
      (f) => f.field === "day_rate_micros"
    )!;
    expect(cellText(rate, unpriced)).toBe("not priced");
    const whose = ESTIMATE_ROLES.fields.find((f) => f.field === "client_side")!;
    expect(cellText(whose, role)).toBe("Ours");
  });

  it("identifies a row by all of its identity fields", () => {
    const a = { phase_code: "A0", role_code: "BE", fte: "1" };
    expect(identityKey(ESTIMATE_ALLOCATIONS, a)).toBe(
      identityKey(ESTIMATE_ALLOCATIONS, { ...a, fte: "2" })
    );
    expect(identityKey(ESTIMATE_ALLOCATIONS, a)).not.toBe(
      identityKey(ESTIMATE_ALLOCATIONS, { ...a, phase_code: "A1" })
    );
  });
});

describe("date and choice fields", () => {
  interface Row {
    when: string | null;
    pick: string | null;
  }
  const table: TableDeclaration<Row> = {
    resource: "x",
    schemaDef: "X",
    singular: "row",
    plural: "rows",
    emptyText: "",
    identity: ["when"],
    fields: [
      { field: "when", label: "Due", kind: "date", required: true },
      {
        field: "pick",
        label: "Phase",
        kind: "select",
        options: [{ value: "p1", label: "A1 Discovery" }],
        emptyLabel: "No phase",
      },
    ],
    blank: () => ({ when: null, pick: null }),
    csv: {
      label: "",
      help: "",
      placeholder: "",
      parse: () => ({ rows: [], issues: [], lines: [] }),
    },
  };
  const schema = {
    type: "object",
    properties: {
      when: {
        type: "string",
        format: "date",
        formatMinimum: "1970-01-01",
        formatMaximum: "2200-12-31",
      },
    },
  };
  const read = (when: string, pick: string) =>
    textToRow(table, { when, pick }, schema, table.blank());

  it("takes a real day and refuses one that is not", () => {
    expect(isIsoDay("2024-02-29")).toBe(true);
    expect(isIsoDay("2026-02-29")).toBe(false);
    expect(read("2026-03-31", "")).toEqual({
      row: { when: "2026-03-31", pick: null },
    });
    expect(read("31/03/2026", "")).toMatchObject({
      errors: { when: expect.stringMatching(/date/) },
    });
    expect(read("", "")).toMatchObject({
      errors: { when: "Due can't be empty." },
    });
  });

  it("reads a date as the overview pages write a day, and edits it as ISO", () => {
    const when = table.fields[0]!;
    expect(cellText(when, { when: "2026-10-16", pick: null })).toBe(
      "16 Oct 2026"
    );
    expect(cellText(when, { when: null, pick: null })).toBe("—");
    // Not a real day: shown as it is rather than guessed at.
    expect(cellText(when, { when: "2026-02-30", pick: null })).toBe(
      "2026-02-30"
    );
    // The editor's input still holds the wire form.
    expect(rowToText(table, { when: "2026-10-16", pick: null }).when).toBe(
      "2026-10-16"
    );
  });

  it("applies the served date bounds", () => {
    expect(read("1969-12-31", "")).toMatchObject({
      errors: { when: "Due must be on or after 1970-01-01." },
    });
    expect(read("2201-01-01", "")).toMatchObject({
      errors: { when: "Due must be on or before 2200-12-31." },
    });
  });

  it("stores a choice by its value, names it by its label, and refuses others", () => {
    expect(read("2026-03-31", "A1 discovery")).toEqual({
      row: { when: "2026-03-31", pick: "p1" },
    });
    expect(read("2026-03-31", "zz")).toMatchObject({
      errors: { pick: "Phase must be one of: A1 Discovery." },
    });
    const field = table.fields[1]!;
    expect(cellText(field, { when: null, pick: "p1" })).toBe("A1 Discovery");
    expect(cellText(field, { when: null, pick: null })).toBe("No phase");
  });
});
