import { describe, expect, it } from "vitest";
import { ALLOCATION_SCHEMA, ROLE_SCHEMA } from "./__fixtures__/estimate-schema";
import {
  cellText,
  identityKey,
  rowProblems,
  rowToText,
  textToRow,
} from "./fields";
import { ESTIMATE_ALLOCATIONS, ESTIMATE_ROLES } from "./registry";

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
  const form = {
    fields: [
      {
        field: "start_date",
        label: "First charged on",
        kind: "date",
        required: true,
      },
      { field: "end_date", label: "Ends on", kind: "date" },
      {
        field: "cadence",
        label: "Charged",
        kind: "choice",
        required: true,
        options: [
          { value: "monthly", label: "Every month" },
          { value: "annual", label: "Every year" },
        ],
      },
    ],
  } as const;
  type Row = { start_date: string; end_date: string | null; cadence: string };
  const base: Row = { start_date: "", end_date: null, cadence: "" };
  const fields = form.fields as unknown as Parameters<
    typeof textToRow<Row>
  >[0]["fields"];

  it("reads a calendar day and leaves an empty optional date null", () => {
    expect(
      textToRow<Row>(
        { fields },
        { start_date: "2026-09-01", end_date: "", cadence: "annual" },
        undefined,
        base
      )
    ).toEqual({
      row: { start_date: "2026-09-01", end_date: null, cadence: "annual" },
    });
  });

  it("refuses a day that does not exist and a value outside the choices", () => {
    const read = textToRow<Row>(
      { fields },
      { start_date: "2026-02-30", end_date: "", cadence: "weekly" },
      undefined,
      base
    );
    expect(read).toEqual({
      errors: {
        start_date: "First charged on must be a date, e.g. 2026-10-03.",
        cadence: "Charged isn't one of the choices.",
      },
    });
  });

  it("asks for a required choice", () => {
    const read = textToRow<Row>(
      { fields },
      { start_date: "2026-09-01", end_date: "", cadence: "" },
      undefined,
      base
    );
    expect(read).toEqual({ errors: { cadence: "Choose the charged." } });
  });

  it("shows a choice by its label", () => {
    expect(cellText(fields[2]!, { ...base, cadence: "annual" })).toBe(
      "Every year"
    );
  });
});
